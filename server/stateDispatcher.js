/**
 * StateDispatcher — bridges the game loop to computation tasks.
 *
 * On each dispatch call the dispatcher:
 *   1. Receives the current game state snapshot.
 *   2. Selects registered tasks for the game's current phase (and global '*' tasks).
 *   3. Invokes each task concurrently and collects results.
 *   4. Emits results via the onDispatch callback.
 *
 * Tasks are plain (sync or async) functions with signature:
 *   (gameState: object) => any | Promise<any>
 *
 * Task errors are isolated — one failing task does not abort others.
 * Results include both successful return values and caught errors.
 */
import { nullLogger, LogCategory } from './logger.js';

export class StateDispatcher {
  /**
   * @param {object} opts
   * @param {import('./logger.js').Logger} opts.logger  Injected logger instance.
   */
  constructor({ logger = nullLogger } = {}) {
    this._logger = logger;
    // phase -> Array<{ name: string, fn: Function }>  // '*' means the task runs on every phase
    this._tasks = new Map();

    /**
     * Called after each dispatch completes.
     * Signature: (gameId: string, phase: string, results: TaskResult[]) => void
     *
     * TaskResult: { name: string, status: 'ok'|'error', value?: any, error?: Error }
     */
    this.onDispatch = null;
  }

  // ── Task Registration ──────────────────────────────────────────────────────

  /**
   * Register a computation task.
   *
   * @param {string}   phase  Phase name (e.g. 'hiding', 'seeking') or '*' for all phases.
   * @param {string}   name   Unique task name within the phase bucket (for logging/results).
   * @param {Function} fn     Task function: (gameState) => any | Promise<any>
   */
  register(phase, name, fn) {
    if (typeof fn !== 'function') throw new TypeError('Task fn must be a function');
    if (!this._tasks.has(phase)) {
      this._tasks.set(phase, []);
    }
    this._tasks.get(phase).push({ name, fn });
  }

  /**
   * Remove all tasks registered under the given phase bucket.
   * Useful for resetting between test cases.
   */
  clearPhase(phase) {
    this._tasks.delete(phase);
  }

  /** Remove every registered task. */
  clearAll() {
    this._tasks.clear();
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  /**
   * Dispatch computation tasks for the given game state.
   *
   * Runs all tasks registered for gameState.status plus all '*' tasks,
   * then fires onDispatch with the collected results.
   *
   * @param   {object}          gameState  Snapshot from GameStateManager.getGameState()
   * @returns {Promise<Array>}             Resolved TaskResult array.
   */
  async dispatch(gameState) {
    if (!gameState) return [];

    const { gameId, status: phase } = gameState;
    const bucket = [
      ...(this._tasks.get('*') ?? []),
      ...(this._tasks.get(phase) ?? []),
    ];

    const timer = this._logger.startTimer();

    const results = await Promise.all(
      bucket.map(({ name, fn }) => this._run(name, fn, gameState))
    );

    timer.end(LogCategory.PERF, 'dispatch_complete', { gameId, phase, taskCount: bucket.length });

    if (this.onDispatch) {
      this.onDispatch(gameId, phase, results);
    }

    return results;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  async _run(name, fn, gameState) {
    try {
      const value = await fn(gameState);
      return { name, status: 'ok', value };
    } catch (error) {
      this._logger.error(LogCategory.ERROR, 'task_error', {
        gameId: gameState.gameId,
        taskName: name,
        errorMessage: error?.message ?? String(error),
      });
      return { name, status: 'error', error };
    }
  }
}
