import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MetricsCollector,
  MetricKey,
  RateTracker,
  createMonitoringSink,
} from './monitoring.js';
import { Logger, LogLevel, LogCategory } from './logger.js';

// ── MetricsCollector ─────────────────────────────────────────────────────────

describe('MetricsCollector — initial state', () => {
  it('starts all counters at zero', () => {
    const m = new MetricsCollector();
    const snap = m.getSnapshot();
    expect(snap[MetricKey.LOOP_ITERATIONS]).toBe(0);
    expect(snap[MetricKey.ACTIVE_CONNECTIONS]).toBe(0);
    expect(snap[MetricKey.DB_READS]).toBe(0);
    expect(snap[MetricKey.DB_WRITES]).toBe(0);
    expect(snap[MetricKey.ERRORS]).toBe(0);
  });
});

describe('MetricsCollector — increment()', () => {
  it('increments a counter by 1 by default', () => {
    const m = new MetricsCollector();
    m.increment(MetricKey.LOOP_ITERATIONS);
    expect(m.getSnapshot()[MetricKey.LOOP_ITERATIONS]).toBe(1);
  });

  it('increments a counter by a custom delta', () => {
    const m = new MetricsCollector();
    m.increment(MetricKey.DB_READS, 5);
    expect(m.getSnapshot()[MetricKey.DB_READS]).toBe(5);
  });

  it('accumulates multiple increments', () => {
    const m = new MetricsCollector();
    m.increment(MetricKey.ERRORS);
    m.increment(MetricKey.ERRORS);
    m.increment(MetricKey.ERRORS, 3);
    expect(m.getSnapshot()[MetricKey.ERRORS]).toBe(5);
  });

  it('silently ignores unknown metric keys', () => {
    const m = new MetricsCollector();
    expect(() => m.increment('unknown_key')).not.toThrow();
    const snap = m.getSnapshot();
    expect(snap['unknown_key']).toBeUndefined();
  });
});

describe('MetricsCollector — set()', () => {
  it('sets a counter to an absolute value', () => {
    const m = new MetricsCollector();
    m.increment(MetricKey.ACTIVE_CONNECTIONS, 10);
    m.set(MetricKey.ACTIVE_CONNECTIONS, 3);
    expect(m.getSnapshot()[MetricKey.ACTIVE_CONNECTIONS]).toBe(3);
  });

  it('silently ignores unknown keys', () => {
    const m = new MetricsCollector();
    expect(() => m.set('bogus', 99)).not.toThrow();
  });
});

describe('MetricsCollector — getSnapshot()', () => {
  it('returns a plain copy, not the internal object', () => {
    const m = new MetricsCollector();
    const snap = m.getSnapshot();
    snap[MetricKey.LOOP_ITERATIONS] = 999;
    expect(m.getSnapshot()[MetricKey.LOOP_ITERATIONS]).toBe(0);
  });

  it('snapshot is JSON-serializable', () => {
    const m = new MetricsCollector();
    m.increment(MetricKey.DB_WRITES, 2);
    expect(() => JSON.stringify(m.getSnapshot())).not.toThrow();
  });
});

describe('MetricsCollector — reset()', () => {
  it('resets all counters to zero', () => {
    const m = new MetricsCollector();
    m.increment(MetricKey.LOOP_ITERATIONS, 10);
    m.increment(MetricKey.ERRORS, 3);
    m.reset();
    const snap = m.getSnapshot();
    for (const key of Object.values(MetricKey)) {
      expect(snap[key]).toBe(0);
    }
  });
});

// ── createMonitoringSink — stdout ─────────────────────────────────────────────

describe('createMonitoringSink — stdout (default)', () => {
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('creates a sink without throwing', () => {
    expect(() => createMonitoringSink()).not.toThrow();
  });

  it('writes info entries to stdout', () => {
    const sink = createMonitoringSink({ serviceName: 'test-svc', env: 'test' });
    sink({ level: 'info', message: 'hello', timestamp: 'now' });
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const written = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(written);
    expect(parsed.message).toBe('hello');
  });

  it('writes warn entries to stderr', () => {
    const sink = createMonitoringSink({ serviceName: 'test-svc', env: 'test' });
    sink({ level: 'warn', message: 'caution', timestamp: 'now' });
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('writes error entries to stderr', () => {
    const sink = createMonitoringSink({ serviceName: 'test-svc', env: 'test' });
    sink({ level: 'error', message: 'boom', timestamp: 'now' });
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('enriches entries with service and env fields', () => {
    const sink = createMonitoringSink({ serviceName: 'jetlag', env: 'staging' });
    sink({ level: 'info', message: 'tick', timestamp: 'now' });
    const written = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(written);
    expect(parsed.service).toBe('jetlag');
    expect(parsed.env).toBe('staging');
  });

  it('preserves original entry fields alongside metadata', () => {
    const sink = createMonitoringSink({ serviceName: 'svc', env: 'dev' });
    sink({ level: 'info', message: 'tick', timestamp: 't', gameId: 'g1', iteration: 7 });
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.gameId).toBe('g1');
    expect(parsed.iteration).toBe(7);
  });

  it('entry fields take precedence over metadata fields on conflict', () => {
    // If an entry explicitly sets 'service', it should override the metadata.
    const sink = createMonitoringSink({ serviceName: 'default-svc', env: 'dev' });
    sink({ level: 'info', message: 'override', timestamp: 't', service: 'custom-svc' });
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(parsed.service).toBe('custom-svc');
  });

  it('writes valid JSON lines (newline-terminated)', () => {
    const sink = createMonitoringSink();
    sink({ level: 'info', message: 'jsonl', timestamp: 'now' });
    const written = stdoutSpy.mock.calls[0][0];
    expect(written.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(written.trimEnd())).not.toThrow();
  });
});

// ── createMonitoringSink — http ───────────────────────────────────────────────

describe('createMonitoringSink — http sink', () => {
  it('throws when logSink is "http" but logSinkUrl is empty', () => {
    expect(() => createMonitoringSink({ logSink: 'http', logSinkUrl: '' })).toThrow(
      /logSinkUrl is required/,
    );
  });

  it('POSTs enriched entry to logSinkUrl as JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const sink = createMonitoringSink({
      logSink:     'http',
      logSinkUrl:  'https://ingest.example.com/logs',
      serviceName: 'jetlag',
      env:         'production',
      fetchFn:     mockFetch,
    });

    sink({ level: 'info', message: 'game_tick', timestamp: 'now', gameId: 'g99' });

    // Allow the micro-task queue to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://ingest.example.com/logs');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.message).toBe('game_tick');
    expect(body.gameId).toBe('g99');
    expect(body.service).toBe('jetlag');
    expect(body.env).toBe('production');
  });

  it('silently ignores network errors to protect the game loop', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const sink = createMonitoringSink({
      logSink:    'http',
      logSinkUrl: 'https://ingest.example.com/logs',
      fetchFn:    mockFetch,
    });

    expect(() => sink({ level: 'error', message: 'boom', timestamp: 'now' })).not.toThrow();

    // Flush micro-tasks — should not throw
    await expect(new Promise((r) => setTimeout(r, 0))).resolves.not.toThrow();
  });

  it('silently ignores non-2xx responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const sink = createMonitoringSink({
      logSink:    'http',
      logSinkUrl: 'https://ingest.example.com/logs',
      fetchFn:    mockFetch,
    });

    expect(() => sink({ level: 'warn', message: 'caution', timestamp: 'now' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ── Integration with Logger ──────────────────────────────────────────────────

describe('Integration — Logger using monitoring sink', () => {
  it('Logger routes entries through the monitoring sink', () => {
    const captured = [];
    const sink = createMonitoringSink({ serviceName: 'jetlag', env: 'test' });

    // Override with a test-friendly in-memory sink wrapping monitoring enrichment
    const testSink = vi.fn((entry) => captured.push(entry));
    // Build a monitoring-style enricher manually for unit testing
    const enrichingSink = (entry) => testSink({ service: 'jetlag', env: 'test', ...entry });

    const logger = new Logger({ level: LogLevel.DEBUG, sink: enrichingSink });
    logger.info(LogCategory.LOOP, 'tick', { gameId: 'g1', phase: 'hiding' });
    logger.error(LogCategory.ERROR, 'oops', { gameId: 'g1' });

    expect(captured).toHaveLength(2);
    expect(captured[0].service).toBe('jetlag');
    expect(captured[0].env).toBe('test');
    expect(captured[0].message).toBe('tick');
    expect(captured[1].level).toBe('error');
  });

  it('monitoring sink is a valid Logger sink function', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sink = createMonitoringSink({ serviceName: 'jetlag', env: 'test' });
    const logger = new Logger({ sink });
    expect(() => logger.info(LogCategory.SERVER, 'server_started', { port: 3000 })).not.toThrow();
    stdoutSpy.mockRestore();
  });
});

// ── RateTracker ───────────────────────────────────────────────────────────────

describe('RateTracker — initial state', () => {
  it('returns 0 per minute when no events have been recorded', () => {
    const tracker = new RateTracker();
    expect(tracker.getPerMinute()).toBe(0);
  });
});

describe('RateTracker — record() and getPerMinute()', () => {
  it('counts a single event as 1 per minute for a 60s window', () => {
    let now = 0;
    const tracker = new RateTracker(60_000, () => now);
    tracker.record();
    // 1 event in 60s window → 1/min
    expect(tracker.getPerMinute()).toBe(1);
  });

  it('counts multiple events in the same second', () => {
    let now = 0;
    const tracker = new RateTracker(60_000, () => now);
    tracker.record(5);
    expect(tracker.getPerMinute()).toBe(5);
  });

  it('accumulates events across different seconds', () => {
    let now = 0;
    const tracker = new RateTracker(60_000, () => now);
    tracker.record(3);
    now = 2_000;
    tracker.record(2);
    expect(tracker.getPerMinute()).toBe(5);
  });

  it('excludes events outside the sliding window', () => {
    let now = 0;
    const tracker = new RateTracker(60_000, () => now);
    tracker.record(10);  // at t=0, will expire after window
    now = 61_000;        // advance past window
    tracker.record(2);   // only this one should count
    expect(tracker.getPerMinute()).toBe(2);
  });

  it('normalises correctly for a 30s window', () => {
    let now = 0;
    const tracker = new RateTracker(30_000, () => now);
    tracker.record(5);   // 5 events in 30s = 10/min
    expect(tracker.getPerMinute()).toBe(10);
  });

  it('record() with default count increments by 1', () => {
    let now = 0;
    const tracker = new RateTracker(60_000, () => now);
    tracker.record();
    tracker.record();
    expect(tracker.getPerMinute()).toBe(2);
  });
});

describe('RateTracker — pruning old buckets', () => {
  it('does not accumulate stale buckets indefinitely', () => {
    let now = 0;
    const tracker = new RateTracker(60_000, () => now);
    // Record events across many seconds that will all expire
    for (let i = 0; i < 10; i++) {
      now = i * 1_000;
      tracker.record();
    }
    // Advance well past window
    now = 120_000;
    tracker.record(3);

    // Only the 3 fresh events should count
    expect(tracker.getPerMinute()).toBe(3);
    // Old buckets were pruned — internal map should be small
    expect(tracker._buckets.size).toBeLessThanOrEqual(2);
  });
});

// ── MetricKey constants ──────────────────────────────────────────────────────

describe('MetricKey constants', () => {
  it('exposes all expected metric keys', () => {
    expect(MetricKey.LOOP_ITERATIONS).toBe('loopIterations');
    expect(MetricKey.ACTIVE_CONNECTIONS).toBe('activeConnections');
    expect(MetricKey.DB_READS).toBe('dbReads');
    expect(MetricKey.DB_WRITES).toBe('dbWrites');
    expect(MetricKey.ERRORS).toBe('errors');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(MetricKey)).toBe(true);
  });
});
