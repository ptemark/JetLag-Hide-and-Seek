/**
 * alerting.js — Alert manager for JetLag failure scenarios.
 *
 * Detects and dispatches alerts for:
 *  - SERVER_CRASH: uncaught exceptions / unhandled promise rejections
 *  - DB_ERROR:     database operation failures (via error-rate threshold)
 *  - CONNECTION_DROP: WebSocket connection errors
 *  - ERROR_RATE_HIGH: cumulative error count exceeds configured threshold
 *  - LOOP_STALL:   game loop stops ticking while active games exist
 *
 * Alerts are dispatched via:
 *  1. Logger at 'error' level (always, if a logger is provided).
 *  2. An optional synchronous `onAlert(type, message, data)` callback.
 *  3. An optional HTTP webhook (fire-and-forget POST, never throws).
 */

import { nullLogger } from './logger.js';

// ── Alert types ───────────────────────────────────────────────────────────────

export const AlertType = Object.freeze({
  SERVER_CRASH:    'SERVER_CRASH',
  DB_ERROR:        'DB_ERROR',
  CONNECTION_DROP: 'CONNECTION_DROP',
  ERROR_RATE_HIGH: 'ERROR_RATE_HIGH',
  LOOP_STALL:      'LOOP_STALL',
});

// ── AlertManager ─────────────────────────────────────────────────────────────

/**
 * Manages alert detection and dispatch for failure scenarios.
 *
 * @example
 * const alertManager = new AlertManager({
 *   logger,
 *   thresholds: { errorRatePerMin: 5 },
 *   webhookUrl: process.env.ALERT_WEBHOOK_URL,
 *   onAlert: (type, message, data) => console.error(type, message, data),
 * });
 *
 * // Wire into server tick:
 * alertManager.checkMetrics(metrics.getSnapshot(), loopRateTracker.getPerMinute(), activeGameCount);
 *
 * // Wire into WebSocket errors:
 * ws.on('error', (err) => alertManager.alert(AlertType.CONNECTION_DROP, 'WS error', { err }));
 *
 * // Wire process-level crashes:
 * alertManager.watchProcess();
 */
export class AlertManager {
  /**
   * @param {object}   opts
   * @param {object}   [opts.logger]              Logger instance (nullLogger safe).
   * @param {object}   [opts.thresholds]          Alert thresholds.
   * @param {number}   [opts.thresholds.errorCount=10]   Fire ERROR_RATE_HIGH when total
   *                                               error count exceeds this value.
   * @param {string}   [opts.webhookUrl='']        HTTP URL to POST alert payloads to.
   * @param {Function} [opts.fetchFn]              Injectable fetch (for testing).
   * @param {Function} [opts.onAlert]              Synchronous callback(type, message, data).
   */
  constructor({
    logger     = nullLogger,
    thresholds = {},
    webhookUrl = '',
    fetchFn    = globalThis.fetch,
    onAlert    = null,
  } = {}) {
    this._logger         = logger;
    this._errorThreshold = thresholds.errorCount ?? 10;
    this._webhookUrl     = webhookUrl;
    this._fetchFn        = fetchFn;
    this._onAlert        = onAlert;

    /**
     * Tracks which alert keys have fired to prevent duplicate alerts within the
     * same threshold interval. Keys are strings like "ERROR_RATE_HIGH:1" where
     * the suffix is the multiple of the threshold that was crossed.
     * @type {Set<string>}
     */
    this._fired = new Set();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Immediately fire an alert of the given type.
   * All registered channels (logger, callback, webhook) are notified.
   *
   * @param {string} type     One of AlertType.*
   * @param {string} message  Human-readable description.
   * @param {object} [data]   Additional context to include in the alert payload.
   */
  alert(type, message, data = {}) {
    this._logger.error('alert', message, { alertType: type, ...data });

    if (typeof this._onAlert === 'function') {
      try {
        this._onAlert(type, message, data);
      } catch {
        // Callback errors must never propagate and affect the game loop.
      }
    }

    if (this._webhookUrl) {
      this._sendWebhook({ type, message, timestamp: new Date().toISOString(), ...data });
    }
  }

  /**
   * Inspect the current metrics snapshot and fire alerts for any threshold violations.
   *
   * Should be called periodically — e.g., once per game tick or once per minute.
   *
   * @param {object} metricsSnapshot       Output of MetricsCollector.getSnapshot().
   * @param {number} loopIterationsPerMin  Current loop rate from RateTracker.getPerMinute().
   * @param {number} activeGameCount       Number of games currently in progress.
   */
  checkMetrics(metricsSnapshot, loopIterationsPerMin, activeGameCount) {
    this._checkErrorRate(metricsSnapshot.errors ?? 0);
    this._checkLoopStall(loopIterationsPerMin, activeGameCount);
  }

  /**
   * Register process-level handlers to fire SERVER_CRASH alerts on uncaught
   * exceptions and unhandled promise rejections.
   *
   * Should be called once at server startup.  Callers are responsible for
   * removing the listeners on shutdown if needed.
   */
  watchProcess() {
    process.on('uncaughtException', (err) => {
      this.alert(AlertType.SERVER_CRASH, 'Uncaught exception', { error: String(err) });
    });
    process.on('unhandledRejection', (reason) => {
      this.alert(AlertType.SERVER_CRASH, 'Unhandled promise rejection', {
        reason: String(reason),
      });
    });
  }

  /**
   * Reset all fired-alert state.
   * Useful after a server restart or when implementing periodic alert windows.
   */
  reset() {
    this._fired.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Fire ERROR_RATE_HIGH once per threshold multiple.
   * e.g., with threshold=10: fires at 11, 21, 31, … errors.
   * @param {number} totalErrors
   */
  _checkErrorRate(totalErrors) {
    if (totalErrors === 0) return;
    const multiple = Math.floor(totalErrors / this._errorThreshold);
    if (multiple === 0) return;

    const key = `${AlertType.ERROR_RATE_HIGH}:${multiple}`;
    if (!this._fired.has(key)) {
      this._fired.add(key);
      this.alert(AlertType.ERROR_RATE_HIGH, 'Error count exceeded threshold', {
        errors:    totalErrors,
        threshold: this._errorThreshold,
        multiple,
      });
    }
  }

  /**
   * Fire LOOP_STALL when active games exist but the loop rate drops to zero.
   * Clears the stall flag automatically once the loop resumes.
   * @param {number} loopIterationsPerMin
   * @param {number} activeGameCount
   */
  _checkLoopStall(loopIterationsPerMin, activeGameCount) {
    const stalled = activeGameCount > 0 && loopIterationsPerMin <= 0;
    if (stalled && !this._fired.has(AlertType.LOOP_STALL)) {
      this._fired.add(AlertType.LOOP_STALL);
      this.alert(AlertType.LOOP_STALL, 'Game loop stalled while games are active', {
        activeGameCount,
        loopIterationsPerMin,
      });
    } else if (!stalled) {
      this._fired.delete(AlertType.LOOP_STALL);
    }
  }

  /**
   * Fire-and-forget HTTP POST to the configured webhook URL.
   * Any network or HTTP error is silently discarded.
   * @param {object} payload
   */
  _sendWebhook(payload) {
    Promise.resolve()
      .then(() =>
        this._fetchFn(this._webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        }),
      )
      .catch(() => {
        // Webhook failures must never impact the game loop.
      });
  }
}

// ── No-op implementation ──────────────────────────────────────────────────────

/**
 * Shared no-op alert manager — safe default when alerting is not configured.
 * All methods are defined but do nothing.
 */
export const nullAlertManager = Object.freeze({
  alert()        {},
  checkMetrics() {},
  watchProcess() {},
  reset()        {},
});
