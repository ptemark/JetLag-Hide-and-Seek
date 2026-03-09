/**
 * autoScaler.js — Activity-based auto-scaling for JetLag managed servers.
 *
 * Monitors active game count and WebSocket connection count against configurable
 * high-water / low-water thresholds and dispatches scale-up or scale-down
 * events when thresholds are crossed.
 *
 * A cooldown period (default 60 s) prevents flapping: once a direction fires,
 * the same direction cannot fire again until the cooldown has elapsed.
 *
 * Scale events are dispatched via:
 *  1. Logger at 'info' level (always, if a logger is provided).
 *  2. An optional synchronous `onScale(direction, reason, data)` callback.
 *  3. An optional HTTP webhook (fire-and-forget POST, never throws).
 *
 * @example
 * const scaler = new AutoScaler({
 *   thresholds: { scaleUpGames: 5, scaleUpConnections: 20 },
 *   cooldownMs: 60_000,
 *   webhookUrl: process.env.SCALE_WEBHOOK_URL,
 *   onScale: (dir, reason, data) => console.log(dir, reason, data),
 * });
 *
 * // Call on every game tick:
 * scaler.check(gameLoopManager.getActiveGameCount(), wsHandler.getConnectedCount());
 */

import { nullLogger, LogCategory } from './logger.js';

// ── Scale directions ──────────────────────────────────────────────────────────

export const ScaleDirection = Object.freeze({
  UP:   'up',
  DOWN: 'down',
});

// ── AutoScaler ────────────────────────────────────────────────────────────────

export class AutoScaler {
  /**
   * @param {object}   opts
   * @param {object}   [opts.thresholds]
   * @param {number}   [opts.thresholds.scaleUpGames=5]
   *   Active game count at or above which scale-up fires.
   * @param {number}   [opts.thresholds.scaleUpConnections=20]
   *   Connection count at or above which scale-up fires.
   * @param {number}   [opts.thresholds.scaleDownGames=0]
   *   Active game count at or below which scale-down may fire (both must be ≤).
   * @param {number}   [opts.thresholds.scaleDownConnections=0]
   *   Connection count at or below which scale-down may fire (both must be ≤).
   * @param {number}   [opts.cooldownMs=60000]
   *   Minimum ms between consecutive events of the same direction.
   * @param {string}   [opts.webhookUrl='']
   *   HTTP URL to POST scale events to (empty = disabled).
   * @param {Function} [opts.fetchFn]
   *   Injectable fetch for testing (default: globalThis.fetch).
   * @param {Function} [opts.onScale]
   *   Synchronous callback: (direction, reason, data) => void.
   * @param {object}   [opts.logger]
   *   Logger instance (nullLogger safe).
   * @param {Function} [opts.nowFn]
   *   Injectable clock for testing (default: Date.now).
   */
  constructor({
    thresholds = {},
    cooldownMs = 60_000,
    webhookUrl = '',
    fetchFn    = globalThis.fetch,
    onScale    = null,
    logger     = nullLogger,
    nowFn      = Date.now,
  } = {}) {
    this._scaleUpGames        = thresholds.scaleUpGames        ?? 5;
    this._scaleUpConnections  = thresholds.scaleUpConnections  ?? 20;
    this._scaleDownGames      = thresholds.scaleDownGames      ?? 0;
    this._scaleDownConnections = thresholds.scaleDownConnections ?? 0;
    this._cooldownMs          = cooldownMs;
    this._webhookUrl          = webhookUrl;
    this._fetchFn             = fetchFn;
    this._onScale             = onScale;
    this._logger              = logger;
    this._nowFn               = nowFn;

    /** @type {Map<string, number>}  direction → last-fired epoch ms */
    this._lastFired = new Map();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Evaluate current load against thresholds and fire a scale event if needed.
   *
   * Scale-up fires when:
   *   activeGames >= scaleUpGames  OR  activeConnections >= scaleUpConnections
   *
   * Scale-down fires when:
   *   activeGames <= scaleDownGames  AND  activeConnections <= scaleDownConnections
   *
   * Neither direction fires if the cooldown period has not yet elapsed.
   *
   * @param {number} activeGames        Number of games currently being managed.
   * @param {number} activeConnections  Number of connected WebSocket clients.
   */
  check(activeGames, activeConnections) {
    const needsUp   = activeGames >= this._scaleUpGames
                   || activeConnections >= this._scaleUpConnections;
    const needsDown = activeGames <= this._scaleDownGames
                   && activeConnections <= this._scaleDownConnections;

    if (needsUp && this._canFire(ScaleDirection.UP)) {
      const reason = activeGames >= this._scaleUpGames
        ? `activeGames (${activeGames}) reached threshold (${this._scaleUpGames})`
        : `activeConnections (${activeConnections}) reached threshold (${this._scaleUpConnections})`;
      this._fire(ScaleDirection.UP, reason, { activeGames, activeConnections });
    } else if (needsDown && !needsUp && this._canFire(ScaleDirection.DOWN)) {
      const reason = `activeGames (${activeGames}) and activeConnections (${activeConnections}) at or below low-water marks`;
      this._fire(ScaleDirection.DOWN, reason, { activeGames, activeConnections });
    }
  }

  /**
   * Reset all cooldown state.
   * Useful in tests or after an explicit manual scaling operation.
   */
  reset() {
    this._lastFired.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * @param {string} direction  ScaleDirection.*
   * @returns {boolean}  true if enough time has elapsed since last fire.
   */
  _canFire(direction) {
    const last = this._lastFired.get(direction) ?? -Infinity;
    return (this._nowFn() - last) >= this._cooldownMs;
  }

  /**
   * Dispatch a scale event: logger + callback + optional webhook.
   * @param {string} direction
   * @param {string} reason
   * @param {object} data
   */
  _fire(direction, reason, data) {
    this._lastFired.set(direction, this._nowFn());

    this._logger.info(LogCategory.SERVER, 'autoscale', { direction, reason, ...data });

    if (typeof this._onScale === 'function') {
      try {
        this._onScale(direction, reason, data);
      } catch {
        // Callback errors must never propagate to the game loop.
      }
    }

    if (this._webhookUrl) {
      this._sendWebhook({ direction, reason, timestamp: new Date().toISOString(), ...data });
    }
  }

  /**
   * Fire-and-forget POST to the configured webhook URL.
   * Any error is silently discarded so scaling never impacts the game loop.
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
        // Webhook errors must not affect the game loop.
      });
  }
}

// ── No-op implementation ──────────────────────────────────────────────────────

/**
 * Shared no-op auto-scaler — safe default when scaling is not configured.
 * All methods are defined but do nothing.
 */
export const nullAutoScaler = Object.freeze({
  check() {},
  reset() {},
});
