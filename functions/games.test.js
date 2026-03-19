import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGame,
  handleCreateGame,
  getGame,
  handleStartGame,
  VALID_SIZES,
  SCALE_DURATION_RANGES,
  _getStore,
  _clearStore,
  cleanupStaleGames,
} from './games.js';
import { handleRequest } from './router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePostReq(params = {}, body = {}) {
  return { method: 'POST', params, body };
}

function makeGetReq(params = {}) {
  return { method: 'GET', params };
}

// ---------------------------------------------------------------------------
// createGame (in-process)
// ---------------------------------------------------------------------------

describe('createGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('creates a game with default medium size', () => {
    const game = createGame();
    expect(game.size).toBe('medium');
    expect(game.status).toBe('waiting');
    expect(typeof game.gameId).toBe('string');
  });

  it('creates a game with the given size', () => {
    for (const size of VALID_SIZES) {
      const game = createGame({ size });
      expect(game.size).toBe(size);
    }
  });

  it('throws for an invalid size', () => {
    expect(() => createGame({ size: 'huge' })).toThrow(/size/);
  });

  it('throws for an invalid seekerTeams value', () => {
    expect(() => createGame({ seekerTeams: 3 })).toThrow(/seekerTeams/);
  });

  it('stores the game in the in-process map', () => {
    const game = createGame({ size: 'small' });
    expect(_getStore().has(game.gameId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleCreateGame (in-process)
// ---------------------------------------------------------------------------

describe('handleCreateGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('returns 405 for non-POST', () => {
    const res = handleCreateGame({ method: 'GET', body: {} });
    expect(res.status).toBe(405);
  });

  it('returns 201 with a new game on valid POST', () => {
    const res = handleCreateGame(makePostReq({}, { size: 'small' }));
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('small');
    expect(res.body.status).toBe('waiting');
  });

  it('returns 400 for invalid size', () => {
    const res = handleCreateGame(makePostReq({}, { size: 'giant' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/size/);
  });
});

// ---------------------------------------------------------------------------
// getGame (in-process)
// ---------------------------------------------------------------------------

describe('getGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('returns 405 for non-GET', () => {
    const res = getGame({ method: 'POST', params: { id: 'x' } });
    expect(res.status).toBe(405);
  });

  it('returns 400 when id is missing', () => {
    const res = getGame(makeGetReq({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/game id/i);
  });

  it('returns 404 for unknown game', () => {
    const res = getGame(makeGetReq({ id: 'nonexistent' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 with the game when found', () => {
    const game = createGame({ size: 'large' });
    const res = getGame(makeGetReq({ id: game.gameId }));
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe(game.gameId);
    expect(res.body.size).toBe('large');
  });
});

// ---------------------------------------------------------------------------
// handleStartGame
// ---------------------------------------------------------------------------

describe('handleStartGame', () => {
  it('returns 405 for non-POST', async () => {
    const res = await handleStartGame({ method: 'GET', params: { gameId: 'g1' }, body: null });
    expect(res.status).toBe(405);
  });

  it('returns 400 when gameId is missing from params', async () => {
    const res = await handleStartGame(makePostReq({}, { scale: 'medium' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/);
  });

  it('returns 204 without calling fetch when no game server URL is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium' }),
      null,
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(204);
    // Fire-and-forget is enqueued as a microtask; flush the queue.
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 204 and notifies the managed server with gameId and scale', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'large' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/games/g1/start');
    expect(opts.method).toBe('POST');
    const payload = JSON.parse(opts.body);
    expect(payload.scale).toBe('large');
  });

  it('URL-encodes the gameId in the notify request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    await handleStartGame(
      makePostReq({ gameId: 'game/with/slashes' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    await new Promise(r => setTimeout(r, 0));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/games/game%2Fwith%2Fslashes/start');
  });

  it('silently swallows notify errors so the 204 response is unaffected', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    // Should not throw after the rejected promise is handled.
    await expect(new Promise(r => setTimeout(r, 10))).resolves.toBeUndefined();
  });

  // Task 74 — configurable hiding duration
  it('returns 400 when hidingDurationMin is below scale minimum', async () => {
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small', hidingDurationMin: 10 }),
      null,
      undefined,
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/out of range/i);
  });

  it('returns 400 when hidingDurationMin exceeds scale maximum', async () => {
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium', hidingDurationMin: 300 }),
      null,
      undefined,
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/out of range/i);
  });

  it('returns 400 when hidingDurationMin is set but scale is missing', async () => {
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { hidingDurationMin: 45 }),
      null,
      undefined,
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scale required/i);
  });

  it('passes hidingDurationMs to managed server when hidingDurationMin is valid', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small', hidingDurationMin: 45 }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    await new Promise(r => setTimeout(r, 0));
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.hidingDurationMs).toBe(45 * 60_000);
    expect(payload.seekingDurationMs).toBe(45 * 60_000);
  });

  it('SCALE_DURATION_RANGES exports correct bounds for each scale', () => {
    expect(SCALE_DURATION_RANGES.small).toEqual({ min: 30, max: 60 });
    expect(SCALE_DURATION_RANGES.medium).toEqual({ min: 60, max: 180 });
    expect(SCALE_DURATION_RANGES.large).toEqual({ min: 180, max: 360 });
  });

  // Task 98 — minimum player count validation
  it('returns 400 insufficient_players when pool shows no hider', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ role: 'seeker', count: 2 }] }),
    };
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium' }),
      pool,
      'http://game-server',
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_players');
    expect(res.body.message).toMatch(/hider/i);
  });

  it('returns 400 insufficient_players when pool shows no seeker', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ role: 'hider', count: 1 }] }),
    };
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium' }),
      pool,
      'http://game-server',
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_players');
    expect(res.body.message).toMatch(/seeker/i);
  });

  it('returns 204 and fires notify when pool confirms hider, seeker, and zone present', async () => {
    const pool = { query: vi.fn() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'hider', count: 1 }, { role: 'seeker', count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'z1', game_id: 'g1', station_id: 's1', lat: 1, lon: 2, radius_m: 300, locked_at: null }] });
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      pool,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  // Task 101 — hider zone requirement before game start
  it('returns 400 no_hider_zone when pool shows no zone set for game', async () => {
    const pool = { query: vi.fn() };
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'hider', count: 1 }, { role: 'seeker', count: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      pool,
      'http://game-server',
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_hider_zone');
    expect(res.body.message).toMatch(/hiding zone/i);
  });

  it('skips zone check when pool is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// cleanupStaleGames
// ---------------------------------------------------------------------------

describe('cleanupStaleGames', () => {
  const VALID_TOKEN = 'secret-key';

  function makeCleanupReq(body = {}, token = VALID_TOKEN) {
    return {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    };
  }

  it('returns 405 for non-POST methods', async () => {
    const req = { method: 'GET', headers: { authorization: `Bearer ${VALID_TOKEN}` }, body: null };
    const res = await cleanupStaleGames(req, null, VALID_TOKEN);
    expect(res.status).toBe(405);
  });

  it('returns 401 when no auth token provided', async () => {
    const res = await cleanupStaleGames(makeCleanupReq({}, null), null, VALID_TOKEN);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 when wrong auth token provided', async () => {
    const res = await cleanupStaleGames(makeCleanupReq({}, 'wrong'), null, VALID_TOKEN);
    expect(res.status).toBe(401);
  });

  it('returns 200 with deletedCount from pool', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'g1' }, { id: 'g2' }] }),
    };
    const res = await cleanupStaleGames(makeCleanupReq({}), pool, VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deletedCount: 2 });
  });

  it('defaults maxAgeHours to 24 when not provided', async () => {
    const capturedParams = [];
    const pool = {
      query: vi.fn((sql, params) => {
        capturedParams.push(params);
        return Promise.resolve({ rows: [] });
      }),
    };
    await cleanupStaleGames(makeCleanupReq({}), pool, VALID_TOKEN);
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(capturedParams[0]).toEqual([expectedMs]);
  });

  it('passes custom maxAgeHours through to dbCleanupStaleGames', async () => {
    const capturedParams = [];
    const pool = {
      query: vi.fn((sql, params) => {
        capturedParams.push(params);
        return Promise.resolve({ rows: [] });
      }),
    };
    await cleanupStaleGames(makeCleanupReq({ maxAgeHours: 48 }), pool, VALID_TOKEN);
    const expectedMs = 48 * 60 * 60 * 1000;
    expect(capturedParams[0]).toEqual([expectedMs]);
  });

  it('returns deletedCount 0 when no pool provided', async () => {
    const res = await cleanupStaleGames(makeCleanupReq({}), null, VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deletedCount: 0 });
  });
});

describe('POST /games/cleanup via router — auth enforcement', () => {
  it('returns 401 when Authorization header is missing', async () => {
    // Set ADMIN_API_KEY so that checkAdminAuth returns 401 (missing token)
    // rather than 503 (key not configured).
    const originalKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'test-key';
    try {
      const { status, body } = await new Promise((resolve) => {
        const reqEvents = {};
        const mockReq = {
          method: 'POST',
          url: '/games/cleanup',
          headers: { host: 'localhost' },
          socket: { remoteAddress: '127.0.0.1' },
          on: (event, cb) => { reqEvents[event] = cb; return mockReq; },
        };
        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn((data) => {
            resolve({ status: mockRes.writeHead.mock.calls[0][0], body: JSON.parse(data) });
          }),
        };
        handleRequest(mockReq, mockRes, { pool: null }).then(() => {});
        setTimeout(() => { if (reqEvents['end']) reqEvents['end'](); }, 0);
      });
      expect(status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    } finally {
      if (originalKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = originalKey;
    }
  });
});
