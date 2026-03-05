import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLiveState } from './liveState.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGsm(games = {}) {
  return {
    getGameState: vi.fn((gameId) => games[gameId] ?? null),
  };
}

function makeReq(gameId, method = 'GET') {
  return { method, params: gameId != null ? { gameId } : {} };
}

// ---------------------------------------------------------------------------
// Method validation
// ---------------------------------------------------------------------------

describe('getLiveState — method validation', () => {
  it('returns 405 for POST', async () => {
    const res = await getLiveState(makeReq('g1', 'POST'));
    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/Method Not Allowed/i);
  });

  it('returns 405 for DELETE', async () => {
    const res = await getLiveState(makeReq('g1', 'DELETE'));
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

describe('getLiveState — parameter validation', () => {
  it('returns 400 when gameId is missing', async () => {
    const res = await getLiveState(makeReq(undefined));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/i);
  });
});

// ---------------------------------------------------------------------------
// In-process GameStateManager (gsm option)
// ---------------------------------------------------------------------------

describe('getLiveState — in-process GSM', () => {
  const sampleState = {
    gameId: 'game-1',
    status: 'hiding',
    players: { 'p1': { lat: 51.5, lon: -0.1, role: 'hider' } },
  };

  it('returns 200 with state when game exists', async () => {
    const gsm = makeGsm({ 'game-1': sampleState });
    const res = await getLiveState(makeReq('game-1'), { gsm });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleState);
  });

  it('returns 404 when game is not found', async () => {
    const gsm = makeGsm({});
    const res = await getLiveState(makeReq('unknown'), { gsm });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/game not found/i);
  });

  it('calls gsm.getGameState with the correct gameId', async () => {
    const gsm = makeGsm({ 'abc': sampleState });
    await getLiveState(makeReq('abc'), { gsm });
    expect(gsm.getGameState).toHaveBeenCalledWith('abc');
  });
});

// ---------------------------------------------------------------------------
// No configuration — 503
// ---------------------------------------------------------------------------

describe('getLiveState — no configuration', () => {
  it('returns 503 when neither gsm nor serverUrl is provided', async () => {
    const res = await getLiveState(makeReq('g1'));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no server configured/i);
  });
});

// ---------------------------------------------------------------------------
// Remote managed server via serverUrl (mocked fetch)
// ---------------------------------------------------------------------------

describe('getLiveState — remote serverUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleState = {
    gameId: 'game-2',
    status: 'seeking',
    players: {},
  };

  it('returns 200 with state when upstream responds 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleState,
    }));

    const res = await getLiveState(makeReq('game-2'), { serverUrl: 'http://game-server:3001' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleState);
  });

  it('calls fetch with the correct URL including encoded gameId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleState,
    });
    vi.stubGlobal('fetch', fetchMock);

    await getLiveState(makeReq('game/special'), { serverUrl: 'http://srv:3000' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://srv:3000/internal/state/game%2Fspecial',
    );
  });

  it('returns 404 when upstream responds 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const res = await getLiveState(makeReq('missing'), { serverUrl: 'http://srv:3000' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/game not found/i);
  });

  it('returns 502 when upstream responds with a non-ok, non-404 status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const res = await getLiveState(makeReq('g1'), { serverUrl: 'http://srv:3000' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/upstream error/i);
  });

  it('returns 503 when fetch throws (network error / server down)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await getLiveState(makeReq('g1'), { serverUrl: 'http://srv:3000' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
