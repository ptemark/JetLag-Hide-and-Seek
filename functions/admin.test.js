import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAdminStatus } from './admin.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(method = 'GET') {
  return { method };
}

/** Minimal GameLoopManager stub */
function makeGlm(gameEntries = []) {
  // gameEntries: [{ gameId, phase, phaseElapsedMs }]
  const _games = new Map(gameEntries.map(({ gameId }) => [gameId, {}]));
  return {
    _games,
    getPhase: vi.fn((gameId) => gameEntries.find((g) => g.gameId === gameId)?.phase ?? null),
    getPhaseElapsed: vi.fn((gameId) => gameEntries.find((g) => g.gameId === gameId)?.phaseElapsedMs ?? 0),
    getActiveGameCount: vi.fn(() => _games.size),
  };
}

/** Minimal GameStateManager stub */
function makeGsm() {
  return {};
}

/** Minimal WsHandler stub */
function makeWsHandler(connectedCount = 0, gamePlayerCounts = {}) {
  return {
    getConnectedCount: vi.fn(() => connectedCount),
    getGamePlayerCount: vi.fn((gameId) => gamePlayerCounts[gameId] ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Method validation
// ---------------------------------------------------------------------------

describe('getAdminStatus — method validation', () => {
  it('returns 405 for POST', async () => {
    const res = await getAdminStatus(makeReq('POST'));
    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/Method Not Allowed/i);
  });

  it('returns 405 for DELETE', async () => {
    const res = await getAdminStatus(makeReq('DELETE'));
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// No configuration — 503
// ---------------------------------------------------------------------------

describe('getAdminStatus — no configuration', () => {
  it('returns 503 when no options provided', async () => {
    const res = await getAdminStatus(makeReq());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no server configured/i);
  });

  it('returns 503 when only gsm is provided (missing glm and wsHandler)', async () => {
    const res = await getAdminStatus(makeReq(), { gsm: makeGsm() });
    expect(res.status).toBe(503);
  });

  it('returns 503 when gsm and glm are provided but wsHandler is missing', async () => {
    const res = await getAdminStatus(makeReq(), { gsm: makeGsm(), glm: makeGlm() });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// In-process instances
// ---------------------------------------------------------------------------

describe('getAdminStatus — in-process instances', () => {
  it('returns 200 with empty games when no active games', async () => {
    const res = await getAdminStatus(makeReq(), {
      gsm: makeGsm(),
      glm: makeGlm([]),
      wsHandler: makeWsHandler(0),
    });
    expect(res.status).toBe(200);
    expect(res.body.connectedPlayers).toBe(0);
    expect(res.body.activeGameCount).toBe(0);
    expect(res.body.games).toEqual([]);
  });

  it('returns correct connected player count', async () => {
    const res = await getAdminStatus(makeReq(), {
      gsm: makeGsm(),
      glm: makeGlm([]),
      wsHandler: makeWsHandler(5),
    });
    expect(res.status).toBe(200);
    expect(res.body.connectedPlayers).toBe(5);
  });

  it('returns game list with phase and player count', async () => {
    const games = [
      { gameId: 'g1', phase: 'hiding', phaseElapsedMs: 12000 },
      { gameId: 'g2', phase: 'seeking', phaseElapsedMs: 45000 },
    ];
    const res = await getAdminStatus(makeReq(), {
      gsm: makeGsm(),
      glm: makeGlm(games),
      wsHandler: makeWsHandler(3, { g1: 2, g2: 1 }),
    });
    expect(res.status).toBe(200);
    expect(res.body.activeGameCount).toBe(2);
    expect(res.body.games).toHaveLength(2);

    const g1 = res.body.games.find((g) => g.gameId === 'g1');
    expect(g1).toMatchObject({ gameId: 'g1', phase: 'hiding', phaseElapsedMs: 12000, playerCount: 2 });

    const g2 = res.body.games.find((g) => g.gameId === 'g2');
    expect(g2).toMatchObject({ gameId: 'g2', phase: 'seeking', phaseElapsedMs: 45000, playerCount: 1 });
  });

  it('calls wsHandler.getConnectedCount once', async () => {
    const wsHandler = makeWsHandler(2);
    await getAdminStatus(makeReq(), { gsm: makeGsm(), glm: makeGlm([]), wsHandler });
    expect(wsHandler.getConnectedCount).toHaveBeenCalledTimes(1);
  });

  it('calls glm.getActiveGameCount once', async () => {
    const glm = makeGlm([]);
    await getAdminStatus(makeReq(), { gsm: makeGsm(), glm, wsHandler: makeWsHandler() });
    expect(glm.getActiveGameCount).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Remote managed server via serverUrl (mocked fetch)
// ---------------------------------------------------------------------------

describe('getAdminStatus — remote serverUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const samplePayload = {
    connectedPlayers: 4,
    activeGameCount: 2,
    uptimeMs: 60000,
    games: [
      { gameId: 'g1', phase: 'hiding', phaseElapsedMs: 5000, playerCount: 2 },
    ],
  };

  it('returns 200 with upstream payload when server responds 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => samplePayload,
    }));

    const res = await getAdminStatus(makeReq(), { serverUrl: 'http://game-server:3001' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(samplePayload);
  });

  it('calls fetch with the correct admin URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => samplePayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    await getAdminStatus(makeReq(), { serverUrl: 'http://srv:3000' });
    expect(fetchMock).toHaveBeenCalledWith('http://srv:3000/internal/admin');
  });

  it('returns 502 when upstream responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const res = await getAdminStatus(makeReq(), { serverUrl: 'http://srv:3000' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/upstream error/i);
  });

  it('returns 503 when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await getAdminStatus(makeReq(), { serverUrl: 'http://srv:3000' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });

  it('in-process opts take precedence over serverUrl', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await getAdminStatus(makeReq(), {
      serverUrl: 'http://srv:3000',
      gsm: makeGsm(),
      glm: makeGlm([]),
      wsHandler: makeWsHandler(0),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
