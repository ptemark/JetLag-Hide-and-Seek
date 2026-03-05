import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { GameLoop } from './gameLoop.js';
import { WsHandler } from './wsHandler.js';

export function createServer({ tickInterval = 1000 } = {}) {
  const httpServer = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  const gameLoop = new GameLoop(tickInterval);
  const wss = new WebSocketServer({ server: httpServer });
  const wsHandler = new WsHandler(gameLoop);

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const playerId = url.searchParams.get('playerId') ?? randomUUID();
    wsHandler.handleConnection(ws, playerId);
  });

  return {
    start(port) {
      return new Promise((resolve) => httpServer.listen(port, resolve));
    },
    stop() {
      return new Promise((resolve, reject) => {
        gameLoop.stop();
        wss.close((err) => {
          if (err) { reject(err); return; }
          httpServer.close((err2) => (err2 ? reject(err2) : resolve()));
        });
      });
    },
    gameLoop,
    wsHandler,
    httpServer,
    wss,
  };
}
