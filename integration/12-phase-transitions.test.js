import { setup, teardown }    from './setup.js';
import { dbUpdateGameStatus } from '../db/gameStore.js';
import { getGame }            from '../functions/games.js';
import { makeGame }            from './helpers.js';

// Task 197 — regression guard for the schema constraint that supports Task 191
// (managed server writes phase transitions to Postgres on phase_change).  The
// managed server is NOT booted here; we exercise the DB layer end-to-end and
// verify getGame reflects each persisted status value.
describe.skipIf(!process.env.DATABASE_URL)('phase status persistence', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('(a) writes status=hiding and getGame reflects it', async () => {
    const game = await makeGame(pool);

    const updated = await dbUpdateGameStatus(pool, { gameId: game.gameId, status: 'hiding' });
    expect(updated).toEqual({ gameId: game.gameId, status: 'hiding' });

    const res = await getGame({ method: 'GET', params: { id: game.gameId } }, pool);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('hiding');
  });

  it('(b) writes status=seeking and getGame reflects it', async () => {
    const game = await makeGame(pool);

    const updated = await dbUpdateGameStatus(pool, { gameId: game.gameId, status: 'seeking' });
    expect(updated).toEqual({ gameId: game.gameId, status: 'seeking' });

    const res = await getGame({ method: 'GET', params: { id: game.gameId } }, pool);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('seeking');
  });

  it('(c) writes status=finished and getGame reflects it', async () => {
    const game = await makeGame(pool);

    const updated = await dbUpdateGameStatus(pool, { gameId: game.gameId, status: 'finished' });
    expect(updated).toEqual({ gameId: game.gameId, status: 'finished' });

    const res = await getGame({ method: 'GET', params: { id: game.gameId } }, pool);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('finished');
  });

  it('(d) chained transitions waiting → hiding → seeking → finished are each reflected', async () => {
    const game = await makeGame(pool);

    const initial = await getGame({ method: 'GET', params: { id: game.gameId } }, pool);
    expect(initial.status).toBe(200);
    expect(initial.body.status).toBe('waiting');

    for (const next of ['hiding', 'seeking', 'finished']) {
      const updated = await dbUpdateGameStatus(pool, { gameId: game.gameId, status: next });
      expect(updated).toEqual({ gameId: game.gameId, status: next });

      const res = await getGame({ method: 'GET', params: { id: game.gameId } }, pool);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(next);
    }
  });

  it('(e) returns null when updating a non-existent gameId', async () => {
    const result = await dbUpdateGameStatus(pool, {
      gameId: '00000000-0000-0000-0000-000000000000',
      status: 'hiding',
    });
    expect(result).toBeNull();
  });
});
