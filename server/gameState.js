/**
 * GameStateManager — in-memory game state for the managed WebSocket container.
 *
 * Active state lives here while a game is running. Persistent state (game
 * creation, final scores) is owned by the DB layer in db/gameStore.js.
 */
export class GameStateManager {
  constructor() {
    // gameId -> { status: string, players: Map<playerId, PlayerState> }
    this._games = new Map();
  }

  createGame(gameId, { status = 'waiting' } = {}) {
    if (this._games.has(gameId)) return;
    this._games.set(gameId, { status, players: new Map(), zones: [] });
  }

  removeGame(gameId) {
    this._games.delete(gameId);
  }

  hasGame(gameId) {
    return this._games.has(gameId);
  }

  addPlayerToGame(gameId, playerId, role = 'hider') {
    if (!this._games.has(gameId)) {
      this.createGame(gameId);
    }
    const game = this._games.get(gameId);
    if (!game.players.has(playerId)) {
      game.players.set(playerId, { lat: null, lon: null, role });
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

  updatePlayerLocation(gameId, playerId, lat, lon) {
    const game = this._games.get(gameId);
    if (!game) return false;
    const player = game.players.get(playerId);
    if (!player) return false;
    player.lat = lat;
    player.lon = lon;
    return true;
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

  getGameState(gameId) {
    const game = this._games.get(gameId);
    if (!game) return null;
    return {
      gameId,
      status: game.status,
      players: Object.fromEntries(
        Array.from(game.players.entries()).map(([id, data]) => [id, { ...data }])
      ),
    };
  }

  getActiveGameCount() {
    return this._games.size;
  }
}
