import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { GameLoop } from './gameLoop.js';
import { WsHandler } from './wsHandler.js';
import { GameStateManager } from './gameState.js';
import { HeartbeatManager } from './heartbeat.js';

export function createServer({ tickInterval = 1000, heartbeatInterval = 30_000 } = {}) {
  const httpServer = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  const gameLoop = new GameLoop(tickInterval);
  const gameStateManager = new GameStateManager();
  const wss = new WebSocketServer({ server: httpServer });
  const wsHandler = new WsHandler(gameLoop, gameStateManager);
  const heartbeatManager = new HeartbeatManager(wss, { interval: heartbeatInterval });

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
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        heartbeatManager.stop();
        gameLoop.stop();
        wss.close((err) => {
          if (err) { reject(err); return; }
          httpServer.close((err2) => (err2 ? reject(err2) : resolve()));
        });
      });
    },
    gameLoop,
    gameStateManager,
    wsHandler,
    heartbeatManager,
    httpServer,
    wss,
  };
}
