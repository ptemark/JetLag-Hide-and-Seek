import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { GameLoop } from './gameLoop.js';
import { GameLoopManager } from './gameLoopManager.js';
import { WsHandler } from './wsHandler.js';
import { GameStateManager } from './gameState.js';
import { HeartbeatManager } from './heartbeat.js';
import { StateDispatcher } from './stateDispatcher.js';
import { Logger, LogCategory, LogLevel } from './logger.js';
import { MetricsCollector, MetricKey, RateTracker } from './monitoring.js';
import { nullAlertManager, AlertType } from './alerting.js';
import { nullAutoScaler } from './autoScaler.js';
import { checkCapture } from './captureDetector.js';

export function createServer({
  tickInterval = 1000,
  heartbeatInterval = 30_000,
  hidingDuration = 120_000,
  seekingDuration = 600_000,
  reconnectGraceMs = 30_000,
  logger        = new Logger({ level: LogLevel.INFO }),
  metrics       = new MetricsCollector(),
  alertManager  = nullAlertManager,
  autoScaler    = nullAutoScaler,
  store         = null,   // optional: { dbUpdateGameStatus, dbSubmitScore, dbExpireStaleQuestions }
} = {}) {
  // Declare gameStateManager/gameLoopManager/wsHandler before using them in
  // the HTTP handler below. Variables are assigned immediately after; the
  // handler is only invoked at request time so references are always valid.
  let gameStateManager;
  let gameLoopManager;
  let wsHandler;
  const startedAt = Date.now();
  const loopRateTracker = new RateTracker();

  const httpServer = createHttpServer((req, res) => {
    const urlPath = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    ).pathname;

    const stateMatch = req.method === 'GET'
      && urlPath.match(/^\/internal\/state\/(?<gameId>[^/]+)$/);

    if (stateMatch) {
      const state = gameStateManager.getGameState(stateMatch.groups.gameId);
      if (!state) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'game not found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
      }
      return;
    }

    // POST /internal/games/:gameId/zones — register hiding zones for a game so
    // the capture detector can evaluate seeker proximity each tick.
    const zonesMatch = req.method === 'POST'
      && urlPath.match(/^\/internal\/games\/(?<gameId>[^/]+)\/zones$/);
    if (zonesMatch) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const { zones } = JSON.parse(body);
          if (Array.isArray(zones)) {
            gameStateManager.setGameZones(zonesMatch.groups.gameId, zones);
            res.writeHead(204);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'zones must be an array' }));
            return;
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        res.end();
      });
      return;
    }

    // POST /internal/notify — receive a fire-and-forget broadcast request from
    // a serverless function (e.g. after an answer is submitted) and relay it
    // to all connected players in the target game via WebSocket.
    if (req.method === 'POST' && urlPath === '/internal/notify') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const { gameId, ...event } = payload;
          if (gameId) {
            wsHandler.broadcastToGame(gameId, event);
          }
        } catch { /* malformed payload — ignore */ }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    if (req.method === 'GET' && urlPath === '/internal/admin') {
      const games = [];
      for (const [gameId] of gameLoopManager._games) {
        games.push({
          gameId,
          phase: gameLoopManager.getPhase(gameId),
          phaseElapsedMs: gameLoopManager.getPhaseElapsed(gameId),
          playerCount: wsHandler.getGamePlayerCount(gameId),
        });
      }
      // Sync gauge metrics before snapshotting.
      metrics.set(MetricKey.ACTIVE_CONNECTIONS, wsHandler.getConnectedCount());
      const payload = {
        connectedPlayers: wsHandler.getConnectedCount(),
        activeGameCount: gameLoopManager.getActiveGameCount(),
        uptimeMs: Date.now() - startedAt,
        games,
        metrics: {
          ...metrics.getSnapshot(),
          loopIterationsPerMinute: loopRateTracker.getPerMinute(),
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  const gameLoop = new GameLoop(tickInterval);
  gameLoopManager = new GameLoopManager({ tickInterval, hidingDuration, seekingDuration, logger });
  gameStateManager = new GameStateManager();
  const stateDispatcher = new StateDispatcher({ logger });
  const wss = new WebSocketServer({ server: httpServer });
  wsHandler = new WsHandler(gameLoop, gameStateManager, reconnectGraceMs);
  const heartbeatManager = new HeartbeatManager(wss, { interval: heartbeatInterval });

  // Track last timer_sync broadcast time per game to enforce 30 s throttle.
  const _lastTimerSyncAt = new Map();

  // Track when each game enters the seeking phase so elapsed time is available on timeout.
  const _seekingStartedAt = new Map();

  /**
   * Build a timer_sync payload for a game in a timed phase.
   * Returns null for phases with no defined duration (waiting/finished).
   */
  function buildTimerSync(gameId, phase) {
    if (phase !== 'hiding' && phase !== 'seeking') return null;
    const duration = phase === 'hiding' ? hidingDuration : seekingDuration;
    const elapsed = gameLoopManager.getPhaseElapsed(gameId);
    const phaseEndsAt = new Date(Date.now() - elapsed + duration).toISOString();
    return { type: 'timer_sync', gameId, phase, phaseEndsAt };
  }

  // Guard against duplicate capture processing when ticks overlap async work.
  const _capturingGames = new Set();

  // Register capture detection task for the SEEKING phase.
  stateDispatcher.register('seeking', 'capture_check', async (gameState) => {
    const { gameId } = gameState;
    if (_capturingGames.has(gameId)) return { captured: false };

    const zones = gameStateManager.getGameZones(gameId);
    const { captured, hiderZone, seekersInZone, captureTeam } = checkCapture(gameState, zones);
    if (!captured) return { captured: false };

    _capturingGames.add(gameId);

    const capturedAt = new Date();
    const seekingElapsedMs = gameLoopManager.getPhaseElapsed(gameId);

    if (store) {
      try {
        await store.dbUpdateGameStatus({ gameId, status: 'finished' });
        for (const seekerId of seekersInZone) {
          await store.dbSubmitScore({
            gameId,
            playerId: seekerId,
            scoreSeconds: Math.floor(seekingElapsedMs / 1000),
            capturedAt,
          });
        }
      } catch (err) {
        logger.error(LogCategory.ERROR, 'capture_db_error', { gameId, error: err?.message });
      }
    }

    wsHandler.broadcastToGame(gameId, {
      type: 'capture',
      gameId,
      winner: 'seekers',
      captureTeam,
      hiderZone,
      seekersInZone,
      seekingElapsedMs,
    });

    gameLoopManager.finishGame(gameId);
    return { captured: true, winner: 'seekers', seekersInZone };
  });

  // Register question expiry task for the SEEKING phase.
  stateDispatcher.register('seeking', 'question_expiry', async (gameState) => {
    const { gameId } = gameState;
    if (!store?.dbExpireStaleQuestions) return { expired: 0 };
    let expired;
    try {
      expired = await store.dbExpireStaleQuestions({ gameId });
    } catch (err) {
      logger.error(LogCategory.ERROR, 'question_expiry_error', { gameId, error: err?.message });
      return { expired: 0 };
    }
    for (const q of expired) {
      wsHandler.broadcastToGame(gameId, { type: 'question_expired', gameId, questionId: q.questionId });
    }
    return { expired: expired.length };
  });

  // Broadcast phase changes to all players in the affected game
  gameLoopManager.onPhaseChange = (gameId, oldPhase, newPhase) => {
    gameStateManager.setGameStatus(gameId, newPhase);
    wsHandler.broadcastToGame(gameId, { type: 'phase_change', gameId, oldPhase, newPhase });

    if (newPhase === 'seeking') {
      _seekingStartedAt.set(gameId, Date.now());
    }

    if (newPhase === 'finished') {
      const wasCapture = _capturingGames.has(gameId);
      _capturingGames.delete(gameId);

      if (!wasCapture) {
        // Hider wins by timeout — seekers never captured.
        const seekingStarted = _seekingStartedAt.get(gameId);
        const seekingElapsedMs = seekingStarted ? Date.now() - seekingStarted : seekingDuration;

        wsHandler.broadcastToGame(gameId, {
          type: 'capture',
          gameId,
          winner: 'hider',
          captureTeam: null,
          hiderZone: null,
          seekersInZone: [],
          seekingElapsedMs,
        });

        if (store) {
          store.dbUpdateGameStatus({ gameId, status: 'finished' }).catch((err) => {
            logger.error(LogCategory.ERROR, 'timeout_db_error', { gameId, error: err?.message });
          });
        }
      }

      _seekingStartedAt.delete(gameId);
      _lastTimerSyncAt.delete(gameId);
    }

    // Immediately sync the timer on phase entry so clients can start counting down.
    const timerMsg = buildTimerSync(gameId, newPhase);
    if (timerMsg) {
      wsHandler.broadcastToGame(gameId, timerMsg);
      _lastTimerSyncAt.set(gameId, Date.now());
    }
  };

  // Dispatch state computation tasks on every game tick
  gameLoopManager.onTick = (gameId, phase) => {
    metrics.increment(MetricKey.LOOP_ITERATIONS);
    loopRateTracker.record();
    const gameState = gameStateManager.getGameState(gameId);
    if (gameState) {
      stateDispatcher.dispatch(gameState);
    }
    // Periodic timer sync — at most every 30 s during timed phases.
    const lastSync = _lastTimerSyncAt.get(gameId) ?? 0;
    if (Date.now() - lastSync >= 30_000) {
      const timerMsg = buildTimerSync(gameId, phase);
      if (timerMsg) {
        wsHandler.broadcastToGame(gameId, timerMsg);
        _lastTimerSyncAt.set(gameId, Date.now());
      }
    }
    alertManager.checkMetrics(
      metrics.getSnapshot(),
      loopRateTracker.getPerMinute(),
      gameLoopManager.getActiveGameCount(),
    );
    autoScaler.check(
      gameLoopManager.getActiveGameCount(),
      wsHandler.getConnectedCount(),
    );
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const playerId = url.searchParams.get('playerId') ?? randomUUID();
    metrics.set(MetricKey.ACTIVE_CONNECTIONS, wsHandler.getConnectedCount() + 1);
    heartbeatManager.track(ws);
    wsHandler.handleConnection(ws, playerId);
    ws.on('close', () => {
      metrics.set(MetricKey.ACTIVE_CONNECTIONS, wsHandler.getConnectedCount());
    });
    ws.on('error', (err) => {
      metrics.increment(MetricKey.ERRORS);
      alertManager.alert(AlertType.CONNECTION_DROP, 'WebSocket connection error', {
        playerId,
        error: String(err),
      });
    });
  });

  return {
    start(port) {
      return new Promise((resolve) => {
        alertManager.watchProcess();
        httpServer.listen(port, () => {
          heartbeatManager.start();
          logger.info(LogCategory.SERVER, 'server_started', { port });
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        heartbeatManager.stop();
        gameLoop.stop();
        // Stop all active per-game loops
        for (const gameId of [...gameLoopManager._games.keys()]) {
          gameLoopManager.stopGame(gameId);
        }
        wss.close((err) => {
          if (err) { reject(err); return; }
          httpServer.close((err2) => {
            if (err2) { reject(err2); return; }
            logger.info(LogCategory.SERVER, 'server_stopped');
            resolve();
          });
        });
      });
    },
    /**
     * Register a callback invoked when the first game becomes active.
     * Use to spin up resources (DB pool, scaling) on demand.
     * @param {() => void} fn
     */
    onActive(fn) {
      gameLoopManager.onActive = () => {
        logger.info(LogCategory.SERVER, 'server_active');
        fn();
      };
    },
    /**
     * Register a callback invoked when the last game finishes and the server is idle.
     * Use to spin down resources (close DB pool, scale to zero) to save cost.
     * @param {() => void} fn
     */
    onIdle(fn) {
      gameLoopManager.onIdle = () => {
        logger.info(LogCategory.SERVER, 'server_idle');
        fn();
      };
    },
    logger,
    metrics,
    alertManager,
    autoScaler,
    loopRateTracker,
    gameLoop,
    gameLoopManager,
    gameStateManager,
    stateDispatcher,
    wsHandler,
    heartbeatManager,
    httpServer,
    wss,
  };
}
