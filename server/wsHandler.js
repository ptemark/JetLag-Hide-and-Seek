const WS_OPEN = 1;

export class WsHandler {
  constructor(gameLoop) {
    this.gameLoop = gameLoop;
    this.clients = new Map(); // playerId -> ws
  }

  handleConnection(ws, playerId) {
    this.clients.set(playerId, ws);
    this.gameLoop.addPlayer(playerId);

    ws.on('message', (data) => this._handleMessage(ws, playerId, data));
    ws.on('close', () => this._handleDisconnect(playerId));
    ws.on('error', () => this._handleDisconnect(playerId));

    this._send(ws, { type: 'connected', playerId });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of this.clients.values()) {
      if (ws.readyState === WS_OPEN) {
        ws.send(payload);
      }
    }
  }

  getConnectedCount() {
    return this.clients.size;
  }

  _handleMessage(ws, playerId, data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this._send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }
    // Route by message type — expanded in later tasks
    this._send(ws, { type: 'ack', received: message.type, playerId });
  }

  _handleDisconnect(playerId) {
    this.clients.delete(playerId);
    this.gameLoop.removePlayer(playerId);
  }

  _send(ws, message) {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
