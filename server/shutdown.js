/**
 * shutdown.js — Graceful shutdown manager for the JetLag managed game server.
 *
 * Coordinates two shutdown paths:
 *
 *  1. Idle-triggered shutdown: when the server reports idle (no active games),
 *     an optional grace period (idleDelayMs) runs before shutdown is executed.
 *     If the server becomes active again within that window the timer is
 *     cancelled — preventing unnecessary restarts on brief idle gaps.
 *
 *  2. Signal-triggered shutdown: SIGTERM and SIGINT are caught so that
 *     container orchestrators (Docker stop, Kubernetes, Fly.io) receive a
 *     clean process exit rather than a hard kill after a timeout.
 *
 * Cleanup callbacks registered via `onCleanup()` are awaited in order before
 * `process.exit()` is called, allowing resources such as DB pools and file
 * handles to be released cleanly.
 *
 * @example
 * const shutdown = new ShutdownManager({
 *   stopFn:     () => server.stop(),
 *   idleDelayMs: 30_000,   // 30 s grace period
 *   logger,
 * });
 * shutdown.watchSignals();
 * server.onIdle(()   => shutdown.onIdle());
 * server.onActive(() => shutdown.onActive());
 */

import { nullLogger, LogCategory } from './logger.js';

export class ShutdownManager {
  /**
   * @param {object}   opts
   * @param {Function} opts.stopFn
   *   Async function that stops the server (closes HTTP + WebSocket servers).
   * @param {number}   [opts.idleDelayMs=0]
   *   Grace period in ms after going idle before shutdown is triggered.
   *   0 (default) means shut down immediately when idle.
   * @param {object}   [opts.logger]
   *   Logger instance (nullLogger safe).
   * @param {Function} [opts.exitFn]
   *   Injectable exit function for testing (default: process.exit).
   * @param {Function} [opts.setTimeoutFn]
   *   Injectable setTimeout for testing.
   * @param {Function} [opts.clearTimeoutFn]
   *   Injectable clearTimeout for testing.
   * @param {object}   [opts.processRef]
   *   Injectable process reference for testing.
   */
  constructor({
    stopFn,
    idleDelayMs    = 0,
    logger         = nullLogger,
    exitFn         = (code) => process.exit(code),
    setTimeoutFn   = setTimeout,
    clearTimeoutFn = clearTimeout,
    processRef     = process,
  } = {}) {
    this._stopFn        = stopFn;
    this._idleDelayMs   = idleDelayMs;
    this._logger        = logger;
    this._exitFn        = exitFn;
    this._setTimeoutFn  = setTimeoutFn;
    this._clearTimeoutFn = clearTimeoutFn;
    this._processRef    = processRef;

    /** @type {Array<() => void | Promise<void>>} */
    this._cleanupFns = [];
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._idleTimer  = null;
    this._shutting   = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Register an async cleanup function to run before process exit.
   * Functions are called in registration order; errors are swallowed so that
   * one failing cleanup cannot block the others.
   *
   * @param {() => void | Promise<void>} fn
   */
  onCleanup(fn) {
    this._cleanupFns.push(fn);
  }

  /**
   * Wire SIGTERM and SIGINT handlers so the process exits cleanly when the
   * container orchestrator sends a stop signal.  Safe to call multiple times
   * (handlers are registered with `once`).
   */
  watchSignals() {
    this._processRef.once('SIGTERM', () => this._shutdown('SIGTERM'));
    this._processRef.once('SIGINT',  () => this._shutdown('SIGINT'));
  }

  /**
   * Call this when the server transitions to idle (last game ended).
   * Starts the idle-shutdown countdown; does nothing if already shutting down
   * or if a countdown is already running.
   */
  onIdle() {
    if (this._shutting || this._idleTimer !== null) return;

    if (this._idleDelayMs <= 0) {
      return this._shutdown('idle');
    }

    this._logger.info(LogCategory.SERVER, 'shutdown_idle_countdown', {
      delayMs: this._idleDelayMs,
    });
    this._idleTimer = this._setTimeoutFn(() => {
      this._idleTimer = null;
      this._shutdown('idle');
    }, this._idleDelayMs);
  }

  /**
   * Call this when the server transitions to active (first game started).
   * Cancels any pending idle-shutdown countdown so the server stays alive.
   */
  onActive() {
    if (this._idleTimer !== null) {
      this._clearTimeoutFn(this._idleTimer);
      this._idleTimer = null;
      this._logger.info(LogCategory.SERVER, 'shutdown_idle_cancelled');
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Execute the shutdown sequence:
   *  1. Stop the HTTP / WebSocket server.
   *  2. Run registered cleanup callbacks.
   *  3. Exit the process.
   *
   * Re-entrant calls are ignored once shutdown has started.
   *
   * @param {string} reason  Human-readable trigger label (idle | SIGTERM | SIGINT).
   */
  async _shutdown(reason) {
    if (this._shutting) return;
    this._shutting = true;

    this._logger.info(LogCategory.SERVER, 'shutdown_started', { reason });

    try {
      await this._stopFn();
    } catch (err) {
      this._logger.error(LogCategory.SERVER, 'shutdown_stop_error', {
        error: String(err),
      });
    }

    for (const fn of this._cleanupFns) {
      try {
        await fn();
      } catch {
        // Best-effort: cleanup errors must not block process exit.
      }
    }

    this._logger.info(LogCategory.SERVER, 'shutdown_complete', { reason });
    this._exitFn(0);
  }
}
