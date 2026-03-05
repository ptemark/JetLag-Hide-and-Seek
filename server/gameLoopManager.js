/**
 * GameLoopManager — per-game phase lifecycle for the managed game server.
 *
 * Each active game gets an independent tick loop that tracks its phase and
 * automatically advances through the hide-and-seek lifecycle:
 *
 *   waiting → hiding → seeking → finished
 *
 * Rule-specific logic (zone enforcement, capture detection, question handling)
 * is intentionally absent here; this skeleton provides the timing, state
 * transitions, and callback hooks that future rule modules will plug into.
 */

export const GamePhase = Object.freeze({
  WAITING: 'waiting',
  HIDING: 'hiding',
  SEEKING: 'seeking',
  FINISHED: 'finished',
});

export class GameLoopManager {
  /**
   * @param {object} opts
   * @param {number} opts.tickInterval     ms between ticks per game (default 1000)
   * @param {number} opts.hidingDuration   ms allowed for the hiding phase (default 120 000)
   * @param {number} opts.seekingDuration  ms allowed for the seeking phase (default 600 000)
   */
  constructor({
    tickInterval = 1_000,
    hidingDuration = 120_000,
    seekingDuration = 600_000,
  } = {}) {
    this.tickInterval = tickInterval;
    this.hidingDuration = hidingDuration;
    this.seekingDuration = seekingDuration;

    // gameId -> { phase: GamePhase, phaseStartedAt: number, timer: NodeJS.Timeout|null }
    this._games = new Map();

    /**
     * Called whenever a game transitions between phases.
     * Signature: (gameId: string, oldPhase: string, newPhase: string) => void
     */
    this.onPhaseChange = null;

    /**
     * Called on every tick for each active game.
     * Signature: (gameId: string, phase: string) => void
     */
    this.onTick = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a new game and start ticking in the WAITING phase.
   * No-op if the game is already registered.
   */
  startGame(gameId) {
    if (this._games.has(gameId)) return;

    const entry = {
      phase: GamePhase.WAITING,
      phaseStartedAt: Date.now(),
      timer: null,
    };
    this._games.set(gameId, entry);
    entry.timer = setInterval(() => this._tick(gameId), this.tickInterval);
  }

  /**
   * Advance game to the HIDING phase (hiders scatter, hide timer begins).
   * Typically called when all players have joined and the game admin starts.
   */
  beginHiding(gameId) {
    this._transition(gameId, GamePhase.HIDING);
  }

  /**
   * Advance game to the SEEKING phase (hiding time expired, seekers start).
   * Can be called explicitly; also triggered automatically when hidingDuration elapses.
   */
  beginSeeking(gameId) {
    this._transition(gameId, GamePhase.SEEKING);
  }

  /**
   * Mark game as FINISHED and halt its tick loop.
   * Can be called explicitly (seeker catches last hider) or automatically
   * when seekingDuration elapses.
   */
  finishGame(gameId) {
    this._transition(gameId, GamePhase.FINISHED);
    this._clearTimer(gameId);
    this._games.delete(gameId);
  }

  /**
   * Remove a game and stop its tick loop without triggering a phase transition.
   * Use this for cleanup (e.g., all players disconnect).
   */
  stopGame(gameId) {
    this._clearTimer(gameId);
    this._games.delete(gameId);
  }

  /** Return the current phase for a game, or null if not registered. */
  getPhase(gameId) {
    return this._games.get(gameId)?.phase ?? null;
  }

  /** Milliseconds elapsed in the current phase for a game. */
  getPhaseElapsed(gameId) {
    const entry = this._games.get(gameId);
    if (!entry) return 0;
    return Date.now() - entry.phaseStartedAt;
  }

  /** Number of games currently being managed. */
  getActiveGameCount() {
    return this._games.size;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _tick(gameId) {
    const entry = this._games.get(gameId);
    if (!entry) return;

    if (this.onTick) this.onTick(gameId, entry.phase);

    const elapsed = Date.now() - entry.phaseStartedAt;

    if (entry.phase === GamePhase.HIDING && elapsed >= this.hidingDuration) {
      this._transition(gameId, GamePhase.SEEKING);
    } else if (entry.phase === GamePhase.SEEKING && elapsed >= this.seekingDuration) {
      this.finishGame(gameId);
    }
  }

  _transition(gameId, newPhase) {
    const entry = this._games.get(gameId);
    if (!entry) return;

    const oldPhase = entry.phase;
    if (oldPhase === newPhase) return;

    entry.phase = newPhase;
    entry.phaseStartedAt = Date.now();

    if (this.onPhaseChange) this.onPhaseChange(gameId, oldPhase, newPhase);
  }

  _clearTimer(gameId) {
    const entry = this._games.get(gameId);
    if (entry?.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  }
}
