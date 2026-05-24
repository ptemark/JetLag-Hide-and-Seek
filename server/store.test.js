// @vitest-environment node
//
// Tests for server/store.js — the createStore() wrapper that adapts the
// pool-first db/gameStore.js helpers into the single-argument shape the
// managed server expects on `createServer({ store })`.

import { describe, it, expect, vi } from 'vitest';
import { createStore } from './store.js';

describe('createStore', () => {
  it('throws when pool is missing', () => {
    expect(() => createStore(null)).toThrow(/pool/);
    expect(() => createStore(undefined)).toThrow(/pool/);
  });

  it('dbUpdateGameStatus forwards (pool, { gameId, status })', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'g1', status: 'hiding' }] }) };
    const store = createStore(pool);
    await store.dbUpdateGameStatus({ gameId: 'g1', status: 'hiding' });
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE games SET status/);
    expect(params).toEqual(['hiding', 'g1']);
  });

  it('dbSubmitScore forwards the score payload', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{
        id: 's1', game_id: 'g1', player_id: 'p1',
        score_seconds: 60, bonus_seconds: 0, captured_at: null, created_at: new Date(),
      }] }),
    };
    const store = createStore(pool);
    await store.dbSubmitScore({ gameId: 'g1', playerId: 'p1', scoreSeconds: 60 });
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO scores/);
  });

  it('dbExpireStaleQuestions unwraps { gameId } to the positional second arg', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const store = createStore(pool);
    await store.dbExpireStaleQuestions({ gameId: 'g1' });
    expect(pool.query).toHaveBeenCalled();
    const [, params] = pool.query.mock.calls[0];
    expect(params).toContain('g1');
  });

  it('dbGetGamePlayerCounts unwraps { gameId } and returns { hiderCount, seekerCount }', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [
        { role: 'hider',  count: 1 },
        { role: 'seeker', count: 2 },
      ] }),
    };
    const store = createStore(pool);
    const counts = await store.dbGetGamePlayerCounts({ gameId: 'g1' });
    expect(counts).toEqual({ hiderCount: 1, seekerCount: 2 });
    const [, params] = pool.query.mock.calls[0];
    expect(params).toEqual(['g1']);
  });
});
