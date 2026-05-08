import { setup, teardown }                  from './setup.js';
import { markReady, getReadyStatus }        from '../functions/games.js';
import { makePlayer, makeGame, makeJoin }   from './helpers.js';

// Task 198 — verifies the DB-backed ready-tracker (Task 192) returns correct
// counts across multiple players, idempotent toggles, missing-input rejection,
// new-joiner total updates, and ON DELETE CASCADE behaviour when a game is
// removed.  Each test starts with a fresh game and freshly joined players to
// keep the counts isolated per gameId.
describe.skipIf(!process.env.DATABASE_URL)('markReady / getReadyStatus (DB-backed)', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('(a) two players ready → readyCount:2, totalCount:2', async () => {
    const hider  = await makePlayer(pool, { name: 'Alice', role: 'hider'  });
    const seeker = await makePlayer(pool, { name: 'Bob',   role: 'seeker' });
    const game   = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const r1 = await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: hider.playerId,  ready: true } },
      pool,
    );
    expect(r1.status).toBe(200);
    const r2 = await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: seeker.playerId, ready: true } },
      pool,
    );
    expect(r2.status).toBe(200);

    const status = await getReadyStatus({ method: 'GET', params: { gameId: game.gameId } }, pool);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ readyCount: 2, totalCount: 2 });
  });

  it('(b) toggling one player to ready:false drops readyCount to 1', async () => {
    const hider  = await makePlayer(pool, { name: 'Alice2', role: 'hider'  });
    const seeker = await makePlayer(pool, { name: 'Bob2',   role: 'seeker' });
    const game   = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: hider.playerId,  ready: true } },
      pool,
    );
    await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: seeker.playerId, ready: true } },
      pool,
    );

    const toggled = await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: hider.playerId, ready: false } },
      pool,
    );
    expect(toggled.status).toBe(200);

    const status = await getReadyStatus({ method: 'GET', params: { gameId: game.gameId } }, pool);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ readyCount: 1, totalCount: 2 });
  });

  it('(c) markReady with ready:true twice is idempotent (no double-count)', async () => {
    const player = await makePlayer(pool, { name: 'Solo', role: 'hider' });
    const game   = await makeGame(pool);
    await makeJoin(pool, game.gameId, player.playerId, 'hider');

    const first = await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, ready: true } },
      pool,
    );
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ readyCount: 1, totalCount: 1 });

    const second = await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, ready: true } },
      pool,
    );
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ readyCount: 1, totalCount: 1 });
  });

  it('(d) getReadyStatus for an unknown gameId returns 200 with zero counts', async () => {
    const res = await getReadyStatus(
      { method: 'GET', params: { gameId: '00000000-0000-0000-0000-000000000000' } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ readyCount: 0, totalCount: 0 });
  });

  it('(e) markReady with missing playerId returns 400', async () => {
    const game = await makeGame(pool);
    const res  = await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { ready: true } },
      pool,
    );
    expect(res.status).toBe(400);
  });

  it('(f) markReady with missing gameId returns 400', async () => {
    const player = await makePlayer(pool, { name: 'NoGame', role: 'hider' });
    const res = await markReady(
      { method: 'POST', params: {}, body: { playerId: player.playerId, ready: true } },
      pool,
    );
    expect(res.status).toBe(400);
  });

  it('(g) totalCount rises after a third player joins', async () => {
    const a = await makePlayer(pool, { name: 'A3', role: 'hider'  });
    const b = await makePlayer(pool, { name: 'B3', role: 'seeker' });
    const game = await makeGame(pool);
    await makeJoin(pool, game.gameId, a.playerId, 'hider');
    await makeJoin(pool, game.gameId, b.playerId, 'seeker');

    const before = await getReadyStatus({ method: 'GET', params: { gameId: game.gameId } }, pool);
    expect(before.status).toBe(200);
    expect(before.body.totalCount).toBe(2);

    const c = await makePlayer(pool, { name: 'C3', role: 'seeker' });
    await makeJoin(pool, game.gameId, c.playerId, 'seeker');

    const after = await getReadyStatus({ method: 'GET', params: { gameId: game.gameId } }, pool);
    expect(after.status).toBe(200);
    expect(after.body.totalCount).toBe(3);
  });

  it('(h) deleting the game cascades and removes ready rows', async () => {
    const player = await makePlayer(pool, { name: 'Cascade', role: 'hider' });
    const game   = await makeGame(pool);
    await makeJoin(pool, game.gameId, player.playerId, 'hider');
    await markReady(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, ready: true } },
      pool,
    );

    const before = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM game_ready_players WHERE game_id = $1',
      [game.gameId],
    );
    expect(before.rows[0].cnt).toBe(1);

    await pool.query('DELETE FROM games WHERE id = $1', [game.gameId]);

    const after = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM game_ready_players WHERE game_id = $1',
      [game.gameId],
    );
    expect(after.rows[0].cnt).toBe(0);
  });
});
