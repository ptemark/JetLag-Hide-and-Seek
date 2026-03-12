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

/** Default spot radius in metres (RULES.md §End Game GPS practical range). */
const DEFAULT_SPOT_RADIUS_M = 30;

const FALSE_ZONE_DURATION_MS = 5 * 60_000;

/**
 * Hiding and seeking durations per game scale (RULES.md).
 * Both hiding and seeking phases use the same duration for a given scale.
 */
const SCALE_DURATIONS = Object.freeze({
  small:  30 * 60_000,
  medium: 60 * 60_000,
  large:  180 * 60_000,
});

/**
 * Valid hiding/seeking duration ranges per scale (RULES.md §Game Scales).
 * All values in minutes.
 */
export const SCALE_DURATION_RANGES = Object.freeze({
  small:  Object.freeze({ min: 30,  max: 60  }),
  medium: Object.freeze({ min: 60,  max: 180 }),
  large:  Object.freeze({ min: 180, max: 360 }),
});

/**
 * Offset a zone's lat/lon by a random distance of 0.5–2 km in a random
 * direction and return a new zone object with a unique stationId.
 * 1° latitude ≈ 111 km.  Longitude degrees scale by cos(lat).
 *
 * @param {{ lat: number, lon: number, [key: string]: unknown }} zone
 * @param {string} decoyId
 * @returns {object}
 */
function generateDecoyZone(zone, decoyId) {
  const distanceKm = 0.5 + Math.random() * 1.5;
  const angle = Math.random() * 2 * Math.PI;
  const latOffsetDeg = (distanceKm / 111) * Math.cos(angle);
  const cosLat = Math.cos((zone.lat * Math.PI) / 180);
  const lonOffsetDeg = cosLat > 0
    ? (distanceKm / (111 * cosLat)) * Math.sin(angle)
    : 0;
  return {
    ...zone,
    stationId: decoyId,
    lat: zone.lat + latOffsetDeg,
    lon: zone.lon + lonOffsetDeg,
    decoyId,
  };
}

/** Default End Game timeout (ms): if no spot_hider arrives, hider wins. */
const DEFAULT_END_GAME_TIMEOUT_MS = 10 * 60_000;

export function createServer({
  tickInterval = 1000,
  heartbeatInterval = 30_000,
  hidingDuration = 120_000,
  seekingDuration = 600_000,
  reconnectGraceMs = 30_000,
  spotRadiusM        = DEFAULT_SPOT_RADIUS_M,
  endGameTimeoutMs   = DEFAULT_END_GAME_TIMEOUT_MS,
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

    // POST /internal/games/:gameId/start — start the game loop for a game and
    // immediately begin the hiding phase, using scale-based durations when provided.
    const startMatch = req.method === 'POST'
      && urlPath.match(/^\/internal\/games\/(?<gameId>[^/]+)\/start$/);
    if (startMatch) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let scale, hidingDurationMs, seekingDurationMs;
        try { ({ scale, hidingDurationMs, seekingDurationMs } = JSON.parse(body)); } catch { /* use default durations */ }

        // Validate custom durations against scale bounds when both are provided.
        if ((hidingDurationMs !== undefined || seekingDurationMs !== undefined) && scale) {
          const range = SCALE_DURATION_RANGES[scale];
          if (range) {
            const hidingMin = hidingDurationMs != null ? hidingDurationMs / 60_000 : null;
            const seekingMin = seekingDurationMs != null ? seekingDurationMs / 60_000 : null;
            if (
              (hidingMin !== null && (hidingMin < range.min || hidingMin > range.max)) ||
              (seekingMin !== null && (seekingMin < range.min || seekingMin > range.max))
            ) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: `Duration out of range for scale '${scale}': must be ${range.min}–${range.max} min`,
              }));
              return;
            }
          }
        }

        const scaleDurationMs = SCALE_DURATIONS[scale] ?? null;
        const opts = {};
        if (hidingDurationMs != null) {
          opts.hidingDurationMs = hidingDurationMs;
        } else if (scaleDurationMs != null) {
          opts.hidingDurationMs = scaleDurationMs;
        }
        if (seekingDurationMs != null) {
          opts.seekingDurationMs = seekingDurationMs;
        } else if (scaleDurationMs != null) {
          opts.seekingDurationMs = scaleDurationMs;
        }
        const { gameId } = startMatch.groups;
        gameLoopManager.startGame(gameId, opts);
        gameLoopManager.beginHiding(gameId);
        res.writeHead(204);
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
          const { gameId, type: eventType, ...rest } = payload;
          if (gameId) {
            if (eventType === 'time_bonus') {
              // Extend the current phase timer and broadcast updated timer_sync.
              const extraMs = (rest.minutesAdded ?? 0) * 60_000;
              if (extraMs > 0) {
                gameLoopManager.extendPhase(gameId, extraMs);
              }
              const currentPhase = gameLoopManager.getPhase(gameId);
              const timerMsg = buildTimerSync(gameId, currentPhase);
              if (timerMsg) {
                wsHandler.broadcastToGame(gameId, timerMsg);
                _lastTimerSyncAt.set(gameId, Date.now());
              }
            } else if (eventType === 'false_zone') {
              // Generate a decoy zone near one of the game's registered zones and
              // broadcast it to all players.  Track expiry for cleanup.
              const zones = gameStateManager.getGameZones(gameId);
              if (zones.length > 0) {
                const baseZone = zones[Math.floor(Math.random() * zones.length)];
                const decoyId = randomUUID();
                const decoyZone = generateDecoyZone(baseZone, decoyId);
                const expiresAt = Date.now() + FALSE_ZONE_DURATION_MS;
                if (!_falseZones.has(gameId)) _falseZones.set(gameId, []);
                _falseZones.get(gameId).push({ decoyId, zone: decoyZone, expiresAt });
                wsHandler.broadcastToGame(gameId, { type: 'false_zone', gameId, zone: decoyZone });
              }
            } else {
              wsHandler.broadcastToGame(gameId, { type: eventType, ...rest });
            }
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

  // onSpotConfirmed: called when a seeker's spot_hider claim is within spotRadiusM.
  // Broadcast capture event (seekers win) and finish the game.
  const onSpotConfirmed = (gameId, spotterId) => {
    logger.info(LogCategory.SERVER, 'spot_confirmed', { gameId, spotterId });
    // Mark as seeker capture so onPhaseChange → finished does not double-broadcast.
    _capturingGames.add(gameId);

    const seekingElapsedMs = gameLoopManager.getPhaseElapsed(gameId);
    wsHandler.broadcastToGame(gameId, {
      type: 'capture',
      gameId,
      winner: 'seekers',
      spotterId,
      captureTeam: null,
      hiderZone: null,
      seekersInZone: [spotterId],
      seekingElapsedMs,
    });

    if (store) {
      const capturedAt = new Date();
      Promise.all([
        store.dbUpdateGameStatus({ gameId, status: 'finished' }),
        store.dbSubmitScore({
          gameId,
          playerId: spotterId,
          scoreSeconds: Math.floor(seekingElapsedMs / 1000),
          capturedAt,
        }),
      ]).catch((err) => {
        logger.error(LogCategory.ERROR, 'spot_capture_db_error', { gameId, error: err?.message });
      });
    }

    gameLoopManager.finishGame(gameId);
  };

  wsHandler = new WsHandler(gameLoop, gameStateManager, reconnectGraceMs, spotRadiusM, onSpotConfirmed);
  const heartbeatManager = new HeartbeatManager(wss, { interval: heartbeatInterval });

  // Track last timer_sync broadcast time per game to enforce 30 s throttle.
  const _lastTimerSyncAt = new Map();

  // Track when each game enters the seeking phase so elapsed time is available on timeout.
  const _seekingStartedAt = new Map();

  // Track when each game's End Game started so timer_sync can compute the expiry.
  const _endGameStartedAt = new Map();

  // Track active false zones per game: gameId → Array<{ decoyId, zone, expiresAt }>
  const _falseZones = new Map();

  /**
   * Build a timer_sync payload for a game in a timed phase.
   * Returns null for phases with no defined duration (waiting/finished).
   * Supports 'hiding', 'seeking', and 'end_game' phases.
   */
  function buildTimerSync(gameId, phase) {
    if (phase === 'end_game') {
      const startedAt = _endGameStartedAt.get(gameId);
      if (startedAt == null) return null;
      const phaseEndsAt = new Date(startedAt + endGameTimeoutMs).toISOString();
      return { type: 'timer_sync', gameId, phase, phaseEndsAt };
    }
    if (phase !== 'hiding' && phase !== 'seeking') return null;
    const baseDuration = gameLoopManager.getGameDuration(gameId, phase);
    if (baseDuration == null) return null;
    const extension = gameLoopManager.getPhaseExtension(gameId);
    const duration = baseDuration + extension;
    const elapsed = gameLoopManager.getPhaseElapsed(gameId);
    const phaseEndsAt = new Date(Date.now() - elapsed + duration).toISOString();
    return { type: 'timer_sync', gameId, phase, phaseEndsAt };
  }

  // Guard against duplicate capture processing when ticks overlap async work.
  const _capturingGames = new Set();

  // Guards against double-broadcasting hider-win when both End Game timeout and
  // seeking phase timeout fire around the same time.
  const _hiderWinBroadcast = new Set();

  // Per-game End Game timeout timers: gameId → timerId.
  const _endGameTimers = new Map();

  // Register capture detection task for the SEEKING phase.
  // Phase 1 of End Game: when all seekers are inside the hiding zone, freeze the hider
  // and broadcast end_game_started. The game does NOT finish here — it finishes only
  // when a seeker sends spot_hider (phase 2) or when endGameTimeoutMs elapses.
  stateDispatcher.register('seeking', 'capture_check', (gameState) => {
    const { gameId } = gameState;
    // Skip if End Game already active or game already being captured.
    if (_capturingGames.has(gameId) || gameStateManager.isEndGameActive(gameId)) {
      return { captured: false };
    }

    const zones = gameStateManager.getGameZones(gameId);
    const { captured } = checkCapture(gameState, zones);
    if (!captured) return { captured: false };

    // Activate End Game: freeze hider, notify all players.
    gameStateManager.setEndGameActive(gameId, true);
    const endGameStart = Date.now();
    _endGameStartedAt.set(gameId, endGameStart);
    wsHandler.broadcastToGame(gameId, { type: 'end_game_started', gameId });
    // Immediately sync the End Game countdown so all players see the timeout.
    const endGameTimerMsg = buildTimerSync(gameId, 'end_game');
    if (endGameTimerMsg) {
      wsHandler.broadcastToGame(gameId, endGameTimerMsg);
      _lastTimerSyncAt.set(gameId, endGameStart);
    }
    logger.info(LogCategory.SERVER, 'end_game_started', { gameId });

    // Start End Game timeout: if no spot_hider arrives in time, hider wins.
    const timerId = setTimeout(() => {
      _endGameTimers.delete(gameId);
      // Only fire if the game is still active (not already finished).
      if (gameLoopManager.getPhase(gameId) === null) return;
      if (_capturingGames.has(gameId)) return;

      _hiderWinBroadcast.add(gameId);
      const seekingElapsedMs = gameLoopManager.getPhaseElapsed(gameId);
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
          logger.error(LogCategory.ERROR, 'end_game_timeout_db_error', { gameId, error: err?.message });
        });
      }
      gameLoopManager.finishGame(gameId);
    }, endGameTimeoutMs);
    _endGameTimers.set(gameId, timerId);

    return { captured: true, endGame: true };
  });

  // Register false zone expiry task for the SEEKING phase.
  stateDispatcher.register('seeking', 'false_zone_expiry', (gameState) => {
    const { gameId } = gameState;
    const falseZoneList = _falseZones.get(gameId);
    if (!falseZoneList || falseZoneList.length === 0) return { expired: 0 };
    const now = Date.now();
    const expired = falseZoneList.filter((fz) => fz.expiresAt <= now);
    if (expired.length === 0) return { expired: 0 };
    _falseZones.set(gameId, falseZoneList.filter((fz) => fz.expiresAt > now));
    for (const fz of expired) {
      wsHandler.broadcastToGame(gameId, { type: 'false_zone_expired', gameId, decoyId: fz.decoyId });
    }
    return { expired: expired.length };
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
      const wasCapture    = _capturingGames.has(gameId);
      const wasHiderWin   = _hiderWinBroadcast.has(gameId);
      _capturingGames.delete(gameId);
      _hiderWinBroadcast.delete(gameId);

      // Clear any pending End Game timeout — game is finishing now.
      if (_endGameTimers.has(gameId)) {
        clearTimeout(_endGameTimers.get(gameId));
        _endGameTimers.delete(gameId);
      }

      if (!wasCapture && !wasHiderWin) {
        // Hider wins by seeking phase timeout — seekers never entered zone.
        const seekingStarted = _seekingStartedAt.get(gameId);
        const seekingElapsedMs = seekingStarted
          ? Date.now() - seekingStarted
          : gameLoopManager.getGameDuration(gameId, 'seeking') ?? seekingDuration;

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
      _endGameStartedAt.delete(gameId);
      _lastTimerSyncAt.delete(gameId);
      _falseZones.delete(gameId);
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
    // Periodic timer sync — at most every 30 s during timed phases (including End Game).
    const lastSync = _lastTimerSyncAt.get(gameId) ?? 0;
    if (Date.now() - lastSync >= 30_000) {
      const timerPhase = gameStateManager.isEndGameActive(gameId) ? 'end_game' : phase;
      const timerMsg = buildTimerSync(gameId, timerPhase);
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
