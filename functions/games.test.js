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
  joinGame,
  _getGamePlayers,
  _clearGamePlayers,
  markReady,
  getReadyStatus,
  _getReadyPlayers,
  _clearReadyPlayers,
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

  it('stores hostPlayerId when provided', () => {
    const game = createGame({ size: 'small', hostPlayerId: 'player-99' });
    expect(game.hostPlayerId).toBe('player-99');
  });

  it('hostPlayerId defaults to null when not provided', () => {
    const game = createGame({ size: 'small' });
    expect(game.hostPlayerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleCreateGame (in-process)
// ---------------------------------------------------------------------------

describe('handleCreateGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('returns 405 for non-POST', async () => {
    const res = await handleCreateGame({ method: 'GET', body: {} });
    expect(res.status).toBe(405);
  });

  it('returns 201 with a new game on valid POST', async () => {
    const res = await handleCreateGame(makePostReq({}, { size: 'small' }));
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('small');
    expect(res.body.status).toBe('waiting');
  });

  it('returns 400 for invalid size', async () => {
    const res = await handleCreateGame(makePostReq({}, { size: 'giant' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/size/);
  });

  it('stores playerId as hostPlayerId in the created game', async () => {
    const res = await handleCreateGame(makePostReq({}, { size: 'small', playerId: 'player-42' }));
    expect(res.status).toBe(201);
    expect(res.body.hostPlayerId).toBe('player-42');
  });

  it('hostPlayerId is null when no playerId in body', async () => {
    const res = await handleCreateGame(makePostReq({}, { size: 'small' }));
    expect(res.status).toBe(201);
    expect(res.body.hostPlayerId).toBeNull();
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
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium' }),
      null,
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(204);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 204 and notifies the managed server with gameId and scale', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'large' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/games/g1/start');
    expect(opts.method).toBe('POST');
    const payload = JSON.parse(opts.body);
    expect(payload.scale).toBe('large');
  });

  it('URL-encodes the gameId in the notify request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await handleStartGame(
      makePostReq({ gameId: 'game/with/slashes' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/games/game%2Fwith%2Fslashes/start');
  });

  // Task 130 — game start must fail loudly when managed server is unavailable
  it('returns 503 when notifyGameStart throws a network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('game_server_unavailable');
    expect(res.body.message).toMatch(/Game server could not be reached/);
  });

  it('returns 503 when managed server responds with a non-2xx status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('game_server_unavailable');
  });

  it('returns 204 when notification succeeds with ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    expect(mockFetch).toHaveBeenCalledOnce();
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
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small', hidingDurationMin: 45 }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
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
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      pool,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
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
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
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

// ---------------------------------------------------------------------------
// joinGame (in-process)
// ---------------------------------------------------------------------------

describe('joinGame (in-process)', () => {
  beforeEach(() => _clearGamePlayers());

  it('returns 200 with gameId, playerId, role when valid', () => {
    const res = joinGame(
      { params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'hider' } },
      null,
    );
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('g1');
    expect(res.body.playerId).toBe('p1');
    expect(res.body.role).toBe('hider');
    expect(res.body.team).toBeNull();
  });

  it('returns 400 when playerId is missing', () => {
    const res = joinGame(
      { params: { gameId: 'g1' }, body: { role: 'seeker' } },
      null,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerId/i);
  });

  it('returns 400 when playerId is blank', () => {
    const res = joinGame(
      { params: { gameId: 'g1' }, body: { playerId: '  ', role: 'seeker' } },
      null,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerId/i);
  });

  it('returns 400 when role is invalid', () => {
    const res = joinGame(
      { params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'admin' } },
      null,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it('stores the player in the in-process game-players map', () => {
    joinGame(
      { params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } },
      null,
    );
    const gamePlayers = _getGamePlayers();
    expect(gamePlayers.get('g1')?.get('p1')).toEqual({ role: 'seeker', team: null });
  });

  it('is idempotent — second call returns the original record without duplication', () => {
    const req = { params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'hider' } };
    joinGame(req, null);
    const res2 = joinGame(req, null);
    expect(res2.status).toBe(200);
    expect(res2.body.role).toBe('hider');
    // Only one entry in the map
    expect(_getGamePlayers().get('g1').size).toBe(1);
  });

  it('includes team in the response when provided', () => {
    const res = joinGame(
      { params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker', team: 'A' } },
      null,
    );
    expect(res.status).toBe(200);
    expect(res.body.team).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// handleCreateGame (with pool) — regression test for the SCHEMA_SQL drift bug
// ---------------------------------------------------------------------------
// Root cause: db/db.js SCHEMA_SQL was missing seeker_teams and host_player_id
// columns, so dbCreateGame's INSERT failed in production with
// "column seeker_teams does not exist".  This suite ensures the DB path works.

describe('handleCreateGame (with pool)', () => {
  it('returns 201 with gameId and status when pool resolves', async () => {
    const mockRow = {
      id: 'game-uuid-1',
      size: 'medium',
      bounds: {},
      status: 'waiting',
      seeker_teams: 0,
      host_player_id: null,
      created_at: new Date().toISOString(),
    };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [mockRow] }) };
    const res = await handleCreateGame(
      { method: 'POST', body: { size: 'medium', bounds: {}, seekerTeams: 0 } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.gameId).toBe('game-uuid-1');
    expect(res.body.status).toBe('waiting');
  });

  it('passes seeker_teams to the INSERT query', async () => {
    const mockRow = {
      id: 'game-uuid-2',
      size: 'small',
      bounds: {},
      status: 'waiting',
      seeker_teams: 2,
      host_player_id: 'player-1',
      created_at: new Date().toISOString(),
    };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [mockRow] }) };
    const res = await handleCreateGame(
      { method: 'POST', body: { size: 'small', bounds: {}, seekerTeams: 2, playerId: 'player-1' } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.seekerTeams).toBe(2);
    expect(res.body.hostPlayerId).toBe('player-1');
    // Verify the INSERT query included seeker_teams and host_player_id columns.
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/seeker_teams/);
    expect(sql).toMatch(/host_player_id/);
  });

  it('returns 400 when pool query rejects with a validation error', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('invalid size')) };
    const res = await handleCreateGame(
      { method: 'POST', body: { size: 'invalid', bounds: {} } },
      pool,
    );
    // 400 from the createGame validation (size check fires before pool.query).
    expect(res.status).toBe(400);
  });

  // Task 174 — async error handling gap: dbCreateGame rejections must be caught
  // and returned as a structured response instead of propagating to the router.
  it('returns 400 when dbCreateGame rejects (e.g. FK violation or DB cold start)', async () => {
    // Pool.query resolves validation but rejects on INSERT — simulates a FK
    // constraint failure when host_player_id is not yet in the players table.
    const pool = {
      query: vi.fn().mockRejectedValue(
        new Error('insert or update on table "games" violates foreign key constraint'),
      ),
    };
    const res = await handleCreateGame(
      { method: 'POST', body: { size: 'medium', bounds: {}, seekerTeams: 0, playerId: 'nonexistent-player' } },
      pool,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    // Crucially the rejection must NOT propagate — the handler must resolve.
    expect(typeof res.status).toBe('number');
  });
});

describe('joinGame (with pool)', () => {
  it('calls dbJoinGame with pool and returns 200 on success', async () => {
    // Pool rows must use snake_case column names as returned by Postgres.
    const mockRow = { game_id: 'g1', player_id: 'p1', role: 'seeker', team: null, joined_at: new Date() };
    const pool = {
      query: vi.fn()
        // seeker_teams lookup (dbJoinGame checks seeker_teams for auto-assign)
        .mockResolvedValueOnce({ rows: [{ seeker_teams: 0 }] })
        // INSERT ... ON CONFLICT DO NOTHING RETURNING
        .mockResolvedValueOnce({ rows: [mockRow] }),
    };
    const res = await joinGame(
      { params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe('p1');
    expect(res.body.role).toBe('seeker');
  });
});

// ---------------------------------------------------------------------------
// markReady / getReadyStatus (Task 154)
// RULES.md §Setup — "All players begin at a common starting point."
// ---------------------------------------------------------------------------

describe('markReady (in-process)', () => {
  beforeEach(() => {
    _clearReadyPlayers();
    _clearGamePlayers();
    _clearStore();
  });

  it('returns 400 when gameId is missing', () => {
    const res = markReady({ params: {}, body: { playerId: 'p1' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/i);
  });

  it('returns 400 when playerId is missing', () => {
    const res = markReady({ params: { gameId: 'g1' }, body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerId/i);
  });

  it('marks a player ready and returns readyCount: 1', () => {
    // Simulate a joined player so totalCount reflects correctly.
    joinGame({ params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } });

    const res = markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1', ready: true } });

    expect(res.status).toBe(200);
    expect(res.body.readyCount).toBe(1);
    expect(res.body.totalCount).toBe(1);
  });

  it('calling markReady with the same playerId twice is idempotent', () => {
    joinGame({ params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } });
    markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1', ready: true } });

    const res = markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1', ready: true } });

    expect(res.body.readyCount).toBe(1);
  });

  it('removes a player from ready set when ready:false', () => {
    joinGame({ params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } });
    markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1', ready: true } });

    const res = markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1', ready: false } });

    expect(res.status).toBe(200);
    expect(res.body.readyCount).toBe(0);
    expect(res.body.totalCount).toBe(1);
  });

  it('ready defaults to true when not specified', () => {
    joinGame({ params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } });

    const res = markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1' } });

    expect(res.body.readyCount).toBe(1);
  });
});

describe('getReadyStatus (in-process)', () => {
  beforeEach(() => {
    _clearReadyPlayers();
    _clearGamePlayers();
  });

  it('returns 400 when gameId is missing', () => {
    const res = getReadyStatus({ params: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/i);
  });

  it('returns readyCount:0 and totalCount:0 for a game with no activity', () => {
    const res = getReadyStatus({ params: { gameId: 'g1' } });
    expect(res.status).toBe(200);
    expect(res.body.readyCount).toBe(0);
    expect(res.body.totalCount).toBe(0);
  });

  it('reflects current ready and total counts after joins and readies', () => {
    joinGame({ params: { gameId: 'g1' }, body: { playerId: 'p1', role: 'seeker' } });
    joinGame({ params: { gameId: 'g1' }, body: { playerId: 'p2', role: 'hider' } });
    markReady({ params: { gameId: 'g1' }, body: { playerId: 'p1', ready: true } });

    const res = getReadyStatus({ params: { gameId: 'g1' } });

    expect(res.body.readyCount).toBe(1);
    expect(res.body.totalCount).toBe(2);
  });
});
