import { checkSpot as _checkSpotImpl } from './captureDetector.js';

const WS_OPEN = 1;

/** Default grace period (ms) before a disconnected player is purged from game state. */
const DEFAULT_RECONNECT_GRACE_MS = 30_000;

/**
 * Default spot radius (metres): maximum distance between a spotter and the
 * hider for a `spot_hider` claim to be confirmed.  Matches RULES.md §End Game
 * (~2 m physical, but 30 m is used as GPS practical range).
 */
const DEFAULT_SPOT_RADIUS_M = 30;

export class WsHandler {
  /**
   * @param {object}  gameLoop          - GameLoop instance.
   * @param {object}  [gameStateManager] - GameStateManager instance (optional).
   * @param {number}  [reconnectGraceMs] - Grace period before finalising a disconnect.
   * @param {number}  [spotRadiusM]      - Max metres to confirm a spot_hider claim.
   * @param {Function} [onSpotConfirmed] - Called with (gameId, spotterId) when a spot
   *                                       claim is within range. Typically finishes the game.
   */
  constructor(
    gameLoop,
    gameStateManager = null,
    reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS,
    spotRadiusM = DEFAULT_SPOT_RADIUS_M,
    onSpotConfirmed = null,
  ) {
    this.gameLoop = gameLoop;
    this.gameStateManager = gameStateManager;
    this.reconnectGraceMs = reconnectGraceMs;
    this.spotRadiusM = spotRadiusM;
    this.onSpotConfirmed = onSpotConfirmed;
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
      case 'set_transit':
        this._handleSetTransit(playerId, message);
        break;
      case 'request_state':
        this._handleRequestState(ws, message);
        break;
      case 'spot_hider':
        this._handleSpotHider(ws, playerId, message);
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

    // Determine the player's role (needed for privacy and End Game checks).
    const role = this.gameStateManager
      ? this.gameStateManager.getPlayerRole(gameId, playerId)
      : null;

    // Hider must stay put once End Game begins (RULES.md §End Game).
    if (this.gameStateManager?.isEndGameActive(gameId)) {
      if (role === 'hider') return;
    }

    if (this.gameStateManager) {
      this.gameStateManager.updatePlayerLocation(gameId, playerId, lat, lon);
    }

    const message = { type: 'player_location', gameId, playerId, lat, lon };

    if (role === 'hider') {
      // RULES.md §Hiding Rules: seekers see only the possible hiding zones, not the
      // hider's live GPS position.  Echo the location back to the hider only so
      // their own marker stays accurate; do NOT broadcast to other players.
      const hiderWs = this.clients.get(playerId);
      if (hiderWs) {
        this._send(hiderWs, message);
      }
      return;
    }

    // Seeker (or role unknown): broadcast as before.
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

  _handleSetTransit(playerId, { gameId, onTransit }) {
    if (!gameId) return;

    if (this.gameStateManager) {
      this.gameStateManager.setPlayerTransit(gameId, playerId, !!onTransit);
    }

    this.broadcastToGame(gameId, {
      type: 'player_transit',
      gameId,
      playerId,
      onTransit: !!onTransit,
    });
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

  /**
   * Handle a `spot_hider` message from a seeker.
   *
   * The seeker claims they can physically see the hider. The server checks
   * whether the spotter's last known location is within `spotRadiusM` of the
   * hider's last known location.
   *
   * - If confirmed: broadcast `spot_confirmed` to the game and call
   *   `this.onSpotConfirmed(gameId, spotterId)` (which typically calls
   *   `gameLoopManager.finishGame`).
   * - If rejected (out of range or unknown locations): send `spot_rejected`
   *   back to the requesting seeker with the measured distance.
   *
   * @param {object} ws
   * @param {string} playerId
   * @param {{ gameId: string }} message
   */
  _handleSpotHider(ws, playerId, { gameId }) {
    if (!gameId) {
      this._send(ws, { type: 'error', message: 'gameId required' });
      return;
    }

    const gameState = this.gameStateManager
      ? this.gameStateManager.getGameState(gameId)
      : null;

    // Allow tests to inject a stub by setting instance._checkSpotFn.
    const checkSpot = this._checkSpotFn ?? _checkSpotImpl;
    const { spotted, distance } = checkSpot(gameState, playerId, this.spotRadiusM);

    if (spotted) {
      this.broadcastToGame(gameId, { type: 'spot_confirmed', gameId, spotterId: playerId, distanceM: distance });
      if (this.onSpotConfirmed) {
        this.onSpotConfirmed(gameId, playerId);
      }
    } else {
      this._send(ws, {
        type: 'spot_rejected',
        gameId,
        spotterId: playerId,
        distanceM: distance,
        spotRadiusM: this.spotRadiusM,
      });
    }
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
