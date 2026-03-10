/**
 * rateLimiter.js — Fixed-window rate limiter for serverless API endpoints.
 *
 * Each client key (typically an IP address) is tracked in a Map.  When the
 * current time falls outside the window that started at `windowStart`, the
 * counter resets.  Within a window, once `maxRequests` is reached further
 * calls are rejected until the window expires.
 *
 * Designed for single-process use (serverless function instance).  The store
 * and clock are injectable for deterministic unit testing.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });
 *   const result = limiter.check('203.0.113.42');
 *   if (!result.allowed) { reply 429 }
 */

/**
 * @typedef {Object} RateLimitResult
 * @property {boolean} allowed      - Whether this request is within the limit.
 * @property {number}  remaining    - Requests remaining in the current window.
 * @property {number}  resetAtMs    - Epoch ms when the window resets.
 */

/**
 * Create a new rate limiter instance.
 *
 * @param {object} [opts]
 * @param {number}  [opts.windowMs=60000]    - Window duration in milliseconds.
 * @param {number}  [opts.maxRequests=100]   - Max allowed requests per window.
 * @param {number}  [opts.maxEntries=10000]  - Max tracked client keys before pruning expired entries.
 *                                             Bounds memory usage in warm serverless instances.
 * @param {()=>number} [opts.now]            - Clock function (injectable for tests).
 * @param {Map}     [opts.store]             - Backing store (injectable for tests).
 * @returns {{ check: (key: string) => RateLimitResult, _clear: () => void }}
 */
export function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 100,
  maxEntries = 10_000,
  now = () => Date.now(),
  store = new Map(),
} = {}) {
  /**
   * Evict expired entries when the store exceeds maxEntries.
   * Deletes all entries whose window has already expired.  If the store is
   * still at or above the cap after pruning (all entries are current), the
   * entire store is cleared — this resets all rate-limit counters but
   * prevents unbounded memory growth in warm instances serving many unique IPs.
   *
   * @param {number} currentMs
   */
  function prune(currentMs) {
    if (store.size < maxEntries) return;
    for (const [key, entry] of store) {
      if (currentMs - entry.windowStart >= windowMs) store.delete(key);
    }
    // If still at limit after removing expired entries, clear all.
    if (store.size >= maxEntries) store.clear();
  }

  /**
   * Check whether a request from `key` is within the rate limit.
   * Increments the counter if allowed.
   *
   * @param {string} key - Client identifier (e.g. IP address).
   * @returns {RateLimitResult}
   */
  function check(key) {
    const currentMs = now();
    const entry = store.get(key);

    if (!entry || currentMs - entry.windowStart >= windowMs) {
      // New window — prune stale entries before inserting to bound memory.
      prune(currentMs);
      const windowStart = currentMs;
      store.set(key, { count: 1, windowStart });
      return { allowed: true, remaining: maxRequests - 1, resetAtMs: windowStart + windowMs };
    }

    const { count, windowStart } = entry;
    const resetAtMs = windowStart + windowMs;

    if (count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAtMs };
    }

    store.set(key, { count: count + 1, windowStart });
    return { allowed: true, remaining: maxRequests - count - 1, resetAtMs };
  }

  /** Clear all tracking state (for test isolation). */
  function _clear() {
    store.clear();
  }

  return { check, _clear };
}

/** Shared default limiter (100 req / 60 s per client). */
export const defaultLimiter = createRateLimiter();
