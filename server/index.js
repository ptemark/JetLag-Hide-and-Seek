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

export function createServer({
  tickInterval = 1000,
  heartbeatInterval = 30_000,
  hidingDuration = 120_000,
  seekingDuration = 600_000,
  logger = new Logger({ level: LogLevel.INFO }),
} = {}) {
  // Declare gameStateManager before using it in the HTTP handler below.
  // The variable is assigned immediately after; the handler is only invoked
  // at request time, so the reference is always valid.
  let gameStateManager;

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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  const gameLoop = new GameLoop(tickInterval);
  const gameLoopManager = new GameLoopManager({ tickInterval, hidingDuration, seekingDuration, logger });
  gameStateManager = new GameStateManager();
  const stateDispatcher = new StateDispatcher({ logger });
  const wss = new WebSocketServer({ server: httpServer });
  const wsHandler = new WsHandler(gameLoop, gameStateManager);
  const heartbeatManager = new HeartbeatManager(wss, { interval: heartbeatInterval });

  // Broadcast phase changes to all players in the affected game
  gameLoopManager.onPhaseChange = (gameId, oldPhase, newPhase) => {
    gameStateManager.setGameStatus(gameId, newPhase);
    wsHandler.broadcastToGame(gameId, { type: 'phase_change', gameId, oldPhase, newPhase });
  };

  // Dispatch state computation tasks on every game tick
  gameLoopManager.onTick = (gameId, phase) => {
    const gameState = gameStateManager.getGameState(gameId);
    if (gameState) {
      stateDispatcher.dispatch(gameState);
    }
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const playerId = url.searchParams.get('playerId') ?? randomUUID();
    heartbeatManager.track(ws);
    wsHandler.handleConnection(ws, playerId);
  });

  return {
    start(port) {
      return new Promise((resolve) => {
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
