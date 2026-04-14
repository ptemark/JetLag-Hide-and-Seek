import { setup, teardown }                        from './setup.js';
import { handleStartGame, getGame }               from '../functions/games.js';
import { makePlayer, makeGame, makeJoin, makeZone } from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('handleStartGame', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('(a) happy path — hider + seeker + zone → 204; DB status stays waiting', async () => {
    const hider  = await makePlayer(pool, { name: 'Hider Alice', role: 'hider' });
    const seeker = await makePlayer(pool, { name: 'Seeker Bob',  role: 'seeker' });
    const game   = await makeGame(pool);

    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');
    await makeZone(pool, game.gameId);

    const res = await handleStartGame(
      { method: 'POST', params: { gameId: game.gameId }, body: {} },
      pool, '', null,
    );

    expect(res.status).toBe(204);

    // The serverless function does NOT update the DB status — that is the
    // managed server's job. The game must still read as 'waiting'.
    const gameRes = await getGame(
      { method: 'GET', params: { id: game.gameId } },
      pool,
    );
    expect(gameRes.status).toBe(200);
    expect(gameRes.body.status).toBe('waiting');
  });

  it('(b) game with seeker but no hider → 400 insufficient_players', async () => {
    const seeker = await makePlayer(pool, { name: 'Seeker Carol', role: 'seeker' });
    const game   = await makeGame(pool);

    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const res = await handleStartGame(
      { method: 'POST', params: { gameId: game.gameId }, body: {} },
      pool, '', null,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_players');
  });

  it('(c) game with hider but no seeker → 400 insufficient_players', async () => {
    const hider = await makePlayer(pool, { name: 'Hider Dave', role: 'hider' });
    const game  = await makeGame(pool);

    await makeJoin(pool, game.gameId, hider.playerId, 'hider');

    const res = await handleStartGame(
      { method: 'POST', params: { gameId: game.gameId }, body: {} },
      pool, '', null,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_players');
  });

  it('(d) game with hider + seeker but no zone → 400 no_hider_zone', async () => {
    const hider  = await makePlayer(pool, { name: 'Hider Eve',  role: 'hider' });
    const seeker = await makePlayer(pool, { name: 'Seeker Frank', role: 'seeker' });
    const game   = await makeGame(pool);

    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const res = await handleStartGame(
      { method: 'POST', params: { gameId: game.gameId }, body: {} },
      pool, '', null,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_hider_zone');
  });
});
