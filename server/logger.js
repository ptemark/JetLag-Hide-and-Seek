/**
 * Logger — structured, level-filtered logger for the JetLag managed server.
 *
 * Emits JSON-line entries to a configurable sink so that:
 *   - Loop iterations, phase changes, and lifecycle events are traceable.
 *   - Task errors are captured with context (game, phase, task name).
 *   - Performance-sensitive paths can be timed and logged at the debug level.
 *
 * The sink is injectable, making the logger fully testable without touching
 * stdout/stderr.
 */

export const LogLevel = Object.freeze({
  DEBUG: 'debug',
  INFO:  'info',
  WARN:  'warn',
  ERROR: 'error',
});

export const LogCategory = Object.freeze({
  LOOP:   'loop',
  PERF:   'perf',
  ERROR:  'error',
  SERVER: 'server',
});

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Default sink — writes JSON lines to the appropriate Node.js stream.
 * info/debug → stdout; warn/error → stderr.
 * @param {object} entry
 */
function defaultSink(entry) {
  const line = JSON.stringify(entry);
  if (entry.level === LogLevel.WARN || entry.level === LogLevel.ERROR) {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export class Logger {
  /**
   * @param {object}   opts
   * @param {string}   opts.level   Minimum level to emit (default 'info').
   * @param {Function} opts.sink    fn(entry: object) — receives each log entry.
   *                                Defaults to JSON-line stdout/stderr writer.
   */
  constructor({ level = LogLevel.INFO, sink = defaultSink } = {}) {
    if (LEVEL_RANK[level] === undefined) {
      throw new RangeError(`Unknown log level: ${level}`);
    }
    this._minRank = LEVEL_RANK[level];
    this._sink = sink;
  }

  // ── Level helpers ──────────────────────────────────────────────────────────

  debug(category, message, data = {}) {
    this._emit(LogLevel.DEBUG, category, message, data);
  }

  info(category, message, data = {}) {
    this._emit(LogLevel.INFO, category, message, data);
  }

  warn(category, message, data = {}) {
    this._emit(LogLevel.WARN, category, message, data);
  }

  error(category, message, data = {}) {
    this._emit(LogLevel.ERROR, category, message, data);
  }

  // ── Performance timer ─────────────────────────────────────────────────────

  /**
   * Start a performance timer.
   * Returns a timer object whose `.end(category, message, data)` method logs
   * the elapsed milliseconds at the 'debug' level.
   *
   * @returns {{ end: (category: string, message: string, data?: object) => void }}
   */
  startTimer() {
    const startedAt = Date.now();
    return {
      end: (category, message, data = {}) => {
        this._emit(LogLevel.DEBUG, category, message, {
          ...data,
          elapsedMs: Date.now() - startedAt,
        });
      },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _emit(level, category, message, data) {
    if (LEVEL_RANK[level] < this._minRank) return;
    this._sink({
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      ...data,
    });
  }
}

/**
 * Shared no-op logger — used as a safe default when callers do not inject one.
 * All methods are defined but do nothing, keeping the hot path allocation-free.
 */
export const nullLogger = Object.freeze({
  debug:       () => {},
  info:        () => {},
  warn:        () => {},
  error:       () => {},
  startTimer:  () => ({ end: () => {} }),
});
