// @vitest-environment node
//
// Tests for the catch-all Vercel API adapter in api/[...path].js.
//
// The adapter owns a module-level pool singleton so it can be reused across
// warm invocations on the same container.  vi.resetModules() + vi.doMock()
// gives every test a fresh module instance with its own clean singleton state.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

// ---------------------------------------------------------------------------
// api/[...path].js — catch-all adapter
// ---------------------------------------------------------------------------

describe('api/[...path].js', () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('calls handleRequest with null pool when DATABASE_URL is not set', async () => {
    const mockHandleRequest = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../functions/router.js', () => ({ handleRequest: mockHandleRequest }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./[...path].js');
    const req = { method: 'POST', url: '/api/players', body: { name: 'Alice', role: 'hider' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockHandleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/players' }),
      res,
      expect.objectContaining({ pool: null }),
    );
  });

  it('creates pool and calls createTables when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const fakePool = { fake: 'pool', query: vi.fn().mockResolvedValue({ rows: [] }) };
    const mockCreatePool = vi.fn().mockReturnValue(fakePool);
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockHandleRequest = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/router.js', () => ({ handleRequest: mockHandleRequest }));

    const { default: handler } = await import('./[...path].js');
    const req = { method: 'POST', url: '/api/players', body: {} };
    const res = makeRes();

    await handler(req, res);

    expect(mockCreatePool).toHaveBeenCalledWith('postgresql://localhost/test');
    expect(mockCreateTables).toHaveBeenCalledWith(fakePool);
    expect(mockHandleRequest).toHaveBeenCalledWith(
      expect.any(Object),
      res,
      expect.objectContaining({ pool: fakePool }),
    );
  });

  it('reuses the same pool across multiple invocations (warm start)', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const mockCreatePool = vi.fn().mockReturnValue({ fake: 'pool', query: vi.fn().mockResolvedValue({ rows: [] }) });
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockHandleRequest = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/router.js', () => ({ handleRequest: mockHandleRequest }));

    const { default: handler } = await import('./[...path].js');
    const req = { method: 'POST', url: '/api/players', body: {} };

    await handler(req, makeRes());
    await handler(req, makeRes());

    // Pool and tables should only be created once per cold start
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(mockCreateTables).toHaveBeenCalledTimes(1);
  });

  it('strips /api prefix from URL before routing', async () => {
    const mockHandleRequest = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../functions/router.js', () => ({ handleRequest: mockHandleRequest }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./[...path].js');
    const req = { method: 'GET', url: '/api/zones?bounds=a&scale=small' };
    const res = makeRes();

    await handler(req, res);

    expect(mockHandleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/zones?bounds=a&scale=small' }),
      res,
      expect.any(Object),
    );
  });

  it('falls back to / when URL is exactly /api', async () => {
    const mockHandleRequest = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../functions/router.js', () => ({ handleRequest: mockHandleRequest }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./[...path].js');
    const req = { method: 'GET', url: '/api' };
    const res = makeRes();

    await handler(req, res);

    expect(mockHandleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/' }),
      res,
      expect.any(Object),
    );
  });

  // Task 200: a transient createTables failure must NOT silently null the
  // pool. Doing so would force the router into the in-process store, which
  // is empty on that Lambda instance and inconsistent across instances —
  // the root cause of the "ready count flickers from 2/2 to 0/2" bug.
  it('keeps the pool alive when createTables rejects (does not silently fall back to in-memory)', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const fakePool = { fake: 'pool', query: vi.fn().mockResolvedValue({ rows: [] }) };
    const mockCreatePool = vi.fn().mockReturnValue(fakePool);
    // First call rejects (cold-start migration race); subsequent calls succeed.
    const mockCreateTables = vi.fn()
      .mockRejectedValueOnce(new Error('relation does not exist'))
      .mockResolvedValue(undefined);
    const mockHandleRequest = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/router.js', () => ({ handleRequest: mockHandleRequest }));

    const { default: handler } = await import('./[...path].js');

    // First request — createTables rejects. The handler must still pass the
    // pool through so downstream handlers query Postgres rather than reading
    // an empty in-process Map.
    await handler({ method: 'POST', url: '/api/players', body: {} }, makeRes());
    expect(mockHandleRequest).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ pool: fakePool }),
    );

    // Second request — should reuse the same pool. createTables is NOT
    // re-invoked because the pool is still cached; tables either already
    // exist (the common case after a prior cold start) or queries will
    // throw real errors that surface to the client as 500.
    await handler({ method: 'POST', url: '/api/players', body: {} }, makeRes());
    expect(mockHandleRequest).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ pool: fakePool }),
    );
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(mockCreateTables).toHaveBeenCalledTimes(1);
  });
});
