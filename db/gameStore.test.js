// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dbCreatePlayer,
  dbGetPlayer,
  dbCreateGame,
  dbGetGame,
  dbUpdateGameStatus,
  dbJoinGame,
  dbSubmitScore,
  dbGetGameScores,
} from './gameStore.js';

// ---------------------------------------------------------------------------
// Shared mock pool factory.
// Each test suite gets its own mockQuery so assertions stay isolated.
// ---------------------------------------------------------------------------
function makeMockPool(queryImpl) {
  return { query: vi.fn(queryImpl) };
}

// ---------------------------------------------------------------------------
// dbCreatePlayer
// ---------------------------------------------------------------------------

describe('dbCreatePlayer', () => {
  it('issues an INSERT and returns mapped player fields', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'uuid-1', name: 'Alice', created_at: '2026-01-01T00:00:00Z' }] }),
    );
    const player = await dbCreatePlayer(pool, { name: 'Alice' });
    expect(player).toEqual({ playerId: 'uuid-1', name: 'Alice', createdAt: '2026-01-01T00:00:00Z' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO players'),
      ['Alice'],
    );
  });

  it('propagates query errors to the caller', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('db down')));
    await expect(dbCreatePlayer(pool, { name: 'Bob' })).rejects.toThrow('db down');
  });
});

// ---------------------------------------------------------------------------
// dbGetPlayer
// ---------------------------------------------------------------------------

describe('dbGetPlayer', () => {
  it('returns a mapped player when found', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'uuid-2', name: 'Carol', created_at: '2026-02-01T00:00:00Z' }] }),
    );
    const player = await dbGetPlayer(pool, 'uuid-2');
    expect(player).toEqual({ playerId: 'uuid-2', name: 'Carol', createdAt: '2026-02-01T00:00:00Z' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['uuid-2'],
    );
  });

  it('returns null when player does not exist', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const player = await dbGetPlayer(pool, 'nonexistent');
    expect(player).toBeNull();
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('timeout')));
    await expect(dbGetPlayer(pool, 'uuid-x')).rejects.toThrow('timeout');
  });
});

// ---------------------------------------------------------------------------
// dbCreateGame
// ---------------------------------------------------------------------------

describe('dbCreateGame', () => {
  it('issues an INSERT and returns mapped game fields', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{
          id: 'game-1', size: 'medium', bounds: {}, status: 'waiting', created_at: '2026-01-01T00:00:00Z',
        }],
      }),
    );
    const game = await dbCreateGame(pool, { size: 'medium' });
    expect(game).toEqual({
      gameId: 'game-1', size: 'medium', bounds: {}, status: 'waiting', createdAt: '2026-01-01T00:00:00Z',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO games'),
      ['medium', JSON.stringify({})],
    );
  });

  it('serialises custom bounds to JSON', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 'game-2', size: 'large', bounds: { lat_min: 1 }, status: 'waiting', created_at: '' }],
      }),
    );
    const bounds = { lat_min: 1, lat_max: 2, lon_min: 3, lon_max: 4 };
    await dbCreateGame(pool, { size: 'large', bounds });
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['large', JSON.stringify(bounds)],
    );
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('constraint')));
    await expect(dbCreateGame(pool, { size: 'small' })).rejects.toThrow('constraint');
  });
});

// ---------------------------------------------------------------------------
// dbGetGame
// ---------------------------------------------------------------------------

describe('dbGetGame', () => {
  it('returns null when game does not exist', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const game = await dbGetGame(pool, 'no-such-id');
    expect(game).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('returns game with empty players list when no one has joined', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'g1', size: 'small', bounds: {}, status: 'waiting', created_at: '2026-01-01' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const poolWithPlayers = { query: mockQuery };
    const game = await dbGetGame(poolWithPlayers, 'g1');
    expect(game.gameId).toBe('g1');
    expect(game.players).toEqual([]);
  });

  it('includes players joined to the game', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'g2', size: 'medium', bounds: {}, status: 'hiding', created_at: '2026-02-01' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'p1', name: 'Alice', role: 'hider', joined_at: '2026-02-01T01:00:00Z' },
          { id: 'p2', name: 'Bob', role: 'seeker', joined_at: '2026-02-01T01:01:00Z' },
        ],
      });
    const pool = { query: mockQuery };
    const game = await dbGetGame(pool, 'g2');
    expect(game.players).toHaveLength(2);
    expect(game.players[0]).toEqual({ playerId: 'p1', name: 'Alice', role: 'hider', joinedAt: '2026-02-01T01:00:00Z' });
    expect(game.players[1]).toEqual({ playerId: 'p2', name: 'Bob', role: 'seeker', joinedAt: '2026-02-01T01:01:00Z' });
  });

  it('propagates errors from the first query', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('timeout')));
    await expect(dbGetGame(pool, 'g-x')).rejects.toThrow('timeout');
  });
});

// ---------------------------------------------------------------------------
// dbUpdateGameStatus
// ---------------------------------------------------------------------------

describe('dbUpdateGameStatus', () => {
  it('returns updated status when game exists', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'g3', status: 'seeking' }] }),
    );
    const result = await dbUpdateGameStatus(pool, { gameId: 'g3', status: 'seeking' });
    expect(result).toEqual({ gameId: 'g3', status: 'seeking' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE games'),
      ['seeking', 'g3'],
    );
  });

  it('returns null when game does not exist', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const result = await dbUpdateGameStatus(pool, { gameId: 'missing', status: 'finished' });
    expect(result).toBeNull();
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('fk violation')));
    await expect(dbUpdateGameStatus(pool, { gameId: 'g', status: 'hiding' })).rejects.toThrow('fk violation');
  });
});

// ---------------------------------------------------------------------------
// dbJoinGame
// ---------------------------------------------------------------------------

describe('dbJoinGame', () => {
  it('inserts a game_players row and returns mapped fields', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ game_id: 'g1', player_id: 'p1', role: 'hider', joined_at: '2026-01-01T00:00:00Z' }],
      }),
    );
    const result = await dbJoinGame(pool, { gameId: 'g1', playerId: 'p1', role: 'hider' });
    expect(result).toEqual({ gameId: 'g1', playerId: 'p1', role: 'hider', joinedAt: '2026-01-01T00:00:00Z' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO game_players'),
      ['g1', 'p1', 'hider'],
    );
  });

  it('propagates constraint errors (duplicate join)', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('unique constraint')));
    await expect(dbJoinGame(pool, { gameId: 'g1', playerId: 'p1', role: 'seeker' })).rejects.toThrow('unique constraint');
  });
});

// ---------------------------------------------------------------------------
// dbSubmitScore
// ---------------------------------------------------------------------------

describe('dbSubmitScore', () => {
  it('upserts a score row and returns mapped fields', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{
          id: 's1', game_id: 'g1', player_id: 'p1',
          score_seconds: 3600, captured_at: '2026-01-01T01:00:00Z', created_at: '2026-01-01T00:00:00Z',
        }],
      }),
    );
    const result = await dbSubmitScore(pool, {
      gameId: 'g1', playerId: 'p1', scoreSeconds: 3600, capturedAt: '2026-01-01T01:00:00Z',
    });
    expect(result).toEqual({
      scoreId: 's1', gameId: 'g1', playerId: 'p1',
      scoreSeconds: 3600, capturedAt: '2026-01-01T01:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO scores'),
      ['g1', 'p1', 3600, '2026-01-01T01:00:00Z'],
    );
  });

  it('passes null capturedAt when hider was not caught', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 's2', game_id: 'g2', player_id: 'p2', score_seconds: 7200, captured_at: null, created_at: '' }],
      }),
    );
    await dbSubmitScore(pool, { gameId: 'g2', playerId: 'p2', scoreSeconds: 7200 });
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['g2', 'p2', 7200, null]);
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('fk error')));
    await expect(dbSubmitScore(pool, { gameId: 'g', playerId: 'p', scoreSeconds: 0 })).rejects.toThrow('fk error');
  });
});

// ---------------------------------------------------------------------------
// dbGetGameScores
// ---------------------------------------------------------------------------

describe('dbGetGameScores', () => {
  it('returns scores ordered by score_seconds descending', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [
          { id: 's1', game_id: 'g1', player_id: 'p1', score_seconds: 7200, captured_at: null, created_at: '2026-01-01' },
          { id: 's2', game_id: 'g1', player_id: 'p2', score_seconds: 3600, captured_at: '2026-01-01T01:00:00Z', created_at: '2026-01-01' },
        ],
      }),
    );
    const scores = await dbGetGameScores(pool, 'g1');
    expect(scores).toHaveLength(2);
    expect(scores[0].scoreSeconds).toBe(7200);
    expect(scores[1].scoreSeconds).toBe(3600);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE game_id = $1'),
      ['g1'],
    );
  });

  it('returns an empty array when there are no scores', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const scores = await dbGetGameScores(pool, 'g-empty');
    expect(scores).toEqual([]);
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('connection lost')));
    await expect(dbGetGameScores(pool, 'g-x')).rejects.toThrow('connection lost');
  });
});

// ---------------------------------------------------------------------------
// Handler integration: functions/ handlers with mock pool
// ---------------------------------------------------------------------------

import { registerPlayer } from '../functions/players.js';
import { createGame, getGame } from '../functions/games.js';
import { submitScore } from '../functions/scores.js';

describe('registerPlayer with pool', () => {
  it('returns 201 with player data from DB', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'db-p1', name: 'Dave', created_at: '2026-01-01T00:00:00Z' }] }),
    );
    const res = await registerPlayer({ method: 'POST', body: { name: 'Dave', role: 'hider' } }, pool);
    expect(res.status).toBe(201);
    expect(res.body.playerId).toBe('db-p1');
    expect(res.body.name).toBe('Dave');
    expect(res.body.role).toBe('hider');
  });

  it('still validates input before touching the pool', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const res = registerPlayer({ method: 'POST', body: { name: '', role: 'hider' } }, pool);
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('createGame with pool', () => {
  it('returns a game record from DB', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 'db-g1', size: 'small', bounds: {}, status: 'waiting', created_at: '2026-01-01' }],
      }),
    );
    const game = await createGame({ size: 'small' }, pool);
    expect(game.gameId).toBe('db-g1');
    expect(game.size).toBe('small');
  });

  it('still throws for invalid size before touching the pool', () => {
    const pool = makeMockPool(() => Promise.resolve());
    expect(() => createGame({ size: 'huge' }, pool)).toThrow(/size/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('getGame with pool', () => {
  it('returns 200 with game data from DB', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'db-g2', size: 'medium', bounds: {}, status: 'waiting', created_at: '' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await getGame({ method: 'GET', params: { id: 'db-g2' } }, { query: mockQuery });
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('db-g2');
  });

  it('returns 404 when game not in DB', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const res = await getGame({ method: 'GET', params: { id: 'missing' } }, pool);
    expect(res.status).toBe(404);
  });
});

describe('submitScore with pool', () => {
  it('returns 201 with score data from DB', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{
          id: 'db-s1', game_id: 'g1', player_id: 'p1',
          score_seconds: 3600, captured_at: null, created_at: '2026-01-01',
        }],
      }),
    );
    const res = await submitScore(
      { method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 3_600_000, captured: false } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.scoreId).toBe('db-s1');
    expect(res.body.hidingTimeMs).toBe(3_600_000);
    expect(res.body.captured).toBe(false);
  });

  it('converts hidingTimeMs to scoreSeconds correctly', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 's', game_id: 'g', player_id: 'p', score_seconds: 90, captured_at: null, created_at: '' }],
      }),
    );
    await submitScore(
      { method: 'POST', body: { playerId: 'p', gameId: 'g', hidingTimeMs: 90_000, captured: false } },
      pool,
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['g', 'p', 90, null],
    );
  });

  it('sets capturedAt when captured=true', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 's', game_id: 'g', player_id: 'p', score_seconds: 60, captured_at: '2026-01-01T01:01:00Z', created_at: '' }],
      }),
    );
    await submitScore(
      { method: 'POST', body: { playerId: 'p', gameId: 'g', hidingTimeMs: 60_000, captured: true } },
      pool,
    );
    const callArgs = pool.query.mock.calls[0][1];
    expect(callArgs[3]).not.toBeNull(); // capturedAt is set
  });
});
