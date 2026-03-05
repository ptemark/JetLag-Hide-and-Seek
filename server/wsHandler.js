const WS_OPEN = 1;

export class WsHandler {
  constructor(gameLoop, gameStateManager = null) {
    this.gameLoop = gameLoop;
    this.gameStateManager = gameStateManager;
    this.clients = new Map();     // playerId -> ws
    this.gameClients = new Map(); // gameId   -> Map<playerId, ws>
    this.playerGames = new Map(); // playerId -> Set<gameId>
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

  broadcastToGame(gameId, message) {
    const players = this.gameClients.get(gameId);
    if (!players) return;
    const payload = JSON.stringify(message);
    for (const ws of players.values()) {
      if (ws.readyState === WS_OPEN) {
        ws.send(payload);
      }
    }
  }

  getConnectedCount() {
    return this.clients.size;
  }

  getGamePlayerCount(gameId) {
    return this.gameClients.get(gameId)?.size ?? 0;
  }

  _handleMessage(ws, playerId, data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this._send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (message.type) {
      case 'join_game':
        this._handleJoinGame(ws, playerId, message);
        break;
      case 'leave_game':
        this._handleLeaveGame(ws, playerId, message);
        break;
      case 'location_update':
        this._handleLocationUpdate(playerId, message);
        break;
      case 'request_state':
        this._handleRequestState(ws, message);
        break;
      default:
        this._send(ws, { type: 'ack', received: message.type, playerId });
    }
  }

  _handleJoinGame(ws, playerId, { gameId, role = 'hider' }) {
    if (!gameId) {
      this._send(ws, { type: 'error', message: 'gameId required' });
      return;
    }

    if (!this.gameClients.has(gameId)) {
      this.gameClients.set(gameId, new Map());
    }
    this.gameClients.get(gameId).set(playerId, ws);

    if (!this.playerGames.has(playerId)) {
      this.playerGames.set(playerId, new Set());
    }
    this.playerGames.get(playerId).add(gameId);

    if (this.gameStateManager) {
      this.gameStateManager.addPlayerToGame(gameId, playerId, role);
    }

    // Confirm join to the new player
    this._send(ws, { type: 'joined_game', gameId, playerId, role });

    // Notify existing players in the game
    const gamePlayers = this.gameClients.get(gameId);
    const payload = JSON.stringify({ type: 'player_joined', gameId, playerId });
    for (const [pid, clientWs] of gamePlayers.entries()) {
      if (pid !== playerId && clientWs.readyState === WS_OPEN) {
        clientWs.send(payload);
      }
    }
  }

  _handleLeaveGame(ws, playerId, { gameId }) {
    if (!gameId) {
      this._send(ws, { type: 'error', message: 'gameId required' });
      return;
    }
    this._removePlayerFromGame(playerId, gameId);
    this._send(ws, { type: 'left_game', gameId, playerId });
  }

  _handleLocationUpdate(playerId, { gameId, lat, lon }) {
    if (!gameId || lat == null || lon == null) return;

    if (this.gameStateManager) {
      this.gameStateManager.updatePlayerLocation(gameId, playerId, lat, lon);
    }

    this.broadcastToGame(gameId, { type: 'location_update', gameId, playerId, lat, lon });
  }

  _handleRequestState(ws, { gameId }) {
    if (!gameId) {
      this._send(ws, { type: 'error', message: 'gameId required' });
      return;
    }
    const state = this.gameStateManager
      ? this.gameStateManager.getGameState(gameId)
      : null;
    this._send(ws, { type: 'game_state', gameId, state });
  }

  _handleDisconnect(playerId) {
    this.clients.delete(playerId);
    this.gameLoop.removePlayer(playerId);

    const games = this.playerGames.get(playerId);
    if (games) {
      for (const gameId of games) {
        this._removePlayerFromGame(playerId, gameId);
      }
      this.playerGames.delete(playerId);
    }
  }

  _removePlayerFromGame(playerId, gameId) {
    const gamePlayers = this.gameClients.get(gameId);
    if (gamePlayers) {
      gamePlayers.delete(playerId);
      if (gamePlayers.size === 0) {
        this.gameClients.delete(gameId);
      }
    }
    this.playerGames.get(playerId)?.delete(gameId);

    if (this.gameStateManager) {
      this.gameStateManager.removePlayerFromGame(gameId, playerId);
    }

    // Notify remaining players
    this.broadcastToGame(gameId, { type: 'player_left', gameId, playerId });
  }

  _send(ws, message) {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
