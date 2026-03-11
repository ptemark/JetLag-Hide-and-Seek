import { describe, it, expect, beforeEach } from 'vitest';
import { submitScore, getLeaderboard, _clearStore } from './scores.js';

beforeEach(() => {
  _clearStore();
});

// ---------------------------------------------------------------------------
// getLeaderboard — in-process store
// ---------------------------------------------------------------------------

describe('getLeaderboard (in-process)', () => {
  it('returns 200 with empty scores array when store is empty', () => {
    const req = { method: 'GET', query: {} };
    const result = getLeaderboard(req);
    expect(result.status).toBe(200);
    expect(result.body.scores).toEqual([]);
  });

  it('returns 405 for non-GET method', () => {
    const req = { method: 'POST', query: {} };
    const result = getLeaderboard(req);
    expect(result.status).toBe(405);
  });

  it('returns scores ranked by hidingTimeMs descending', () => {
    submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 60_000, captured: false } });
    submitScore({ method: 'POST', body: { playerId: 'p2', gameId: 'g1', hidingTimeMs: 120_000, captured: true } });
    submitScore({ method: 'POST', body: { playerId: 'p3', gameId: 'g1', hidingTimeMs: 90_000, captured: false } });

    const req = { method: 'GET', query: {} };
    const result = getLeaderboard(req);
    const scores = result.body.scores;

    expect(scores).toHaveLength(3);
    expect(scores[0].rank).toBe(1);
    expect(scores[0].scoreSeconds).toBe(120);
    expect(scores[1].scoreSeconds).toBe(90);
    expect(scores[2].scoreSeconds).toBe(60);
  });

  it('filters by gameId when provided', () => {
    submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 60_000, captured: false } });
    submitScore({ method: 'POST', body: { playerId: 'p2', gameId: 'g2', hidingTimeMs: 120_000, captured: false } });

    const req = { method: 'GET', query: { gameId: 'g1' } };
    const result = getLeaderboard(req);
    expect(result.body.scores).toHaveLength(1);
    expect(result.body.scores[0].scoreSeconds).toBe(60);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      submitScore({ method: 'POST', body: { playerId: `p${i}`, gameId: 'g1', hidingTimeMs: i * 10_000, captured: false } });
    }
    const req = { method: 'GET', query: { limit: '3' } };
    const result = getLeaderboard(req);
    expect(result.body.scores).toHaveLength(3);
  });

  it('caps limit at 100', () => {
    const req = { method: 'GET', query: { limit: '999' } };
    // Just verifying it doesn't reject — returns the available scores (0 here)
    const result = getLeaderboard(req);
    expect(result.status).toBe(200);
  });

  it('defaults limit to 20 when not provided', () => {
    for (let i = 0; i < 25; i++) {
      submitScore({ method: 'POST', body: { playerId: `p${i}`, gameId: 'g1', hidingTimeMs: i * 1000, captured: false } });
    }
    const req = { method: 'GET', query: {} };
    const result = getLeaderboard(req);
    expect(result.body.scores).toHaveLength(20);
  });

  it('defaults limit to 20 for invalid limit value', () => {
    for (let i = 0; i < 25; i++) {
      submitScore({ method: 'POST', body: { playerId: `p${i}`, gameId: 'g1', hidingTimeMs: i * 1000, captured: false } });
    }
    const req = { method: 'GET', query: { limit: 'abc' } };
    const result = getLeaderboard(req);
    expect(result.body.scores).toHaveLength(20);
  });

  it('includes rank, playerName, scale, scoreSeconds, bonusSeconds, createdAt fields', () => {
    submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 30_000, captured: false, bonusSeconds: 10 } });
    const req = { method: 'GET', query: {} };
    const result = getLeaderboard(req);
    const s = result.body.scores[0];
    expect(s).toHaveProperty('rank');
    expect(s).toHaveProperty('playerName');
    expect(s).toHaveProperty('scale');
    expect(s).toHaveProperty('scoreSeconds');
    expect(s).toHaveProperty('bonusSeconds', 10);
    expect(s).toHaveProperty('createdAt');
  });
});

// ---------------------------------------------------------------------------
// getLeaderboard — DB pool path
// ---------------------------------------------------------------------------

describe('getLeaderboard (DB pool)', () => {
  it('delegates to dbGetLeaderboard and returns 200', async () => {
    const rows = [
      { rank: 1, playerName: 'Alice', scale: 'medium', scoreSeconds: 300, bonusSeconds: 0, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const pool = {
      query: async () => ({
        rows: [{ player_name: 'Alice', size: 'medium', score_seconds: 300, bonus_seconds: 0, created_at: '2026-01-01T00:00:00Z' }],
      }),
    };
    const req = { method: 'GET', query: { limit: '5' } };
    const result = await getLeaderboard(req, pool);
    expect(result.status).toBe(200);
    expect(result.body.scores).toHaveLength(1);
    expect(result.body.scores[0].playerName).toBe('Alice');
    expect(result.body.scores[0].scale).toBe('medium');
    expect(result.body.scores[0].scoreSeconds).toBe(300);
    expect(result.body.scores[0].rank).toBe(1);
  });

  it('returns empty scores array when DB returns no rows', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    const req = { method: 'GET', query: {} };
    const result = await getLeaderboard(req, pool);
    expect(result.status).toBe(200);
    expect(result.body.scores).toEqual([]);
  });
});
