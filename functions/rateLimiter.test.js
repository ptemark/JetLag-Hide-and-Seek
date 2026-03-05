import { describe, it, expect, beforeEach } from 'vitest';
import { createRateLimiter } from './rateLimiter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLimiter(opts = {}) {
  const store = new Map();
  let currentMs = opts.startMs ?? 1_000_000;
  const now = () => currentMs;
  const advance = (ms) => { currentMs += ms; };
  const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 3, now, store, ...opts });
  return { limiter, advance, store };
}

// ---------------------------------------------------------------------------
// Basic allow / deny
// ---------------------------------------------------------------------------

describe('createRateLimiter — basic allow/deny', () => {
  it('allows first request', () => {
    const { limiter } = makeLimiter();
    const result = limiter.check('client-1');
    expect(result.allowed).toBe(true);
  });

  it('allows requests up to maxRequests', () => {
    const { limiter } = makeLimiter();
    limiter.check('x');
    limiter.check('x');
    const third = limiter.check('x');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('blocks the request that exceeds maxRequests', () => {
    const { limiter } = makeLimiter();
    limiter.check('x');
    limiter.check('x');
    limiter.check('x');
    const fourth = limiter.check('x');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('continues blocking within the same window', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.check('x');
    const result = limiter.check('x');
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Remaining counter
// ---------------------------------------------------------------------------

describe('createRateLimiter — remaining counter', () => {
  it('starts at maxRequests - 1 after first call', () => {
    const { limiter } = makeLimiter();
    const r = limiter.check('a');
    expect(r.remaining).toBe(2); // maxRequests=3, used 1
  });

  it('decrements remaining on each call', () => {
    const { limiter } = makeLimiter();
    expect(limiter.check('a').remaining).toBe(2);
    expect(limiter.check('a').remaining).toBe(1);
    expect(limiter.check('a').remaining).toBe(0);
  });

  it('remaining is 0 once limit is hit', () => {
    const { limiter } = makeLimiter();
    limiter.check('a');
    limiter.check('a');
    limiter.check('a');
    expect(limiter.check('a').remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resetAtMs
// ---------------------------------------------------------------------------

describe('createRateLimiter — resetAtMs', () => {
  it('resetAtMs is windowStart + windowMs', () => {
    const startMs = 5_000_000;
    const { limiter } = makeLimiter({ startMs, windowMs: 10_000 });
    const r = limiter.check('a');
    expect(r.resetAtMs).toBe(startMs + 10_000);
  });

  it('resetAtMs is consistent across calls in the same window', () => {
    const startMs = 5_000_000;
    const { limiter, advance } = makeLimiter({ startMs, windowMs: 10_000 });
    const r1 = limiter.check('a');
    advance(3_000); // still in same window
    const r2 = limiter.check('a');
    expect(r1.resetAtMs).toBe(r2.resetAtMs);
  });
});

// ---------------------------------------------------------------------------
// Window reset
// ---------------------------------------------------------------------------

describe('createRateLimiter — window reset', () => {
  it('resets counter after window expires', () => {
    const { limiter, advance } = makeLimiter();
    limiter.check('a');
    limiter.check('a');
    limiter.check('a');
    advance(10_001); // past the 10s window
    const r = limiter.check('a');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('exact window boundary is treated as new window', () => {
    const startMs = 1_000_000;
    const { limiter, advance } = makeLimiter({ startMs, windowMs: 10_000 });
    limiter.check('a');
    limiter.check('a');
    limiter.check('a');
    advance(10_000); // exactly at expiry
    const r = limiter.check('a');
    expect(r.allowed).toBe(true);
  });

  it('new window has correct resetAtMs', () => {
    const startMs = 1_000_000;
    const { limiter, advance } = makeLimiter({ startMs, windowMs: 10_000 });
    for (let i = 0; i < 3; i++) limiter.check('a');
    advance(10_001);
    const r = limiter.check('a');
    expect(r.resetAtMs).toBeGreaterThan(startMs + 10_000);
  });
});

// ---------------------------------------------------------------------------
// Key isolation
// ---------------------------------------------------------------------------

describe('createRateLimiter — key isolation', () => {
  it('tracks different keys independently', () => {
    const { limiter } = makeLimiter();
    limiter.check('ip-1');
    limiter.check('ip-1');
    limiter.check('ip-1');
    const r = limiter.check('ip-2'); // different key, fresh window
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('blocking one key does not affect another', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 10; i++) limiter.check('bad-actor');
    expect(limiter.check('good-client').allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _clear
// ---------------------------------------------------------------------------

describe('createRateLimiter — _clear', () => {
  it('resets all tracking state', () => {
    const { limiter } = makeLimiter();
    limiter.check('a');
    limiter.check('a');
    limiter.check('a');
    limiter._clear();
    const r = limiter.check('a');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('clears multiple keys', () => {
    const { limiter, store } = makeLimiter();
    limiter.check('a');
    limiter.check('b');
    limiter.check('c');
    expect(store.size).toBe(3);
    limiter._clear();
    expect(store.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

describe('createRateLimiter — default options', () => {
  it('creates a limiter without opts', () => {
    const limiter = createRateLimiter();
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('defaults to 100 maxRequests per 60s window', () => {
    const store = new Map();
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, store });
    for (let i = 0; i < 100; i++) limiter.check('x');
    const r101 = limiter.check('x');
    expect(r101.allowed).toBe(false);
  });
});
