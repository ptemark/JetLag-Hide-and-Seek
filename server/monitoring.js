/**
 * monitoring.js — External logging/monitoring integration for JetLag.
 *
 * Provides:
 *  - createMonitoringSink(): enriched JSON sink compatible with CloudWatch
 *    Logs, Datadog, and any structured-log aggregator. Adds service metadata
 *    (service name, environment) to every log entry automatically.
 *
 *  - MetricsCollector: lightweight in-memory counter for operational metrics
 *    (loop iterations, active connections, DB reads/writes, errors). Designed
 *    for periodic export to CloudWatch Metrics, Datadog StatsD, or admin API.
 *
 * Log sinks:
 *  - 'stdout' (default): JSON-line written to stdout/stderr — picked up
 *    automatically by CloudWatch Logs (ECS/Fargate awslogs log driver) and
 *    the Datadog Agent container log integration.
 *  - 'http': Each entry is POSTed to LOG_SINK_URL as newline-delimited JSON.
 *    Suitable for the Datadog Logs HTTP API or a custom log ingest endpoint.
 *    Errors are silently swallowed to prevent monitoring from impacting the
 *    game loop.
 *
 * Relevant env vars (server-side only, never exposed to browser):
 *   LOG_SINK          'stdout' | 'http'       (default: 'stdout')
 *   LOG_SINK_URL      HTTP ingest endpoint     (required for 'http' sink)
 *   LOG_SERVICE_NAME  Label added to every entry (default: 'jetlag-server')
 *   LOG_ENV           Environment label        (default: NODE_ENV or 'development')
 */

// ── Metric keys ──────────────────────────────────────────────────────────────

export const MetricKey = Object.freeze({
  LOOP_ITERATIONS:    'loopIterations',
  ACTIVE_CONNECTIONS: 'activeConnections',
  DB_READS:           'dbReads',
  DB_WRITES:          'dbWrites',
  ERRORS:             'errors',
});

// ── MetricsCollector ─────────────────────────────────────────────────────────

/**
 * Lightweight in-memory metric counter.
 *
 * Counters are monotonically increasing integers. Use `getSnapshot()` to
 * capture the current values for export (admin endpoint, periodic push, etc.).
 * Call `reset()` after a snapshot to implement rate-style metrics if needed.
 */
export class MetricsCollector {
  constructor() {
    this._counts = {
      [MetricKey.LOOP_ITERATIONS]:    0,
      [MetricKey.ACTIVE_CONNECTIONS]: 0,
      [MetricKey.DB_READS]:           0,
      [MetricKey.DB_WRITES]:          0,
      [MetricKey.ERRORS]:             0,
    };
  }

  /**
   * Increment a named counter by `delta` (default 1).
   * Unknown keys are silently ignored to keep hot paths allocation-free.
   * @param {string} key   One of MetricKey.*
   * @param {number} delta Increment amount (default 1).
   */
  increment(key, delta = 1) {
    if (Object.prototype.hasOwnProperty.call(this._counts, key)) {
      this._counts[key] += delta;
    }
  }

  /**
   * Set a gauge-style counter to an absolute value.
   * Useful for metrics like activeConnections that go up and down.
   * @param {string} key
   * @param {number} value
   */
  set(key, value) {
    if (Object.prototype.hasOwnProperty.call(this._counts, key)) {
      this._counts[key] = value;
    }
  }

  /**
   * Return a plain-object snapshot of all current counter values.
   * Safe to JSON-serialize and attach to admin or monitoring responses.
   * @returns {object}
   */
  getSnapshot() {
    return { ...this._counts };
  }

  /**
   * Reset all counters to zero.
   * Call after a periodic export to compute per-interval rates.
   */
  reset() {
    for (const key of Object.keys(this._counts)) {
      this._counts[key] = 0;
    }
  }
}

// ── Sink factory ─────────────────────────────────────────────────────────────

/**
 * Build a stdout JSON-line sink that writes to the appropriate stream.
 * info/debug → stdout; warn/error → stderr.
 * @param {object} metadata  Fields to merge into every entry.
 * @returns {Function}
 */
function buildStdoutSink(metadata) {
  return function stdoutSink(entry) {
    const enriched = { ...metadata, ...entry };
    const line = JSON.stringify(enriched);
    if (entry.level === 'warn' || entry.level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  };
}

/**
 * Build an HTTP sink that POSTs each entry to a remote log ingest endpoint.
 * Compatible with the Datadog Logs API and similar HTTP-based collectors.
 *
 * Errors (network failures, non-2xx responses) are silently discarded so
 * that monitoring never blocks or crashes the game loop.
 *
 * @param {object}   metadata   Fields to merge into every entry.
 * @param {string}   url        HTTP endpoint to POST to.
 * @param {Function} fetchFn    Injectable fetch implementation (default: global fetch).
 * @returns {Function}
 */
function buildHttpSink(metadata, url, fetchFn = globalThis.fetch) {
  return function httpSink(entry) {
    const enriched = { ...metadata, ...entry };
    // Fire-and-forget: do not await, do not throw.
    Promise.resolve()
      .then(() =>
        fetchFn(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(enriched),
        }),
      )
      .catch(() => {
        // Silently swallow network/HTTP errors — monitoring must not
        // impact the game loop or trigger cascading failures.
      });
  };
}

/**
 * Create a monitoring-aware log sink.
 *
 * The returned function is a drop-in replacement for the Logger's `sink`
 * option. Every entry routed through it is enriched with the configured
 * service metadata before being forwarded to the underlying transport.
 *
 * @param {object}   opts
 * @param {string}   opts.logSink       'stdout' | 'http' (default: 'stdout').
 * @param {string}   opts.logSinkUrl    Required when logSink === 'http'.
 * @param {string}   opts.serviceName   Service label (default: 'jetlag-server').
 * @param {string}   opts.env           Environment label (default: 'development').
 * @param {Function} [opts.fetchFn]     Injectable fetch for the HTTP sink.
 * @returns {Function}  sink(entry: object) => void
 */
export function createMonitoringSink({
  logSink     = 'stdout',
  logSinkUrl  = '',
  serviceName = 'jetlag-server',
  env         = 'development',
  fetchFn,
} = {}) {
  const metadata = { service: serviceName, env };

  if (logSink === 'http') {
    if (!logSinkUrl) {
      throw new Error(
        'createMonitoringSink: logSinkUrl is required when logSink is "http".',
      );
    }
    return buildHttpSink(metadata, logSinkUrl, fetchFn);
  }

  return buildStdoutSink(metadata);
}
