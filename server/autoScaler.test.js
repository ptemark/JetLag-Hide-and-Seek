// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoScaler, ScaleDirection, nullAutoScaler } from './autoScaler.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNow(start = 0) {
  let t = start;
  return {
    fn: () => t,
    advance: (ms) => { t += ms; },
  };
}

// ── ScaleDirection ────────────────────────────────────────────────────────────

describe('ScaleDirection', () => {
  it('exposes UP and DOWN', () => {
    expect(ScaleDirection.UP).toBe('up');
    expect(ScaleDirection.DOWN).toBe('down');
  });

  it('is frozen', () => {
    expect(() => { ScaleDirection.NEW = 'x'; }).toThrow();
  });
});

// ── AutoScaler — defaults ────────────────────────────────────────────────────

describe('AutoScaler — defaults', () => {
  let scaler;
  const clock = makeNow();

  beforeEach(() => {
    scaler = new AutoScaler({ cooldownMs: 60_000, nowFn: clock.fn });
    scaler.reset();
  });

  it('does not fire UP when load is below scale-up thresholds', () => {
    const events = [];
    scaler = new AutoScaler({ cooldownMs: 60_000, nowFn: clock.fn, onScale: (d) => events.push(d) });
    scaler.check(2, 5); // below scaleUpGames=5 and scaleUpConnections=20; above scaleDownGames=0
    expect(events).not.toContain(ScaleDirection.UP);
  });

  it('fires UP when activeGames reaches scaleUpGames threshold (default 5)', () => {
    const events = [];
    scaler = new AutoScaler({ cooldownMs: 60_000, nowFn: clock.fn, onScale: (d) => events.push(d) });
    scaler.check(5, 0);
    expect(events).toEqual([ScaleDirection.UP]);
  });

  it('fires UP when activeConnections reaches scaleUpConnections threshold (default 20)', () => {
    const events = [];
    scaler = new AutoScaler({ cooldownMs: 60_000, nowFn: clock.fn, onScale: (d) => events.push(d) });
    scaler.check(0, 20);
    expect(events).toEqual([ScaleDirection.UP]);
  });

  it('fires DOWN when both metrics are at or below low-water marks (default 0)', () => {
    const events = [];
    scaler = new AutoScaler({ cooldownMs: 0, nowFn: clock.fn, onScale: (d) => events.push(d) });
    // Need cooldown=0 so DOWN can fire without waiting
    scaler.check(0, 0);
    expect(events).toContain(ScaleDirection.DOWN);
  });
});

// ── AutoScaler — custom thresholds ───────────────────────────────────────────

describe('AutoScaler — custom thresholds', () => {
  let clock;
  let scaler;
  let events;

  beforeEach(() => {
    clock = makeNow(1_000_000);
    events = [];
    scaler = new AutoScaler({
      thresholds: {
        scaleUpGames:          3,
        scaleUpConnections:    10,
        scaleDownGames:        1,
        scaleDownConnections:  2,
      },
      cooldownMs: 60_000,
      nowFn: clock.fn,
      onScale: (direction) => events.push(direction),
    });
  });

  it('fires UP when activeGames >= scaleUpGames', () => {
    scaler.check(3, 0);
    expect(events).toEqual([ScaleDirection.UP]);
  });

  it('fires UP when activeConnections >= scaleUpConnections', () => {
    scaler.check(0, 10);
    expect(events).toEqual([ScaleDirection.UP]);
  });

  it('fires DOWN when both metrics are at or below low-water marks', () => {
    clock.advance(0); // still at start, cooldown not elapsed for DOWN (never fired)
    scaler.check(1, 2);
    expect(events).toContain(ScaleDirection.DOWN);
  });

  it('does not fire DOWN when only games are low', () => {
    scaler.check(0, 5); // connections above scaleDownConnections
    expect(events).not.toContain(ScaleDirection.DOWN);
  });

  it('does not fire DOWN when only connections are low', () => {
    scaler.check(2, 0); // games above scaleDownGames
    expect(events).not.toContain(ScaleDirection.DOWN);
  });

  it('does not fire when load is between low-water and high-water', () => {
    scaler.check(2, 5); // above down thresholds but below up thresholds
    expect(events).toEqual([]);
  });
});

// ── AutoScaler — cooldown (hysteresis) ───────────────────────────────────────

describe('AutoScaler — cooldown', () => {
  let clock;
  let scaler;
  let events;

  beforeEach(() => {
    clock = makeNow(1_000_000);
    events = [];
    scaler = new AutoScaler({
      thresholds: { scaleUpGames: 1, scaleUpConnections: 1 },
      cooldownMs: 60_000,
      nowFn: clock.fn,
      onScale: (direction) => events.push(direction),
    });
  });

  it('fires UP only once during cooldown period', () => {
    scaler.check(5, 5); // fire
    scaler.check(5, 5); // still in cooldown
    scaler.check(5, 5); // still in cooldown
    expect(events.filter(d => d === ScaleDirection.UP)).toHaveLength(1);
  });

  it('fires UP again after cooldown elapses', () => {
    scaler.check(5, 5);          // fire #1
    clock.advance(60_000);        // cooldown elapsed
    scaler.check(5, 5);          // fire #2
    expect(events.filter(d => d === ScaleDirection.UP)).toHaveLength(2);
  });

  it('fires DOWN only once during cooldown period', () => {
    scaler = new AutoScaler({
      thresholds: { scaleDownGames: 1, scaleDownConnections: 1 },
      cooldownMs: 60_000,
      nowFn: clock.fn,
      onScale: (direction) => events.push(direction),
    });
    scaler.check(0, 0);
    scaler.check(0, 0);
    expect(events.filter(d => d === ScaleDirection.DOWN)).toHaveLength(1);
  });

  it('fires DOWN again after cooldown elapses', () => {
    scaler = new AutoScaler({
      thresholds: { scaleDownGames: 1, scaleDownConnections: 1 },
      cooldownMs: 60_000,
      nowFn: clock.fn,
      onScale: (direction) => events.push(direction),
    });
    scaler.check(0, 0);
    clock.advance(60_000);
    scaler.check(0, 0);
    expect(events.filter(d => d === ScaleDirection.DOWN)).toHaveLength(2);
  });

  it('reset() clears cooldown state so events can fire immediately', () => {
    scaler.check(5, 5);  // fire
    scaler.reset();
    scaler.check(5, 5);  // fires again after reset
    expect(events.filter(d => d === ScaleDirection.UP)).toHaveLength(2);
  });
});

// ── AutoScaler — UP takes priority over DOWN ─────────────────────────────────

describe('AutoScaler — UP takes priority', () => {
  it('does not fire DOWN when UP condition is also true', () => {
    const clock = makeNow(1_000_000);
    const events = [];
    const scaler = new AutoScaler({
      thresholds: {
        scaleUpGames:          1,
        scaleDownGames:        2,   // down threshold HIGHER than up threshold
        scaleDownConnections:  100,
      },
      cooldownMs: 0,
      nowFn: clock.fn,
      onScale: (direction) => events.push(direction),
    });
    // activeGames=1 triggers UP; activeGames=1 <= scaleDownGames=2 would also trigger DOWN
    // but UP has priority
    scaler.check(1, 0);
    expect(events).toEqual([ScaleDirection.UP]);
  });
});

// ── AutoScaler — webhook ──────────────────────────────────────────────────────

describe('AutoScaler — webhook', () => {
  it('POSTs scale event payload to webhookUrl', async () => {
    const clock = makeNow(1_000_000);
    const requests = [];
    const fetchFn = vi.fn((url, opts) => {
      requests.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true });
    });

    const scaler = new AutoScaler({
      thresholds: { scaleUpGames: 1 },
      cooldownMs: 60_000,
      webhookUrl: 'https://example.com/scale',
      fetchFn,
      nowFn: clock.fn,
    });

    scaler.check(3, 0);
    // Flush microtasks
    await Promise.resolve();

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://example.com/scale');
    expect(requests[0].body.direction).toBe(ScaleDirection.UP);
    expect(requests[0].body.activeGames).toBe(3);
    expect(requests[0].body.timestamp).toBeDefined();
  });

  it('silently swallows webhook fetch errors', async () => {
    const clock = makeNow(1_000_000);
    const fetchFn = vi.fn(() => Promise.reject(new Error('network error')));

    const scaler = new AutoScaler({
      thresholds: { scaleUpGames: 1 },
      cooldownMs: 60_000,
      webhookUrl: 'https://example.com/scale',
      fetchFn,
      nowFn: clock.fn,
    });

    expect(() => scaler.check(5, 0)).not.toThrow();
    // Wait for the rejected promise to resolve without throwing
    await Promise.resolve();
    await Promise.resolve();
  });

  it('does not call fetch when webhookUrl is empty', () => {
    const clock = makeNow(1_000_000);
    const fetchFn = vi.fn();
    const scaler = new AutoScaler({
      thresholds: { scaleUpGames: 1 },
      cooldownMs: 60_000,
      webhookUrl: '',
      fetchFn,
      nowFn: clock.fn,
    });
    scaler.check(5, 0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ── AutoScaler — onScale callback ────────────────────────────────────────────

describe('AutoScaler — onScale callback', () => {
  it('passes direction, reason, and data to callback', () => {
    const clock = makeNow(1_000_000);
    const calls = [];
    const scaler = new AutoScaler({
      thresholds: { scaleUpGames: 2 },
      cooldownMs: 60_000,
      nowFn: clock.fn,
      onScale: (direction, reason, data) => calls.push({ direction, reason, data }),
    });

    scaler.check(3, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0].direction).toBe(ScaleDirection.UP);
    expect(calls[0].reason).toMatch(/activeGames/);
    expect(calls[0].data.activeGames).toBe(3);
    expect(calls[0].data.activeConnections).toBe(5);
  });

  it('swallows errors thrown by onScale callback', () => {
    const clock = makeNow(1_000_000);
    const scaler = new AutoScaler({
      thresholds: { scaleUpGames: 1 },
      cooldownMs: 60_000,
      nowFn: clock.fn,
      onScale: () => { throw new Error('callback error'); },
    });
    expect(() => scaler.check(5, 0)).not.toThrow();
  });
});

// ── nullAutoScaler ────────────────────────────────────────────────────────────

describe('nullAutoScaler', () => {
  it('check() is a no-op', () => {
    expect(() => nullAutoScaler.check(100, 100)).not.toThrow();
  });

  it('reset() is a no-op', () => {
    expect(() => nullAutoScaler.reset()).not.toThrow();
  });

  it('is frozen', () => {
    expect(() => { nullAutoScaler.check = null; }).toThrow();
  });
});
