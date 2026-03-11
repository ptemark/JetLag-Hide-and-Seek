const WS_OPEN = 1;

/** Default grace period (ms) before a disconnected player is purged from game state. */
const DEFAULT_RECONNECT_GRACE_MS = 30_000;

export class WsHandler {
  constructor(gameLoop, gameStateManager = null, reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS) {
    this.gameLoop = gameLoop;
    this.gameStateManager = gameStateManager;
    this.reconnectGraceMs = reconnectGraceMs;
    this.clients = new Map();      // playerId -> ws
    this.gameClients = new Map();  // gameId   -> Map<playerId, ws>
    this.playerGames = new Map();  // playerId -> Set<gameId>
    this.playerTeams = new Map();  // playerId -> team ('A'|'B'|null)
    this._reconnectTimers = new Map(); // playerId -> timerId (grace-period cleanup)
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

  _handleJoinGame(ws, playerId, { gameId, role = 'hider', team = null }) {
    if (!gameId) {
      this._send(ws, { type: 'error', message: 'gameId required' });
      return;
    }

    // If a reconnect grace timer is pending for this player, cancel it — they're back.
    const isReconnect = this._reconnectTimers.has(playerId);
    if (isReconnect) {
      clearTimeout(this._reconnectTimers.get(playerId));
      this._reconnectTimers.delete(playerId);
    }

    if (!this.gameClients.has(gameId)) {
      this.gameClients.set(gameId, new Map());
    }
    this.gameClients.get(gameId).set(playerId, ws);

    if (!this.playerGames.has(playerId)) {
      this.playerGames.set(playerId, new Set());
    }
    this.playerGames.get(playerId).add(gameId);

    // Auto-assign team for seekers in two-team games when client doesn't provide one.
    let assignedTeam = team;
    if (role === 'seeker' && !assignedTeam && this.gameStateManager) {
      const seekerTeams = this.gameStateManager.getSeekerTeams(gameId);
      if (seekerTeams >= 2) {
        const gameState = this.gameStateManager.getGameState(gameId);
        const players = gameState ? Object.values(gameState.players) : [];
        const countA = players.filter(p => p.role === 'seeker' && p.team === 'A').length;
        const countB = players.filter(p => p.role === 'seeker' && p.team === 'B').length;
        assignedTeam = countB < countA ? 'B' : 'A';
      }
    }

    if (assignedTeam) {
      this.playerTeams.set(playerId, assignedTeam);
    }

    if (this.gameStateManager) {
      this.gameStateManager.addPlayerToGame(gameId, playerId, role, assignedTeam);
    }

    // Confirm join to the new player, including team assignment if applicable.
    this._send(ws, { type: 'joined_game', gameId, playerId, role, team: assignedTeam ?? null });

    // On reconnect: send current game state so client can recover without a full rejoin sequence.
    if (isReconnect && this.gameStateManager) {
      const state = this.gameStateManager.getGameState(gameId);
      this._send(ws, { type: 'game_state', gameId, state });
    }

    // Notify existing players in the game
    const eventType = isReconnect ? 'player_reconnected' : 'player_joined';
    const gamePlayers = this.gameClients.get(gameId);
    const payload = JSON.stringify({ type: eventType, gameId, playerId, team: assignedTeam ?? null });
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

    const message = { type: 'location_update', gameId, playerId, lat, lon };
    const senderTeam = this.playerTeams.get(playerId);
    if (senderTeam) {
      // Two-team mode: only broadcast to same team and hiders (players with no team).
      this._broadcastToGameTeam(gameId, senderTeam, message);
    } else {
      this.broadcastToGame(gameId, message);
    }
  }

  /**
   * Broadcast a message to players in the given team plus players with no team
   * (hiders and single-team seekers).
   */
  _broadcastToGameTeam(gameId, team, message) {
    const players = this.gameClients.get(gameId);
    if (!players) return;
    const payload = JSON.stringify(message);
    for (const [pid, ws] of players.entries()) {
      if (ws.readyState !== WS_OPEN) continue;
      const recipientTeam = this.playerTeams.get(pid);
      if (!recipientTeam || recipientTeam === team) {
        ws.send(payload);
      }
    }
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
    // Remove from active connection tracking immediately.
    this.clients.delete(playerId);
    this.gameLoop.removePlayer(playerId);

    // Cancel any previously scheduled grace timer for this player (shouldn't normally exist).
    if (this._reconnectTimers.has(playerId)) {
      clearTimeout(this._reconnectTimers.get(playerId));
    }

    // Notify game peers of the temporary disconnection (not a full leave yet).
    const games = this.playerGames.get(playerId);
    if (games) {
      for (const gameId of games) {
        this._broadcastToGameExcluding(gameId, playerId, { type: 'player_disconnected', gameId, playerId });
      }
    }

    // Schedule full cleanup after the grace period.
    const timerId = setTimeout(() => {
      this._finalizeDisconnect(playerId);
    }, this.reconnectGraceMs);
    this._reconnectTimers.set(playerId, timerId);
  }

  /**
   * Fully remove a player from game state after the grace period expires.
   * Called by the grace-period timer set in _handleDisconnect.
   */
  _finalizeDisconnect(playerId) {
    this._reconnectTimers.delete(playerId);
    this.playerTeams.delete(playerId);

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

    // Notify remaining players that the player has fully left.
    this.broadcastToGame(gameId, { type: 'player_left', gameId, playerId });
  }

  _broadcastToGameExcluding(gameId, excludePlayerId, message) {
    const players = this.gameClients.get(gameId);
    if (!players) return;
    const payload = JSON.stringify(message);
    for (const [pid, ws] of players.entries()) {
      if (pid !== excludePlayerId && ws.readyState === WS_OPEN) {
        ws.send(payload);
      }
    }
  }

  _send(ws, message) {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
