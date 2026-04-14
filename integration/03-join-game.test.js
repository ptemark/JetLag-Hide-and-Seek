import { setup, teardown } from './setup.js';
import { joinGame }        from '../functions/games.js';
import { makePlayer, makeGame } from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('joinGame', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('(a) valid hider join returns 200 with gameId, playerId, role=hider', async () => {
    const player = await makePlayer(pool, { name: 'Hider Alice', role: 'hider' });
    const game   = await makeGame(pool);

    const res = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, role: 'hider' } },
      pool,
    );

    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe(game.gameId);
    expect(res.body.playerId).toBe(player.playerId);
    expect(res.body.role).toBe('hider');
  });

  it('(b) second player joins same game as seeker and returns 200', async () => {
    const hider  = await makePlayer(pool, { name: 'Hider Bob', role: 'hider' });
    const seeker = await makePlayer(pool, { name: 'Seeker Carol', role: 'seeker' });
    const game   = await makeGame(pool);

    const hiderRes  = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: hider.playerId, role: 'hider' } },
      pool,
    );
    const seekerRes = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: seeker.playerId, role: 'seeker' } },
      pool,
    );

    expect(hiderRes.status).toBe(200);
    expect(seekerRes.status).toBe(200);
    expect(seekerRes.body.role).toBe('seeker');
    expect(seekerRes.body.gameId).toBe(game.gameId);
  });

  it('(c) same player joining the same game twice is idempotent — second response matches first', async () => {
    const player = await makePlayer(pool, { name: 'Hider Dave', role: 'hider' });
    const game   = await makeGame(pool);

    const first  = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, role: 'hider' } },
      pool,
    );
    const second = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, role: 'hider' } },
      pool,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.gameId).toBe(first.body.gameId);
    expect(second.body.playerId).toBe(first.body.playerId);
    expect(second.body.role).toBe(first.body.role);
  });

  it('(d) invalid role spectator returns 400', async () => {
    const player = await makePlayer(pool, { name: 'Spectator Eve', role: 'hider' });
    const game   = await makeGame(pool);

    const res = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, role: 'spectator' } },
      pool,
    );

    expect(res.status).toBe(400);
  });

  it('(e) missing playerId in body returns 400', async () => {
    const game = await makeGame(pool);

    const res = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { role: 'hider' } },
      pool,
    );

    expect(res.status).toBe(400);
  });

  it('(f) join with seekerTeams=2 game and explicit team=A persists the team', async () => {
    const player = await makePlayer(pool, { name: 'Seeker Frank', role: 'seeker' });
    const game   = await makeGame(pool, { seekerTeams: 2 });

    const res = await joinGame(
      { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, role: 'seeker', team: 'A' } },
      pool,
    );

    expect(res.status).toBe(200);
    expect(res.body.team).toBe('A');
  });
});
