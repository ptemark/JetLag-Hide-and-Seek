/**
 * GameStateManager — in-memory game state for the managed WebSocket container.
 *
 * Active state lives here while a game is running. Persistent state (game
 * creation, final scores) is owned by the DB layer in db/gameStore.js.
 */
export class GameStateManager {
  constructor() {
    // gameId -> { status: string, seekerTeams: number, players: Map<playerId, PlayerState> }
    this._games = new Map();
  }

  createGame(gameId, { status = 'waiting', seekerTeams = 0, bounds = null } = {}) {
    if (this._games.has(gameId)) return;
    this._games.set(gameId, { status, seekerTeams, players: new Map(), zones: [], endGameActive: false, bounds });
  }

  setSeekerTeams(gameId, seekerTeams) {
    const game = this._games.get(gameId);
    if (!game) return false;
    game.seekerTeams = seekerTeams;
    return true;
  }

  getSeekerTeams(gameId) {
    return this._games.get(gameId)?.seekerTeams ?? 0;
  }

  removeGame(gameId) {
    this._games.delete(gameId);
  }

  hasGame(gameId) {
    return this._games.has(gameId);
  }

  setEndGameActive(gameId, active) {
    const game = this._games.get(gameId);
    if (!game) return false;
    game.endGameActive = !!active;
    return true;
  }

  isEndGameActive(gameId) {
    return this._games.get(gameId)?.endGameActive ?? false;
  }

  getPlayerRole(gameId, playerId) {
    return this._games.get(gameId)?.players.get(playerId)?.role ?? null;
  }

  /**
   * Return the playerId of the current hider in a game, or null if none has
   * joined yet.  Used to enforce the one-hider-per-game rule.
   */
  getHiderId(gameId) {
    const game = this._games.get(gameId);
    if (!game) return null;
    for (const [pid, data] of game.players.entries()) {
      if (data.role === 'hider') return pid;
    }
    return null;
  }

  /** Return hider and seeker counts for a game (both 0 when game not found). */
  getPlayerCounts(gameId) {
    const game = this._games.get(gameId);
    if (!game) return { hiderCount: 0, seekerCount: 0 };
    let hiderCount = 0;
    let seekerCount = 0;
    for (const data of game.players.values()) {
      if (data.role === 'hider')  hiderCount++;
      if (data.role === 'seeker') seekerCount++;
    }
    return { hiderCount, seekerCount };
  }

  addPlayerToGame(gameId, playerId, role = 'hider', team = null) {
    if (!this._games.has(gameId)) {
      this.createGame(gameId);
    }
    const game = this._games.get(gameId);
    if (role === 'hider') {
      const existingHiderId = this.getHiderId(gameId);
      if (existingHiderId !== null && existingHiderId !== playerId) {
        throw new Error('HIDER_SLOT_TAKEN');
      }
    }
    if (!game.players.has(playerId)) {
      game.players.set(playerId, { lat: null, lon: null, role, team, onTransit: false, previousLocation: null });
    }
  }

  removePlayerFromGame(gameId, playerId) {
    const game = this._games.get(gameId);
    if (!game) return;
    game.players.delete(playerId);
    if (game.players.size === 0) {
      this._games.delete(gameId);
    }
  }

  setPlayerTransit(gameId, playerId, onTransit) {
    const game = this._games.get(gameId);
    if (!game) return false;
    const player = game.players.get(playerId);
    if (!player) return false;
    player.onTransit = !!onTransit;
    return true;
  }

  getPlayerTransit(gameId, playerId) {
    return this._games.get(gameId)?.players.get(playerId)?.onTransit ?? false;
  }

  updatePlayerLocation(gameId, playerId, lat, lon) {
    const game = this._games.get(gameId);
    if (!game) return false;
    const player = game.players.get(playerId);
    if (!player) return false;
    player.previousLocation = (player.lat != null && player.lon != null)
      ? { lat: player.lat, lon: player.lon }
      : null;
    player.lat = lat;
    player.lon = lon;
    return true;
  }

  getPreviousPlayerLocation(gameId, playerId) {
    return this._games.get(gameId)?.players.get(playerId)?.previousLocation ?? null;
  }

  getGameStatus(gameId) {
    return this._games.get(gameId)?.status ?? null;
  }

  setGameStatus(gameId, status) {
    const game = this._games.get(gameId);
    if (!game) return false;
    game.status = status;
    return true;
  }

  setGameZones(gameId, zones) {
    const game = this._games.get(gameId);
    if (!game) return false;
    game.zones = zones;
    return true;
  }

  getGameZones(gameId) {
    return this._games.get(gameId)?.zones ?? [];
  }

  setGameBounds(gameId, bounds) {
    const game = this._games.get(gameId);
    if (!game) return false;
    game.bounds = bounds;
    return true;
  }

  getGameBounds(gameId) {
    return this._games.get(gameId)?.bounds ?? null;
  }

  getGameState(gameId) {
    const game = this._games.get(gameId);
    if (!game) return null;
    return {
      gameId,
      status: game.status,
      seekerTeams: game.seekerTeams,
      players: Object.fromEntries(
        Array.from(game.players.entries()).map(([id, data]) => [id, { ...data }])
      ),
    };
  }

  getActiveGameCount() {
    return this._games.size;
  }
}
