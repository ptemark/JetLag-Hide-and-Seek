export const GameLoopStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
});

export class GameLoop {
  constructor(tickInterval = 1000) {
    this.tickInterval = tickInterval;
    this.status = GameLoopStatus.IDLE;
    this.activePlayers = new Set();
    this._timer = null;
    this.onTick = null;
  }

  start() {
    if (this.status === GameLoopStatus.RUNNING) return;
    this.status = GameLoopStatus.RUNNING;
    this._timer = setInterval(() => this._tick(), this.tickInterval);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.status = GameLoopStatus.IDLE;
    this.activePlayers.clear();
  }

  addPlayer(playerId) {
    this.activePlayers.add(playerId);
    if (this.status !== GameLoopStatus.RUNNING) {
      this.start();
    }
  }

  removePlayer(playerId) {
    this.activePlayers.delete(playerId);
    if (this.activePlayers.size === 0) {
      this.stop();
    }
  }

  getPlayerCount() {
    return this.activePlayers.size;
  }

  _tick() {
    if (this.onTick) this.onTick();
  }
}
