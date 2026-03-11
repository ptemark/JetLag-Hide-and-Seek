// @vitest-environment node
/**
 * lifecycle.test.js — End-to-end DB interaction tests for JetLag.
 *
 * These tests exercise the full sequence of database interactions that occur
 * during real gameplay workflows, using mock pools.  Unlike the unit tests in
 * gameStore.test.js (which test each function in isolation), these tests
 * verify that chained reads and writes produce consistent results and that
 * the SQL emitted at each step is correct.
 *
 * Task 11: automated tests for database interactions, verifying correct read/write.
 */

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
// Helpers
// ---------------------------------------------------------------------------

/** Build a pool whose query() responds from the given response queue in order. */
function makeQueuedPool(...responses) {
  const queue = [...responses];
  const query = vi.fn(() => {
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  return { query };
}

const NOW = '2026-03-05T10:00:00Z';

// ---------------------------------------------------------------------------
// Player lifecycle
// ---------------------------------------------------------------------------

describe('Player lifecycle — create then read', () => {
  it('create → get returns the same player fields', async () => {
    const playerId = 'player-lifecycle-1';
    const name = 'Anya';

    // Pool: first call = INSERT, second call = SELECT
    const pool = makeQueuedPool(
      { rows: [{ id: playerId, name, created_at: NOW }] },
      { rows: [{ id: playerId, name, created_at: NOW }] },
    );

    const created = await dbCreatePlayer(pool, { name });
    expect(created.playerId).toBe(playerId);
    expect(created.name).toBe(name);
    expect(created.createdAt).toBe(NOW);

    const fetched = await dbGetPlayer(pool, playerId);
    expect(fetched).toEqual(created);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('get returns null for an id that was never inserted', async () => {
    const pool = makeQueuedPool({ rows: [] });
    const player = await dbGetPlayer(pool, 'nonexistent-uuid');
    expect(player).toBeNull();
  });

  it('INSERT query uses parameterised name (no SQL injection risk)', async () => {
    const maliciousName = "'; DROP TABLE players; --";
    const pool = makeQueuedPool({
      rows: [{ id: 'p-safe', name: maliciousName, created_at: NOW }],
    });
    await dbCreatePlayer(pool, { name: maliciousName });
    const [sql, params] = pool.query.mock.calls[0];
    // The name must appear only in params, never interpolated into SQL.
    expect(sql).not.toContain(maliciousName);
    expect(params[0]).toBe(maliciousName);
  });
});

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

describe('Game lifecycle — create, join players, update status', () => {
  const gameId = 'game-lifecycle-1';
  const p1Id = 'player-1';
  const p2Id = 'player-2';

  it('new game has status "waiting" and empty players list', async () => {
    const pool = makeQueuedPool(
      // dbCreateGame INSERT
      { rows: [{ id: gameId, size: 'medium', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: NOW }] },
      // dbGetGame SELECT games
      { rows: [{ id: gameId, size: 'medium', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: NOW }] },
      // dbGetGame SELECT game_players
      { rows: [] },
    );

    const created = await dbCreateGame(pool, { size: 'medium' });
    expect(created.status).toBe('waiting');
    expect(created.gameId).toBe(gameId);

    const fetched = await dbGetGame(pool, gameId);
    expect(fetched.status).toBe('waiting');
    expect(fetched.players).toEqual([]);
  });

  it('after joining, game contains both players with correct roles', async () => {
    const pool = makeQueuedPool(
      // dbJoinGame for p1 (hider — no seeker_teams lookup, just INSERT)
      { rows: [{ game_id: gameId, player_id: p1Id, role: 'hider', team: null, joined_at: NOW }] },
      // dbJoinGame for p2 (seeker — 2 queries: seeker_teams lookup + INSERT; count skipped when teams=0)
      { rows: [{ seeker_teams: 0 }] },            // seeker_teams lookup → 0 means no auto-assign
      { rows: [{ game_id: gameId, player_id: p2Id, role: 'seeker', team: null, joined_at: NOW }] },
      // dbGetGame SELECT games
      { rows: [{ id: gameId, size: 'medium', bounds: {}, status: 'hiding', seeker_teams: 0, created_at: NOW }] },
      // dbGetGame SELECT game_players (both players present)
      {
        rows: [
          { id: p1Id, name: 'Hider',  role: 'hider',  team: null, joined_at: NOW },
          { id: p2Id, name: 'Seeker', role: 'seeker', team: null, joined_at: NOW },
        ],
      },
    );

    await dbJoinGame(pool, { gameId, playerId: p1Id, role: 'hider' });
    await dbJoinGame(pool, { gameId, playerId: p2Id, role: 'seeker' });

    const game = await dbGetGame(pool, gameId);
    expect(game.players).toHaveLength(2);
    const hider = game.players.find(p => p.role === 'hider');
    const seeker = game.players.find(p => p.role === 'seeker');
    expect(hider.playerId).toBe(p1Id);
    expect(seeker.playerId).toBe(p2Id);
  });

  it('status transition: waiting → hiding → seeking → finished', async () => {
    const transitions = ['hiding', 'seeking', 'finished'];
    const pool = makeQueuedPool(
      ...transitions.map(status => ({ rows: [{ id: gameId, status }] })),
    );

    for (const status of transitions) {
      const result = await dbUpdateGameStatus(pool, { gameId, status });
      expect(result.status).toBe(status);
      expect(result.gameId).toBe(gameId);
    }
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('status update emits UPDATE games SQL with correct parameters', async () => {
    const pool = makeQueuedPool({ rows: [{ id: gameId, status: 'finished' }] });
    await dbUpdateGameStatus(pool, { gameId, status: 'finished' });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE games/i);
    expect(sql).toMatch(/SET status/i);
    expect(params).toEqual(['finished', gameId]);
  });

  it('update returns null when game does not exist', async () => {
    const pool = makeQueuedPool({ rows: [] });
    const result = await dbUpdateGameStatus(pool, { gameId: 'missing', status: 'hiding' });
    expect(result).toBeNull();
  });

  it('bounds are serialised as JSON in INSERT query', async () => {
    const bounds = { lat_min: 51.5, lat_max: 51.6, lon_min: -0.2, lon_max: -0.1 };
    const pool = makeQueuedPool({
      rows: [{ id: 'g-bounds', size: 'large', bounds, status: 'waiting', created_at: NOW }],
    });
    await dbCreateGame(pool, { size: 'large', bounds });

    const [, params] = pool.query.mock.calls[0];
    expect(params[1]).toBe(JSON.stringify(bounds));
  });
});

// ---------------------------------------------------------------------------
// Score lifecycle
// ---------------------------------------------------------------------------

describe('Score lifecycle — submit and retrieve', () => {
  const gameId = 'game-score-1';
  const p1Id = 'player-score-1';
  const p2Id = 'player-score-2';

  it('submitted score is retrievable from get-scores result', async () => {
    const pool = makeQueuedPool(
      // dbSubmitScore upsert
      {
        rows: [{
          id: 'score-1', game_id: gameId, player_id: p1Id,
          score_seconds: 3600, bonus_seconds: 0, captured_at: null, created_at: NOW,
        }],
      },
      // dbGetGameScores SELECT
      {
        rows: [{
          id: 'score-1', game_id: gameId, player_id: p1Id,
          score_seconds: 3600, bonus_seconds: 0, captured_at: null, created_at: NOW,
        }],
      },
    );

    const submitted = await dbSubmitScore(pool, { gameId, playerId: p1Id, scoreSeconds: 3600 });
    expect(submitted.scoreId).toBe('score-1');
    expect(submitted.scoreSeconds).toBe(3600);
    expect(submitted.capturedAt).toBeNull();

    const scores = await dbGetGameScores(pool, gameId);
    expect(scores).toHaveLength(1);
    expect(scores[0].scoreId).toBe('score-1');
    expect(scores[0].scoreSeconds).toBe(3600);
  });

  it('scores are ordered highest to lowest by score_seconds', async () => {
    const pool = makeQueuedPool({
      rows: [
        { id: 's3', game_id: gameId, player_id: 'p3', score_seconds: 7200, bonus_seconds: 0, captured_at: null, created_at: NOW },
        { id: 's1', game_id: gameId, player_id: p1Id, score_seconds: 3600, bonus_seconds: 0, captured_at: null, created_at: NOW },
        { id: 's2', game_id: gameId, player_id: p2Id, score_seconds: 1800, bonus_seconds: 0, captured_at: '2026-03-05T11:00:00Z', created_at: NOW },
      ],
    });

    const scores = await dbGetGameScores(pool, gameId);
    expect(scores[0].scoreSeconds).toBe(7200);
    expect(scores[1].scoreSeconds).toBe(3600);
    expect(scores[2].scoreSeconds).toBe(1800);
    expect(scores[2].capturedAt).toBe('2026-03-05T11:00:00Z');
  });

  it('upsert: second submit for same player overwrites score', async () => {
    const pool = makeQueuedPool(
      // first submit
      {
        rows: [{
          id: 'score-x', game_id: gameId, player_id: p1Id,
          score_seconds: 3600, bonus_seconds: 0, captured_at: null, created_at: NOW,
        }],
      },
      // second submit (upsert updates to 5400)
      {
        rows: [{
          id: 'score-x', game_id: gameId, player_id: p1Id,
          score_seconds: 5400, bonus_seconds: 0, captured_at: null, created_at: NOW,
        }],
      },
    );

    await dbSubmitScore(pool, { gameId, playerId: p1Id, scoreSeconds: 3600 });
    const updated = await dbSubmitScore(pool, { gameId, playerId: p1Id, scoreSeconds: 5400 });
    expect(updated.scoreSeconds).toBe(5400);
    // Both calls emit INSERT ... ON CONFLICT
    for (const [sql] of pool.query.mock.calls) {
      expect(sql).toMatch(/ON CONFLICT/i);
    }
  });

  it('capturedAt is null when player was not caught', async () => {
    const pool = makeQueuedPool({
      rows: [{ id: 's', game_id: gameId, player_id: p1Id, score_seconds: 9000, bonus_seconds: 0, captured_at: null, created_at: NOW }],
    });
    await dbSubmitScore(pool, { gameId, playerId: p1Id, scoreSeconds: 9000 });
    const [, params] = pool.query.mock.calls[0];
    expect(params[4]).toBeNull(); // capturedAt is at index 4 (after bonusSeconds)
  });

  it('capturedAt is a timestamp when player was caught', async () => {
    const capturedAt = '2026-03-05T11:30:00Z';
    const pool = makeQueuedPool({
      rows: [{ id: 's', game_id: gameId, player_id: p2Id, score_seconds: 600, bonus_seconds: 0, captured_at: capturedAt, created_at: NOW }],
    });
    await dbSubmitScore(pool, { gameId, playerId: p2Id, scoreSeconds: 600, capturedAt });
    const [, params] = pool.query.mock.calls[0];
    expect(params[4]).toBe(capturedAt); // capturedAt is at index 4 (after bonusSeconds)
  });

  it('empty game returns no scores', async () => {
    const pool = makeQueuedPool({ rows: [] });
    const scores = await dbGetGameScores(pool, 'empty-game');
    expect(scores).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full game workflow — all phases in sequence
// ---------------------------------------------------------------------------

describe('Full game workflow — player registration through score submission', () => {
  it('completes a full hide-and-seek round with consistent data', async () => {
    const gameId = 'full-game-1';
    const hiderId = 'full-hider-1';
    const seekerId = 'full-seeker-1';
    const capturedAt = '2026-03-05T12:00:00Z';

    const pool = makeQueuedPool(
      // 1. Create hider player
      { rows: [{ id: hiderId, name: 'Hider', created_at: NOW }] },
      // 2. Create seeker player
      { rows: [{ id: seekerId, name: 'Seeker', created_at: NOW }] },
      // 3. Create game
      { rows: [{ id: gameId, size: 'small', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: NOW }] },
      // 4. Hider joins (1 query: INSERT)
      { rows: [{ game_id: gameId, player_id: hiderId, role: 'hider', team: null, joined_at: NOW }] },
      // 5. Seeker joins (2 queries: seeker_teams SELECT + INSERT)
      { rows: [{ seeker_teams: 0 }] },
      { rows: [{ game_id: gameId, player_id: seekerId, role: 'seeker', team: null, joined_at: NOW }] },
      // 6. Status → hiding
      { rows: [{ id: gameId, status: 'hiding' }] },
      // 7. Status → seeking
      { rows: [{ id: gameId, status: 'seeking' }] },
      // 8. Hider score (not captured)
      { rows: [{ id: 'hs', game_id: gameId, player_id: hiderId, score_seconds: 7200, bonus_seconds: 0, captured_at: null, created_at: NOW }] },
      // 9. Seeker score (captured at some point)
      { rows: [{ id: 'ss', game_id: gameId, player_id: seekerId, score_seconds: 3600, bonus_seconds: 0, captured_at: capturedAt, created_at: NOW }] },
      // 10. Status → finished
      { rows: [{ id: gameId, status: 'finished' }] },
      // 11. Get final scores
      {
        rows: [
          { id: 'hs', game_id: gameId, player_id: hiderId, score_seconds: 7200, bonus_seconds: 0, captured_at: null, created_at: NOW },
          { id: 'ss', game_id: gameId, player_id: seekerId, score_seconds: 3600, bonus_seconds: 0, captured_at: capturedAt, created_at: NOW },
        ],
      },
    );

    // 1–2. Register players
    const hider = await dbCreatePlayer(pool, { name: 'Hider' });
    const seeker = await dbCreatePlayer(pool, { name: 'Seeker' });
    expect(hider.playerId).toBe(hiderId);
    expect(seeker.playerId).toBe(seekerId);

    // 3. Create game
    const game = await dbCreateGame(pool, { size: 'small' });
    expect(game.status).toBe('waiting');

    // 4–5. Join players
    const hiderJoin = await dbJoinGame(pool, { gameId, playerId: hiderId, role: 'hider' });
    const seekerJoin = await dbJoinGame(pool, { gameId, playerId: seekerId, role: 'seeker' });
    expect(hiderJoin.role).toBe('hider');
    expect(seekerJoin.role).toBe('seeker');

    // 6–7. Status transitions
    const hiding = await dbUpdateGameStatus(pool, { gameId, status: 'hiding' });
    expect(hiding.status).toBe('hiding');
    const seeking = await dbUpdateGameStatus(pool, { gameId, status: 'seeking' });
    expect(seeking.status).toBe('seeking');

    // 8–9. Submit scores
    const hiderScore = await dbSubmitScore(pool, { gameId, playerId: hiderId, scoreSeconds: 7200 });
    expect(hiderScore.capturedAt).toBeNull();
    const seekerScore = await dbSubmitScore(pool, { gameId, playerId: seekerId, scoreSeconds: 3600, capturedAt });
    expect(seekerScore.capturedAt).toBe(capturedAt);

    // 10. Finish game
    const finished = await dbUpdateGameStatus(pool, { gameId, status: 'finished' });
    expect(finished.status).toBe('finished');

    // 11. Final leaderboard
    const scores = await dbGetGameScores(pool, gameId);
    expect(scores).toHaveLength(2);
    expect(scores[0].scoreSeconds).toBeGreaterThan(scores[1].scoreSeconds);
    expect(scores[0].playerId).toBe(hiderId);

    // Ensure every interaction touched the DB (seeker join adds 1 extra for seeker_teams lookup)
    expect(pool.query).toHaveBeenCalledTimes(12);
  });
});

// ---------------------------------------------------------------------------
// Error propagation across chained operations
// ---------------------------------------------------------------------------

describe('Error propagation in interaction chains', () => {
  it('join fails when game does not exist (FK error)', async () => {
    const pool = makeQueuedPool(new Error('foreign key violation'));
    await expect(
      dbJoinGame(pool, { gameId: 'no-such-game', playerId: 'p1', role: 'hider' }),
    ).rejects.toThrow('foreign key violation');
  });

  it('score submit fails when player is not in the game (FK error)', async () => {
    const pool = makeQueuedPool(new Error('foreign key violation'));
    await expect(
      dbSubmitScore(pool, { gameId: 'g1', playerId: 'unknown-player', scoreSeconds: 100 }),
    ).rejects.toThrow('foreign key violation');
  });

  it('get-scores propagates DB connection errors', async () => {
    const pool = makeQueuedPool(new Error('connection refused'));
    await expect(dbGetGameScores(pool, 'any-game')).rejects.toThrow('connection refused');
  });

  it('create-player propagates duplicate-name errors if DB has unique constraint', async () => {
    const pool = makeQueuedPool(new Error('unique constraint violation'));
    await expect(dbCreatePlayer(pool, { name: 'Alice' })).rejects.toThrow('unique constraint violation');
  });
});

// ---------------------------------------------------------------------------
// SQL structure verification
// ---------------------------------------------------------------------------

describe('SQL structure — correct tables and parameterisation', () => {
  it('dbCreatePlayer targets the players table', async () => {
    const pool = makeQueuedPool({ rows: [{ id: 'p', name: 'X', created_at: NOW }] });
    await dbCreatePlayer(pool, { name: 'X' });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INTO players/i);
    expect(sql).toMatch(/RETURNING/i);
  });

  it('dbGetPlayer targets the players table with a WHERE clause', async () => {
    const pool = makeQueuedPool({ rows: [] });
    await dbGetPlayer(pool, 'some-id');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM players/i);
    expect(sql).toMatch(/WHERE id = \$1/i);
    expect(params[0]).toBe('some-id');
  });

  it('dbCreateGame targets the games table', async () => {
    const pool = makeQueuedPool({ rows: [{ id: 'g', size: 'small', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: NOW }] });
    await dbCreateGame(pool, { size: 'small' });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INTO games/i);
  });

  it('dbGetGame queries games then game_players with a JOIN', async () => {
    const pool = makeQueuedPool(
      { rows: [{ id: 'g', size: 'small', bounds: {}, status: 'waiting', seeker_teams: 0, created_at: NOW }] },
      { rows: [] },
    );
    await dbGetGame(pool, 'g');
    const [[sql1], [sql2]] = pool.query.mock.calls;
    expect(sql1).toMatch(/FROM games/i);
    expect(sql2).toMatch(/JOIN players/i);
  });

  it('dbJoinGame targets the game_players table', async () => {
    // Use hider role to avoid seeker_teams lookup (only one query issued).
    const pool = makeQueuedPool({ rows: [{ game_id: 'g', player_id: 'p', role: 'hider', team: null, joined_at: NOW }] });
    await dbJoinGame(pool, { gameId: 'g', playerId: 'p', role: 'hider' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INTO game_players/i);
    expect(params).toEqual(['g', 'p', 'hider', null]);
  });

  it('dbSubmitScore uses ON CONFLICT upsert targeting the scores table', async () => {
    const pool = makeQueuedPool({ rows: [{ id: 's', game_id: 'g', player_id: 'p', score_seconds: 60, captured_at: null, created_at: NOW }] });
    await dbSubmitScore(pool, { gameId: 'g', playerId: 'p', scoreSeconds: 60 });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INTO scores/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(sql).toMatch(/DO UPDATE/i);
  });

  it('dbGetGameScores filters by game_id and orders by score_seconds DESC', async () => {
    const pool = makeQueuedPool({ rows: [] });
    await dbGetGameScores(pool, 'target-game');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE game_id = \$1/i);
    expect(sql).toMatch(/ORDER BY score_seconds DESC/i);
    expect(params[0]).toBe('target-game');
  });
});
