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
  dbCreateQuestion,
  dbGetQuestionsForPlayer,
  dbGetQuestionsForGame,
  dbExpireStaleQuestions,
  dbSetCurse,
  dbGetCurseExpiry,
  createInstrumentedStore,
} from './gameStore.js';
import { MetricsCollector, MetricKey } from '../server/monitoring.js';

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
          id: 'game-1', size: 'medium', bounds: {}, status: 'waiting',
          seeker_teams: 0, created_at: '2026-01-01T00:00:00Z',
        }],
      }),
    );
    const game = await dbCreateGame(pool, { size: 'medium' });
    expect(game).toEqual({
      gameId: 'game-1', size: 'medium', bounds: {}, status: 'waiting',
      seekerTeams: 0, createdAt: '2026-01-01T00:00:00Z',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO games'),
      ['medium', JSON.stringify({}), 0],
    );
  });

  it('stores seekerTeams = 2 for two-team games', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 'game-t', size: 'medium', bounds: {}, status: 'waiting', seeker_teams: 2, created_at: '' }],
      }),
    );
    const game = await dbCreateGame(pool, { size: 'medium', seekerTeams: 2 });
    expect(game.seekerTeams).toBe(2);
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['medium', JSON.stringify({}), 2],
    );
  });

  it('serialises custom bounds to JSON', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 'game-2', size: 'large', bounds: { lat_min: 1 }, status: 'waiting', seeker_teams: 0, created_at: '' }],
      }),
    );
    const bounds = { lat_min: 1, lat_max: 2, lon_min: 3, lon_max: 4 };
    await dbCreateGame(pool, { size: 'large', bounds });
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['large', JSON.stringify(bounds), 0],
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
        rows: [{ id: 'g1', size: 'small', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: '2026-01-01' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const poolWithPlayers = { query: mockQuery };
    const game = await dbGetGame(poolWithPlayers, 'g1');
    expect(game.gameId).toBe('g1');
    expect(game.players).toEqual([]);
    expect(game.seekerTeams).toBe(0);
  });

  it('includes players joined to the game with team field', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'g2', size: 'medium', bounds: {}, status: 'hiding', seeker_teams: 2, created_at: '2026-02-01' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'p1', name: 'Alice', role: 'hider', team: null, joined_at: '2026-02-01T01:00:00Z' },
          { id: 'p2', name: 'Bob', role: 'seeker', team: 'A',   joined_at: '2026-02-01T01:01:00Z' },
        ],
      });
    const pool = { query: mockQuery };
    const game = await dbGetGame(pool, 'g2');
    expect(game.players).toHaveLength(2);
    expect(game.players[0]).toEqual({ playerId: 'p1', name: 'Alice', role: 'hider', team: null, joinedAt: '2026-02-01T01:00:00Z' });
    expect(game.players[1]).toEqual({ playerId: 'p2', name: 'Bob', role: 'seeker', team: 'A', joinedAt: '2026-02-01T01:01:00Z' });
    expect(game.seekerTeams).toBe(2);
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
  it('inserts a game_players row (hider) and returns mapped fields with team: null', async () => {
    // Hiders skip the seeker_teams lookup; only one query needed.
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ game_id: 'g1', player_id: 'p1', role: 'hider', team: null, joined_at: '2026-01-01T00:00:00Z' }],
      }),
    );
    const result = await dbJoinGame(pool, { gameId: 'g1', playerId: 'p1', role: 'hider' });
    expect(result).toEqual({ gameId: 'g1', playerId: 'p1', role: 'hider', team: null, joinedAt: '2026-01-01T00:00:00Z' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO game_players'),
      ['g1', 'p1', 'hider', null],
    );
  });

  it('auto-assigns Team A to the first seeker in a two-team game', async () => {
    // Query 1: seeker_teams = 2; Query 2: no existing seekers; Query 3: INSERT
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ seeker_teams: 2 }] })  // games lookup
        .mockResolvedValueOnce({ rows: [] })                       // team count (no seekers yet)
        .mockResolvedValueOnce({ rows: [{ game_id: 'g1', player_id: 'p2', role: 'seeker', team: 'A', joined_at: '' }] }),
    };
    const result = await dbJoinGame(pool, { gameId: 'g1', playerId: 'p2', role: 'seeker' });
    expect(result.team).toBe('A');
    expect(pool.query.mock.calls[2][1]).toEqual(['g1', 'p2', 'seeker', 'A']);
  });

  it('auto-assigns Team B to balance teams in a two-team game', async () => {
    // Query 1: seeker_teams = 2; Query 2: 1 Team A seeker, 0 Team B; Query 3: INSERT
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ seeker_teams: 2 }] })
        .mockResolvedValueOnce({ rows: [{ team: 'A', cnt: '1' }] })
        .mockResolvedValueOnce({ rows: [{ game_id: 'g1', player_id: 'p3', role: 'seeker', team: 'B', joined_at: '' }] }),
    };
    const result = await dbJoinGame(pool, { gameId: 'g1', playerId: 'p3', role: 'seeker' });
    expect(result.team).toBe('B');
  });

  it('does not query seeker_teams for hiders (only INSERT query)', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ game_id: 'g1', player_id: 'p1', role: 'hider', team: null, joined_at: '' }],
      }),
    );
    await dbJoinGame(pool, { gameId: 'g1', playerId: 'p1', role: 'hider' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('propagates constraint errors (duplicate join)', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('unique constraint')));
    await expect(dbJoinGame(pool, { gameId: 'g1', playerId: 'p1', role: 'hider' })).rejects.toThrow('unique constraint');
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
          score_seconds: 3600, bonus_seconds: 0, captured_at: '2026-01-01T01:00:00Z', created_at: '2026-01-01T00:00:00Z',
        }],
      }),
    );
    const result = await dbSubmitScore(pool, {
      gameId: 'g1', playerId: 'p1', scoreSeconds: 3600, capturedAt: '2026-01-01T01:00:00Z',
    });
    expect(result).toEqual({
      scoreId: 's1', gameId: 'g1', playerId: 'p1',
      scoreSeconds: 3600, bonusSeconds: 0, capturedAt: '2026-01-01T01:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO scores'),
      ['g1', 'p1', 3600, 0, '2026-01-01T01:00:00Z'],
    );
  });

  it('passes null capturedAt when hider was not caught', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 's2', game_id: 'g2', player_id: 'p2', score_seconds: 7200, bonus_seconds: 0, captured_at: null, created_at: '' }],
      }),
    );
    await dbSubmitScore(pool, { gameId: 'g2', playerId: 'p2', scoreSeconds: 7200 });
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['g2', 'p2', 7200, 0, null]);
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
          { id: 's1', game_id: 'g1', player_id: 'p1', score_seconds: 7200, bonus_seconds: 0, captured_at: null, created_at: '2026-01-01' },
          { id: 's2', game_id: 'g1', player_id: 'p2', score_seconds: 3600, bonus_seconds: 0, captured_at: '2026-01-01T01:00:00Z', created_at: '2026-01-01' },
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
// createInstrumentedStore — metrics tracking
// ---------------------------------------------------------------------------

describe('createInstrumentedStore — DB_READS counter', () => {
  it('increments DB_READS on dbGetPlayer success', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'p1', name: 'Alice', created_at: '' }] }),
    );
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbGetPlayer('p1');
    expect(metrics.getSnapshot()[MetricKey.DB_READS]).toBe(1);
  });

  it('increments DB_READS on dbGetGame success', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'g1', size: 'small', bounds: {}, status: 'waiting', created_at: '' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbGetGame('g1');
    expect(metrics.getSnapshot()[MetricKey.DB_READS]).toBe(1);
  });

  it('increments DB_READS on dbGetGameScores success', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbGetGameScores('g1');
    expect(metrics.getSnapshot()[MetricKey.DB_READS]).toBe(1);
  });
});

describe('createInstrumentedStore — DB_WRITES counter', () => {
  it('increments DB_WRITES on dbCreatePlayer success', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'p1', name: 'Bob', created_at: '' }] }),
    );
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbCreatePlayer({ name: 'Bob' });
    expect(metrics.getSnapshot()[MetricKey.DB_WRITES]).toBe(1);
  });

  it('increments DB_WRITES on dbCreateGame success', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'g1', size: 'small', bounds: {}, status: 'waiting', created_at: '' }] }),
    );
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbCreateGame({ size: 'small' });
    expect(metrics.getSnapshot()[MetricKey.DB_WRITES]).toBe(1);
  });

  it('increments DB_WRITES on dbJoinGame success', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ game_id: 'g1', player_id: 'p1', role: 'hider', team: null, joined_at: '' }] }),
    );
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbJoinGame({ gameId: 'g1', playerId: 'p1', role: 'hider' });
    expect(metrics.getSnapshot()[MetricKey.DB_WRITES]).toBe(1);
  });

  it('accumulates DB_WRITES across multiple successful writes', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'p1', name: 'Carol', created_at: '' }] }),
    );
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await store.dbCreatePlayer({ name: 'Carol' });
    await store.dbCreatePlayer({ name: 'Dave' });
    expect(metrics.getSnapshot()[MetricKey.DB_WRITES]).toBe(2);
  });
});

describe('createInstrumentedStore — ERRORS counter', () => {
  it('increments ERRORS on read failure and re-throws', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('read failure')));
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await expect(store.dbGetPlayer('p1')).rejects.toThrow('read failure');
    expect(metrics.getSnapshot()[MetricKey.ERRORS]).toBe(1);
    expect(metrics.getSnapshot()[MetricKey.DB_READS]).toBe(0);
  });

  it('increments ERRORS on write failure and re-throws', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('write failure')));
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await expect(store.dbCreatePlayer({ name: 'Eve' })).rejects.toThrow('write failure');
    expect(metrics.getSnapshot()[MetricKey.ERRORS]).toBe(1);
    expect(metrics.getSnapshot()[MetricKey.DB_WRITES]).toBe(0);
  });

  it('does not increment READS or WRITES on failure', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('db down')));
    const metrics = new MetricsCollector();
    const store = createInstrumentedStore(pool, metrics);
    await expect(store.dbGetGameScores('g1')).rejects.toThrow();
    const snap = metrics.getSnapshot();
    expect(snap[MetricKey.DB_READS]).toBe(0);
    expect(snap[MetricKey.DB_WRITES]).toBe(0);
  });
});

describe('createInstrumentedStore — isolation', () => {
  it('separate stores with separate metrics do not share counts', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ id: 'p1', name: 'Frank', created_at: '' }] }),
    );
    const m1 = new MetricsCollector();
    const m2 = new MetricsCollector();
    const store1 = createInstrumentedStore(pool, m1);
    const store2 = createInstrumentedStore(pool, m2);
    await store1.dbCreatePlayer({ name: 'Frank' });
    expect(m1.getSnapshot()[MetricKey.DB_WRITES]).toBe(1);
    expect(m2.getSnapshot()[MetricKey.DB_WRITES]).toBe(0);
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
        rows: [{ id: 'db-g1', size: 'small', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: '2026-01-01' }],
      }),
    );
    const game = await createGame({ size: 'small' }, pool);
    expect(game.gameId).toBe('db-g1');
    expect(game.size).toBe('small');
  });

  it('passes seekerTeams to DB', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 'db-g2', size: 'medium', bounds: {}, status: 'waiting', seeker_teams: 2, created_at: '' }],
      }),
    );
    const game = await createGame({ size: 'medium', seekerTeams: 2 }, pool);
    expect(game.seekerTeams).toBe(2);
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['medium', expect.any(String), 2],
    );
  });

  it('throws for invalid seekerTeams value', () => {
    expect(() => createGame({ size: 'small', seekerTeams: 3 })).toThrow(/seekerTeams/i);
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
          score_seconds: 3600, bonus_seconds: 0, captured_at: null, created_at: '2026-01-01',
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
        rows: [{ id: 's', game_id: 'g', player_id: 'p', score_seconds: 90, bonus_seconds: 0, captured_at: null, created_at: '' }],
      }),
    );
    await submitScore(
      { method: 'POST', body: { playerId: 'p', gameId: 'g', hidingTimeMs: 90_000, captured: false } },
      pool,
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['g', 'p', 90, 0, null],
    );
  });

  it('sets capturedAt when captured=true', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({
        rows: [{ id: 's', game_id: 'g', player_id: 'p', score_seconds: 60, bonus_seconds: 0, captured_at: '2026-01-01T01:01:00Z', created_at: '' }],
      }),
    );
    await submitScore(
      { method: 'POST', body: { playerId: 'p', gameId: 'g', hidingTimeMs: 60_000, captured: true } },
      pool,
    );
    const callArgs = pool.query.mock.calls[0][1];
    expect(callArgs[4]).not.toBeNull(); // capturedAt is set (index 4 after bonusSeconds)
  });
});

// ---------------------------------------------------------------------------
// dbCreateQuestion — pending-question conflict check and expires_at
// ---------------------------------------------------------------------------

describe('dbCreateQuestion', () => {
  it('returns conflict:true when a pending question already exists for the game', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-q' }] }),
    };
    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    });
    expect(result).toEqual({ conflict: true });
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('inserts and returns a question with expiresAt when no pending question exists', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // pending check
        .mockResolvedValueOnce({ rows: [{
          id: 'q-1', game_id: 'g1', asker_id: 'a1', target_id: 't1',
          category: 'matching', text: 'test', status: 'pending',
          expires_at: expiresAt, created_at: new Date(),
        }] }),
    };
    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    });
    expect(result.questionId).toBe('q-1');
    expect(result.expiresAt).toBeDefined();
    expect(result.status).toBe('pending');
  });

  it('passes a longer expires_at for photo category than for standard', async () => {
    const capturedExpiry = {};
    // Photo pool: pending check + SELECT games (for scale) + INSERT.
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                         // pending check
        .mockResolvedValueOnce({ rows: [{ size: 'medium' }] })       // SELECT size FROM games
        .mockImplementationOnce((sql, params) => {
          capturedExpiry.photo = params[5];
          return Promise.resolve({ rows: [{
            id: 'q-p', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'photo', text: 'snap', status: 'pending',
            expires_at: params[5], created_at: new Date(),
          }] });
        }),
    };
    // Standard (non-photo) pool: pending check + INSERT only (no SELECT games).
    const pool2 = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockImplementationOnce((sql, params) => {
          capturedExpiry.standard = params[5];
          return Promise.resolve({ rows: [{
            id: 'q-s', game_id: 'g2', asker_id: 'a1', target_id: 't1',
            category: 'matching', text: 'test', status: 'pending',
            expires_at: params[5], created_at: new Date(),
          }] });
        }),
    };
    await dbCreateQuestion(pool, { gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'photo', text: 'snap' });
    await dbCreateQuestion(pool2, { gameId: 'g2', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test' });
    expect(new Date(capturedExpiry.photo) > new Date(capturedExpiry.standard)).toBe(true);
  });

  it('propagates query errors from pending check', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('db error')));
    await expect(dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    })).rejects.toThrow('db error');
  });

  it('uses team-scoped pending check when askerTeam is provided', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // pending check (team-scoped, no conflict)
        .mockResolvedValueOnce({ rows: [{
          id: 'q-team', game_id: 'g1', asker_id: 'a1', target_id: 't1',
          category: 'matching', text: 'team q', status: 'pending',
          expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        }] }),
    };
    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'team q',
      askerTeam: 'A',
    });
    expect(result.questionId).toBe('q-team');
    // Verify the pending check used a JOIN to scope by team
    const pendingCheckSql = pool.query.mock.calls[0][0];
    expect(pendingCheckSql).toContain('game_players');
  });

  it('reports conflict when same team has a pending question', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'existing' }] }),
    };
    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'conflict',
      askerTeam: 'A',
    });
    expect(result).toEqual({ conflict: true });
  });

  it.each(['measuring', 'transit'])('creates a question with category %s', async (category) => {
    const expiresAt = new Date(Date.now() + 300_000);
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // pending check
        .mockResolvedValueOnce({ rows: [{
          id: `q-${category}`, game_id: 'g1', asker_id: 'a1', target_id: 't1',
          category, text: `test ${category}`, status: 'pending',
          expires_at: expiresAt, created_at: new Date(),
        }] }),
    };
    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category, text: `test ${category}`,
    });
    expect(result.questionId).toBe(`q-${category}`);
    expect(result.category).toBe(category);
    expect(result.status).toBe('pending');
    // Verify the INSERT SQL received the correct category value.
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[1][3]).toBe(category);
  });

  // Photo expiry by game scale — RULES.md: 10 min small, 15 min medium, 20 min large.
  it.each([
    ['small',  10 * 60 * 1000],
    ['medium', 15 * 60 * 1000],
    ['large',  20 * 60 * 1000],
  ])('uses correct photo expiry for game scale %s (%i ms)', async (scale, expectedMs) => {
    const capturedExpiry = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // pending check (no conflict)
        .mockImplementationOnce((sql, params) => {
          capturedExpiry.expiresAt = params[5];
          return Promise.resolve({ rows: [{
            id: `q-photo-${scale}`, game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'photo', text: 'snap', status: 'pending',
            expires_at: params[5], created_at: new Date(),
          }] });
        }),
    };
    const before = Date.now();
    await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1',
      category: 'photo', text: 'snap',
      gameScale: scale,
    });
    const after = Date.now();
    const diff = new Date(capturedExpiry.expiresAt) - before;
    // Allow 500 ms of execution time drift.
    expect(diff).toBeGreaterThanOrEqual(expectedMs - 500);
    expect(diff).toBeLessThan(expectedMs + (after - before) + 500);
  });

  it('fetches game size from DB when category is photo and gameScale is omitted', async () => {
    const capturedExpiry = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                          // pending check
        .mockResolvedValueOnce({ rows: [{ size: 'large' }] })         // SELECT size FROM games
        .mockImplementationOnce((sql, params) => {
          capturedExpiry.expiresAt = params[5];
          return Promise.resolve({ rows: [{
            id: 'q-auto', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'photo', text: 'snap', status: 'pending',
            expires_at: params[5], created_at: new Date(),
          }] });
        }),
    };
    const before = Date.now();
    await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'photo', text: 'snap',
      // gameScale intentionally omitted
    });
    const diff = new Date(capturedExpiry.expiresAt) - before;
    const largeMs = 20 * 60 * 1000;
    expect(diff).toBeGreaterThanOrEqual(largeMs - 500);
    // Verify the SELECT games query was issued.
    const gamesSql = pool.query.mock.calls[1][0];
    expect(gamesSql).toContain('games');
  });

  it('does not query games table for non-photo categories', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // pending check
        .mockResolvedValueOnce({ rows: [{
          id: 'q-match', game_id: 'g1', asker_id: 'a1', target_id: 't1',
          category: 'matching', text: 'test', status: 'pending',
          expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        }] }),
    };
    await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    });
    // Only two queries: pending check + INSERT.  No extra SELECT on games.
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('accepts matching columns and returns them in the result', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // pending check
        .mockResolvedValueOnce({ rows: [{
          id: 'q-matching', game_id: 'g1', asker_id: 'a1', target_id: 't1',
          category: 'matching', text: 'Same hospital?', status: 'pending',
          expires_at: expiresAt, created_at: new Date(),
          matching_feature_type: 'hospital',
          matching_hider_feature_name: 'Royal Free',
          matching_seeker_feature_name: 'UCH',
          matching_features_match: false,
        }] }),
    };
    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'Same hospital?',
      matchingFeatureType: 'hospital',
      matchingHiderFeatureName: 'Royal Free',
      matchingSeekerFeatureName: 'UCH',
      matchingFeaturesMatch: false,
    });
    expect(result.matchingFeatureType).toBe('hospital');
    expect(result.matchingHiderFeatureName).toBe('Royal Free');
    expect(result.matchingSeekerFeatureName).toBe('UCH');
    expect(result.matchingFeaturesMatch).toBe(false);
    // Verify INSERT SQL includes matching columns.
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('matching_feature_type');
    expect(insertCall[1][22]).toBe('hospital');      // matchingFeatureType ($23)
    expect(insertCall[1][23]).toBe('Royal Free');    // matchingHiderFeatureName ($24)
    expect(insertCall[1][24]).toBe('UCH');           // matchingSeekerFeatureName ($25)
    expect(insertCall[1][25]).toBe(false);           // matchingFeaturesMatch ($26)
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForPlayer — includes expiresAt
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForPlayer', () => {
  it('returns questions with expiresAt field', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-1', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'matching', text: 'hello', status: 'pending',
        expires_at: expiresAt, created_at: new Date(),
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions).toHaveLength(1);
    expect(questions[0].expiresAt).toBeDefined();
    expect(questions[0].questionId).toBe('q-1');
  });

  it('returns empty array when player has no questions', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const questions = await dbGetQuestionsForPlayer(pool, 'nobody');
    expect(questions).toEqual([]);
  });

  it('returns matching columns when present', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-m', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'matching', text: 'Same hospital?', status: 'pending',
        expires_at: expiresAt, created_at: new Date(),
        matching_feature_type: 'hospital',
        matching_hider_feature_name: 'City Hospital',
        matching_seeker_feature_name: 'Royal Hospital',
        matching_features_match: false,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions[0].matchingFeatureType).toBe('hospital');
    expect(questions[0].matchingHiderFeatureName).toBe('City Hospital');
    expect(questions[0].matchingSeekerFeatureName).toBe('Royal Hospital');
    expect(questions[0].matchingFeaturesMatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dbExpireStaleQuestions
// ---------------------------------------------------------------------------

describe('dbExpireStaleQuestions', () => {
  it('updates expired questions and returns their ids', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [
        { id: 'q-exp-1', game_id: 'g1', asker_id: 'a1' },
        { id: 'q-exp-2', game_id: 'g1', asker_id: 'a2' },
      ] }),
    );
    const result = await dbExpireStaleQuestions(pool, 'g1');
    expect(result).toHaveLength(2);
    expect(result[0].questionId).toBe('q-exp-1');
    expect(result[1].questionId).toBe('q-exp-2');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'expired'"),
      ['g1'],
    );
  });

  it('returns empty array when no questions have expired', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const result = await dbExpireStaleQuestions(pool, 'g-no-exp');
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('timeout')));
    await expect(dbExpireStaleQuestions(pool, 'g1')).rejects.toThrow('timeout');
  });
});

// dbSetCurse / dbGetCurseExpiry

describe('dbSetCurse', () => {
  it('issues an UPDATE games SET curse_expires_at query', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    await dbSetCurse(pool, 'game-1', expiresAt);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('curse_expires_at'),
      ['game-1', expiresAt],
    );
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('db error')));
    await expect(dbSetCurse(pool, 'g1', new Date().toISOString())).rejects.toThrow('db error');
  });
});

describe('dbGetCurseExpiry', () => {
  it('returns the ISO string when curse_expires_at is set', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ curse_expires_at: expiresAt }] }),
    );
    const result = await dbGetCurseExpiry(pool, 'game-1');
    expect(result).toBe(expiresAt);
  });

  it('returns null when curse_expires_at is null', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{ curse_expires_at: null }] }),
    );
    const result = await dbGetCurseExpiry(pool, 'game-1');
    expect(result).toBeNull();
  });

  it('returns null when game does not exist', async () => {
    const pool = makeMockPool(() => Promise.resolve({ rows: [] }));
    const result = await dbGetCurseExpiry(pool, 'no-such-game');
    expect(result).toBeNull();
  });

  it('propagates query errors', async () => {
    const pool = makeMockPool(() => Promise.reject(new Error('timeout')));
    await expect(dbGetCurseExpiry(pool, 'g1')).rejects.toThrow('timeout');
  });
});

// ---------------------------------------------------------------------------
// dbCreateQuestion — thermometer columns
// ---------------------------------------------------------------------------

describe('dbCreateQuestion — thermometer columns', () => {
  it('passes thermometer distances as INSERT parameters and returns them', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // pending check: no conflict
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-t', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'thermometer', text: 'warmer?', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: params[6],
            thermometer_previous_distance_m: params[7],
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1',
      category: 'thermometer', text: 'warmer?',
      thermometerCurrentDistanceM: 350,
      thermometerPreviousDistanceM: 800,
    });

    expect(result.thermometerCurrentDistanceM).toBe(350);
    expect(result.thermometerPreviousDistanceM).toBe(800);
    expect(capturedParams.all[6]).toBe(350);
    expect(capturedParams.all[7]).toBe(800);
  });

  it('stores null thermometer distances when not provided', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-m', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'matching', text: 'test', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: null,
            thermometer_previous_distance_m: null,
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    });

    expect(result.thermometerCurrentDistanceM).toBeNull();
    expect(result.thermometerPreviousDistanceM).toBeNull();
    expect(capturedParams.all[6]).toBeNull();
    expect(capturedParams.all[7]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForPlayer — thermometer columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForPlayer — thermometer columns', () => {
  it('returns thermometer distances when present', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-therm', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'thermometer', text: 'warmer?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: 450,
        thermometer_previous_distance_m: 900,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions).toHaveLength(1);
    expect(questions[0].thermometerCurrentDistanceM).toBe(450);
    expect(questions[0].thermometerPreviousDistanceM).toBe(900);
  });

  it('returns null thermometer distances when columns are null', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-match', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'matching', text: 'test', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null,
        thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions[0].thermometerCurrentDistanceM).toBeNull();
    expect(questions[0].thermometerPreviousDistanceM).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbCreateQuestion — tentacle columns
// ---------------------------------------------------------------------------

describe('dbCreateQuestion — tentacle columns', () => {
  it('passes tentacle fields as INSERT parameters and returns them', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // pending check: no conflict
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-tent', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'tentacle', text: 'Within range?', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: null,
            thermometer_previous_distance_m: null,
            tentacle_target_lat:    params[8],
            tentacle_target_lon:    params[9],
            tentacle_radius_km:     params[10],
            tentacle_distance_km:   params[11],
            tentacle_within_radius: params[12],
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1',
      category: 'tentacle', text: 'Within range?',
      tentacleTargetLat:    51.5074,
      tentacleTargetLon:    -0.1278,
      tentacleRadiusKm:     2,
      tentacleDistanceKm:   0.8,
      tentacleWithinRadius: true,
    });

    expect(result.tentacleTargetLat).toBe(51.5074);
    expect(result.tentacleTargetLon).toBe(-0.1278);
    expect(result.tentacleRadiusKm).toBe(2);
    expect(result.tentacleDistanceKm).toBe(0.8);
    expect(result.tentacleWithinRadius).toBe(true);
    expect(capturedParams.all[8]).toBe(51.5074);
    expect(capturedParams.all[9]).toBe(-0.1278);
    expect(capturedParams.all[10]).toBe(2);
    expect(capturedParams.all[11]).toBe(0.8);
    expect(capturedParams.all[12]).toBe(true);
  });

  it('stores null tentacle fields when not provided', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-m2', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'matching', text: 'test', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
            tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
            tentacle_distance_km: null, tentacle_within_radius: null,
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    });

    expect(result.tentacleTargetLat).toBeNull();
    expect(result.tentacleTargetLon).toBeNull();
    expect(result.tentacleRadiusKm).toBeNull();
    expect(result.tentacleDistanceKm).toBeNull();
    expect(result.tentacleWithinRadius).toBeNull();
    expect(capturedParams.all[8]).toBeNull();
    expect(capturedParams.all[12]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForPlayer — tentacle columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForPlayer — tentacle columns', () => {
  it('returns tentacle fields when present', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-tent', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'tentacle', text: 'Within range?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: 51.5074, tentacle_target_lon: -0.1278,
        tentacle_radius_km: 2, tentacle_distance_km: 0.8, tentacle_within_radius: true,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions).toHaveLength(1);
    expect(questions[0].tentacleTargetLat).toBe(51.5074);
    expect(questions[0].tentacleTargetLon).toBe(-0.1278);
    expect(questions[0].tentacleRadiusKm).toBe(2);
    expect(questions[0].tentacleDistanceKm).toBe(0.8);
    expect(questions[0].tentacleWithinRadius).toBe(true);
  });

  it('returns null tentacle fields when columns are null', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-match', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'matching', text: 'test', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions[0].tentacleTargetLat).toBeNull();
    expect(questions[0].tentacleDistanceKm).toBeNull();
    expect(questions[0].tentacleWithinRadius).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForGame — tentacle columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForGame — tentacle columns', () => {
  it('returns tentacle fields in game Q&A history', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-tent-g', game_id: 'g1', asker_id: 'a1', target_id: 't1',
        category: 'tentacle', text: 'Within range?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: 51.5, tentacle_target_lon: -0.1,
        tentacle_radius_km: 3, tentacle_distance_km: 1.5, tentacle_within_radius: false,
        answer_text: null, answer_created_at: null,
      }] }),
    );
    const questions = await dbGetQuestionsForGame(pool, 'g1');
    expect(questions).toHaveLength(1);
    expect(questions[0].tentacleTargetLat).toBe(51.5);
    expect(questions[0].tentacleDistanceKm).toBe(1.5);
    expect(questions[0].tentacleWithinRadius).toBe(false);
    expect(questions[0].answer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbCreateQuestion — measuring columns
// ---------------------------------------------------------------------------

describe('dbCreateQuestion — measuring columns', () => {
  it('passes measuring fields as INSERT parameters and returns them', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // pending check: no conflict
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-meas', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'measuring', text: 'Am I closer?', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: null,
            thermometer_previous_distance_m: null,
            tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
            tentacle_distance_km: null, tentacle_within_radius: null,
            measuring_target_lat:       params[13],
            measuring_target_lon:       params[14],
            measuring_hider_distance_km:  params[15],
            measuring_seeker_distance_km: params[16],
            measuring_hider_is_closer:    params[17],
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1',
      category: 'measuring', text: 'Am I closer?',
      measuringTargetLat:       48.8584,
      measuringTargetLon:       2.2945,
      measuringHiderDistanceKm:  340.5,
      measuringSeekerDistanceKm: 490.2,
      measuringHiderIsCloser:    true,
    });

    expect(result.measuringTargetLat).toBe(48.8584);
    expect(result.measuringTargetLon).toBe(2.2945);
    expect(result.measuringHiderDistanceKm).toBe(340.5);
    expect(result.measuringSeekerDistanceKm).toBe(490.2);
    expect(result.measuringHiderIsCloser).toBe(true);
    expect(capturedParams.all[13]).toBe(48.8584);
    expect(capturedParams.all[14]).toBe(2.2945);
    expect(capturedParams.all[15]).toBe(340.5);
    expect(capturedParams.all[16]).toBe(490.2);
    expect(capturedParams.all[17]).toBe(true);
  });

  it('stores null measuring fields when not provided', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-m2', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'matching', text: 'test', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
            tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
            tentacle_distance_km: null, tentacle_within_radius: null,
            measuring_target_lat: null, measuring_target_lon: null,
            measuring_hider_distance_km: null, measuring_seeker_distance_km: null,
            measuring_hider_is_closer: null,
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1', category: 'matching', text: 'test',
    });

    expect(result.measuringTargetLat).toBeNull();
    expect(result.measuringTargetLon).toBeNull();
    expect(result.measuringHiderDistanceKm).toBeNull();
    expect(result.measuringSeekerDistanceKm).toBeNull();
    expect(result.measuringHiderIsCloser).toBeNull();
    expect(capturedParams.all[13]).toBeNull();
    expect(capturedParams.all[17]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForPlayer — measuring columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForPlayer — measuring columns', () => {
  it('returns measuring fields when present', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-meas', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'measuring', text: 'Am I closer?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
        measuring_target_lat: 48.8584, measuring_target_lon: 2.2945,
        measuring_hider_distance_km: 340.5, measuring_seeker_distance_km: 490.2,
        measuring_hider_is_closer: true,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions).toHaveLength(1);
    expect(questions[0].measuringTargetLat).toBe(48.8584);
    expect(questions[0].measuringTargetLon).toBe(2.2945);
    expect(questions[0].measuringHiderDistanceKm).toBe(340.5);
    expect(questions[0].measuringSeekerDistanceKm).toBe(490.2);
    expect(questions[0].measuringHiderIsCloser).toBe(true);
  });

  it('returns null measuring fields when columns are null', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-m2', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'matching', text: 'test', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
        measuring_target_lat: null, measuring_target_lon: null,
        measuring_hider_distance_km: null, measuring_seeker_distance_km: null,
        measuring_hider_is_closer: null,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions[0].measuringTargetLat).toBeNull();
    expect(questions[0].measuringHiderDistanceKm).toBeNull();
    expect(questions[0].measuringHiderIsCloser).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForGame — measuring columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForGame — measuring columns', () => {
  it('returns measuring fields in game Q&A history', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-meas-g', game_id: 'g1', asker_id: 'a1', target_id: 't1',
        category: 'measuring', text: 'Am I closer?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
        measuring_target_lat: 48.8584, measuring_target_lon: 2.2945,
        measuring_hider_distance_km: 340.5, measuring_seeker_distance_km: 490.2,
        measuring_hider_is_closer: false,
        transit_nearest_station_name: null, transit_nearest_station_lat: null,
        transit_nearest_station_lon: null, transit_nearest_station_distance_km: null,
        answer_text: null, answer_created_at: null,
      }] }),
    );
    const questions = await dbGetQuestionsForGame(pool, 'g1');
    expect(questions).toHaveLength(1);
    expect(questions[0].measuringTargetLat).toBe(48.8584);
    expect(questions[0].measuringHiderDistanceKm).toBe(340.5);
    expect(questions[0].measuringHiderIsCloser).toBe(false);
    expect(questions[0].answer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbCreateQuestion — transit columns
// ---------------------------------------------------------------------------

describe('dbCreateQuestion — transit columns', () => {
  it('passes transit fields as INSERT parameters and returns them', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedParams = {};
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // pending check: no conflict
        .mockImplementationOnce((sql, params) => {
          capturedParams.all = params;
          return Promise.resolve({ rows: [{
            id: 'q-trans', game_id: 'g1', asker_id: 'a1', target_id: 't1',
            category: 'transit', text: 'On your route?', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
            tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
            tentacle_distance_km: null, tentacle_within_radius: null,
            measuring_target_lat: null, measuring_target_lon: null,
            measuring_hider_distance_km: null, measuring_seeker_distance_km: null,
            measuring_hider_is_closer: null,
            transit_nearest_station_name:        params[18],
            transit_nearest_station_lat:         params[19],
            transit_nearest_station_lon:         params[20],
            transit_nearest_station_distance_km: params[21],
          }] });
        }),
    };

    const result = await dbCreateQuestion(pool, {
      gameId: 'g1', askerId: 'a1', targetId: 't1',
      category: 'transit', text: 'On your route?',
      transitNearestStationName:       'London Bridge',
      transitNearestStationLat:        51.508,
      transitNearestStationLon:        -0.086,
      transitNearestStationDistanceKm: 0.42,
    });

    expect(result.transitNearestStationName).toBe('London Bridge');
    expect(result.transitNearestStationLat).toBeCloseTo(51.508);
    expect(result.transitNearestStationLon).toBeCloseTo(-0.086);
    expect(result.transitNearestStationDistanceKm).toBeCloseTo(0.42);
    expect(capturedParams.all[18]).toBe('London Bridge');
    expect(capturedParams.all[19]).toBeCloseTo(51.508);
    expect(capturedParams.all[20]).toBeCloseTo(-0.086);
    expect(capturedParams.all[21]).toBeCloseTo(0.42);
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForPlayer — transit columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForPlayer — transit columns', () => {
  it('returns transit fields when present', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-trans', game_id: 'g1', asker_id: 'a1', target_id: 'p1',
        category: 'transit', text: 'On your route?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
        measuring_target_lat: null, measuring_target_lon: null,
        measuring_hider_distance_km: null, measuring_seeker_distance_km: null,
        measuring_hider_is_closer: null,
        transit_nearest_station_name: 'Paddington',
        transit_nearest_station_lat: 51.516,
        transit_nearest_station_lon: -0.177,
        transit_nearest_station_distance_km: 0.25,
      }] }),
    );
    const questions = await dbGetQuestionsForPlayer(pool, 'p1');
    expect(questions).toHaveLength(1);
    expect(questions[0].transitNearestStationName).toBe('Paddington');
    expect(questions[0].transitNearestStationLat).toBeCloseTo(51.516);
    expect(questions[0].transitNearestStationDistanceKm).toBeCloseTo(0.25);
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForGame — transit columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForGame — transit columns', () => {
  it('returns transit fields in game Q&A history', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-trans-g', game_id: 'g1', asker_id: 'a1', target_id: 't1',
        category: 'transit', text: 'On your route?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
        measuring_target_lat: null, measuring_target_lon: null,
        measuring_hider_distance_km: null, measuring_seeker_distance_km: null,
        measuring_hider_is_closer: null,
        transit_nearest_station_name: 'Victoria',
        transit_nearest_station_lat: 51.495,
        transit_nearest_station_lon: -0.144,
        transit_nearest_station_distance_km: 0.61,
        answer_text: null, answer_created_at: null,
      }] }),
    );
    const questions = await dbGetQuestionsForGame(pool, 'g1');
    expect(questions).toHaveLength(1);
    expect(questions[0].transitNearestStationName).toBe('Victoria');
    expect(questions[0].transitNearestStationDistanceKm).toBeCloseTo(0.61);
    expect(questions[0].answer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dbGetQuestionsForGame — matching columns
// ---------------------------------------------------------------------------

describe('dbGetQuestionsForGame — matching columns', () => {
  it('returns matching fields in game Q&A history', async () => {
    const pool = makeMockPool(() =>
      Promise.resolve({ rows: [{
        id: 'q-match-g', game_id: 'g1', asker_id: 'a1', target_id: 't1',
        category: 'matching', text: 'Same hospital?', status: 'pending',
        expires_at: new Date(Date.now() + 300_000), created_at: new Date(),
        thermometer_current_distance_m: null, thermometer_previous_distance_m: null,
        tentacle_target_lat: null, tentacle_target_lon: null, tentacle_radius_km: null,
        tentacle_distance_km: null, tentacle_within_radius: null,
        measuring_target_lat: null, measuring_target_lon: null,
        measuring_hider_distance_km: null, measuring_seeker_distance_km: null,
        measuring_hider_is_closer: null,
        transit_nearest_station_name: null, transit_nearest_station_lat: null,
        transit_nearest_station_lon: null, transit_nearest_station_distance_km: null,
        matching_feature_type: 'hospital',
        matching_hider_feature_name: 'Bart\'s',
        matching_seeker_feature_name: 'Bart\'s',
        matching_features_match: true,
        answer_text: null, answer_created_at: null,
      }] }),
    );
    const questions = await dbGetQuestionsForGame(pool, 'g1');
    expect(questions).toHaveLength(1);
    expect(questions[0].matchingFeatureType).toBe('hospital');
    expect(questions[0].matchingHiderFeatureName).toBe('Bart\'s');
    expect(questions[0].matchingSeekerFeatureName).toBe('Bart\'s');
    expect(questions[0].matchingFeaturesMatch).toBe(true);
    expect(questions[0].answer).toBeNull();
  });
});
