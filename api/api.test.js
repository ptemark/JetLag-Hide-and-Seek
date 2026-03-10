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
      { pool: null },
    );
  });

  it('creates pool and calls createTables when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const fakePool = { fake: 'pool' };
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
      { pool: fakePool },
    );
  });

  it('reuses the same pool across multiple invocations (warm start)', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const mockCreatePool = vi.fn().mockReturnValue({ fake: 'pool' });
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
});
