// @vitest-environment node
//
// Tests for Vercel API adapters in api/.
//
// Each adapter owns a module-level pool singleton so it can be reused across
// warm invocations on the same container.  vi.resetModules() + vi.doMock()
// gives every test a fresh module instance with its own clean singleton state.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

// ---------------------------------------------------------------------------
// api/players.js
// ---------------------------------------------------------------------------

describe('api/players.js', () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('passes null pool to registerPlayer when DATABASE_URL is not set', async () => {
    const mockRegisterPlayer = vi.fn().mockResolvedValue({ status: 201, body: { playerId: 'p1' } });
    vi.doMock('../functions/players.js', () => ({ registerPlayer: mockRegisterPlayer }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./players.js');
    const req = { method: 'POST', body: { name: 'Alice', role: 'hider' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockRegisterPlayer).toHaveBeenCalledWith(
      { method: 'POST', body: { name: 'Alice', role: 'hider' } },
      null,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ playerId: 'p1' });
  });

  it('creates pool and calls createTables when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const fakePool = { fake: 'pool' };
    const mockCreatePool = vi.fn().mockReturnValue(fakePool);
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockRegisterPlayer = vi.fn().mockResolvedValue({ status: 201, body: {} });

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/players.js', () => ({ registerPlayer: mockRegisterPlayer }));

    const { default: handler } = await import('./players.js');
    const req = { method: 'POST', body: { name: 'Alice', role: 'hider' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockCreatePool).toHaveBeenCalledWith('postgresql://localhost/test');
    expect(mockCreateTables).toHaveBeenCalledWith(fakePool);
    expect(mockRegisterPlayer).toHaveBeenCalledWith(expect.any(Object), fakePool);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('reuses the same pool across multiple invocations (warm start)', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const mockCreatePool = vi.fn().mockReturnValue({ fake: 'pool' });
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockRegisterPlayer = vi.fn().mockResolvedValue({ status: 201, body: {} });

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/players.js', () => ({ registerPlayer: mockRegisterPlayer }));

    const { default: handler } = await import('./players.js');
    const req = { method: 'POST', body: { name: 'Alice', role: 'hider' } };

    await handler(req, makeRes());
    await handler(req, makeRes());

    // Pool and tables should only be created once per cold start
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(mockCreateTables).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when registerPlayer throws', async () => {
    vi.doMock('../functions/players.js', () => ({
      registerPlayer: vi.fn().mockRejectedValue(new Error('DB error')),
    }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./players.js');
    const req = { method: 'POST', body: { name: 'Alice', role: 'hider' } };
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });

  it('returns 500 when createTables rejects', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    vi.doMock('../db/db.js', () => ({
      createPool: vi.fn().mockReturnValue({}),
      createTables: vi.fn().mockRejectedValue(new Error('migration failed')),
    }));
    vi.doMock('../functions/players.js', () => ({ registerPlayer: vi.fn() }));

    const { default: handler } = await import('./players.js');
    const res = makeRes();

    await handler({ method: 'POST', body: { name: 'Alice', role: 'hider' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });
});

// ---------------------------------------------------------------------------
// api/games/[id].js
// ---------------------------------------------------------------------------

describe('api/games/[id].js', () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('passes null pool to getGame when DATABASE_URL is not set', async () => {
    const mockGetGame = vi.fn().mockResolvedValue({ status: 200, body: { gameId: 'g1' } });
    vi.doMock('../functions/games.js', () => ({ getGame: mockGetGame }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./games/[id].js');
    const req = { method: 'GET', query: { id: 'g1' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockGetGame).toHaveBeenCalledWith({ method: 'GET', params: { id: 'g1' } }, null);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ gameId: 'g1' });
  });

  it('creates pool and passes it to getGame when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const fakePool = { fake: 'pool' };
    const mockCreatePool = vi.fn().mockReturnValue(fakePool);
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockGetGame = vi.fn().mockResolvedValue({ status: 200, body: { gameId: 'g1' } });

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/games.js', () => ({ getGame: mockGetGame }));

    const { default: handler } = await import('./games/[id].js');
    const req = { method: 'GET', query: { id: 'g1' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockCreatePool).toHaveBeenCalledWith('postgresql://localhost/test');
    expect(mockCreateTables).toHaveBeenCalledWith(fakePool);
    expect(mockGetGame).toHaveBeenCalledWith(expect.any(Object), fakePool);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 when getGame throws', async () => {
    vi.doMock('../functions/games.js', () => ({
      getGame: vi.fn().mockRejectedValue(new Error('DB error')),
    }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./games/[id].js');
    const res = makeRes();

    await handler({ method: 'GET', query: { id: 'g1' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });

  it('reuses the pool across warm invocations', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const mockCreatePool = vi.fn().mockReturnValue({ fake: 'pool' });
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockGetGame = vi.fn().mockResolvedValue({ status: 200, body: {} });

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/games.js', () => ({ getGame: mockGetGame }));

    const { default: handler } = await import('./games/[id].js');
    const req = { method: 'GET', query: { id: 'g1' } };

    await handler(req, makeRes());
    await handler(req, makeRes());

    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(mockCreateTables).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// api/scores.js
// ---------------------------------------------------------------------------

describe('api/scores.js', () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('passes null pool to submitScore when DATABASE_URL is not set', async () => {
    const mockSubmitScore = vi.fn().mockResolvedValue({ status: 201, body: { scoreId: 's1' } });
    vi.doMock('../functions/scores.js', () => ({ submitScore: mockSubmitScore }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./scores.js');
    const req = {
      method: 'POST',
      body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 5000, captured: false },
    };
    const res = makeRes();

    await handler(req, res);

    expect(mockSubmitScore).toHaveBeenCalledWith(
      { method: 'POST', body: req.body },
      null,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ scoreId: 's1' });
  });

  it('creates pool and passes it to submitScore when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const fakePool = { fake: 'pool' };
    const mockCreatePool = vi.fn().mockReturnValue(fakePool);
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockSubmitScore = vi.fn().mockResolvedValue({ status: 201, body: { scoreId: 's1' } });

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/scores.js', () => ({ submitScore: mockSubmitScore }));

    const { default: handler } = await import('./scores.js');
    const req = {
      method: 'POST',
      body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 5000, captured: false },
    };
    const res = makeRes();

    await handler(req, res);

    expect(mockCreatePool).toHaveBeenCalledWith('postgresql://localhost/test');
    expect(mockCreateTables).toHaveBeenCalledWith(fakePool);
    expect(mockSubmitScore).toHaveBeenCalledWith(expect.any(Object), fakePool);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 500 when submitScore throws', async () => {
    vi.doMock('../functions/scores.js', () => ({
      submitScore: vi.fn().mockRejectedValue(new Error('DB error')),
    }));
    vi.doMock('../db/db.js', () => ({ createPool: vi.fn(), createTables: vi.fn() }));

    const { default: handler } = await import('./scores.js');
    const res = makeRes();

    await handler(
      { method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 5000, captured: false } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });

  it('reuses the pool across warm invocations', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';

    const mockCreatePool = vi.fn().mockReturnValue({ fake: 'pool' });
    const mockCreateTables = vi.fn().mockResolvedValue(undefined);
    const mockSubmitScore = vi.fn().mockResolvedValue({ status: 201, body: {} });

    vi.doMock('../db/db.js', () => ({ createPool: mockCreatePool, createTables: mockCreateTables }));
    vi.doMock('../functions/scores.js', () => ({ submitScore: mockSubmitScore }));

    const { default: handler } = await import('./scores.js');
    const req = {
      method: 'POST',
      body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 5000, captured: false },
    };

    await handler(req, makeRes());
    await handler(req, makeRes());

    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(mockCreateTables).toHaveBeenCalledTimes(1);
  });
});
