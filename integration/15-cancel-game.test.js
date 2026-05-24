import { setup, teardown }                       from './setup.js';
import { handleCancelGame, getGame, joinGame, handleCreateGame } from '../functions/games.js';
import { makePlayer }                             from './helpers.js';

// Task 203 — host-only cancel of an ongoing game.
//
// Verifies the DB-backed handler end-to-end against the live test Postgres
// (gated by DATABASE_URL): only the host may cancel, the cancel flips
// games.status to 'finished', and unknown / non-existent gameIds error out
// the way the UI expects.
describe.skipIf(!process.env.DATABASE_URL)('handleCancelGame', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  async function setupGameWithHost({ joinAsHider = true, joinAsSeeker = true } = {}) {
    const host   = await makePlayer(pool, { name: 'Cancel Host',   role: 'hider'  });
    const guest  = await makePlayer(pool, { name: 'Cancel Guest',  role: 'seeker' });
    const create = await handleCreateGame(
      { method: 'POST', body: { size: 'small', bounds: {}, seekerTeams: 0, playerId: host.playerId } },
      pool,
    );
    const gameId = create.body.gameId;
    if (joinAsHider)  await joinGame({ method: 'POST', params: { gameId }, body: { playerId: host.playerId,  role: 'hider'  } }, pool);
    if (joinAsSeeker) await joinGame({ method: 'POST', params: { gameId }, body: { playerId: guest.playerId, role: 'seeker' } }, pool);
    return { gameId, host, guest };
  }

  it('(a) host cancels their own game → 204 and DB status becomes finished', async () => {
    const { gameId, host } = await setupGameWithHost();
    const res = await handleCancelGame(
      { method: 'POST', params: { gameId }, body: { playerId: host.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(204);

    const gameRes = await getGame({ method: 'GET', params: { id: gameId } }, pool);
    expect(gameRes.status).toBe(200);
    expect(gameRes.body.status).toBe('finished');
  });

  it('(b) non-host attempt → 403 only_host_can_cancel; status unchanged', async () => {
    const { gameId, guest } = await setupGameWithHost();
    const res = await handleCancelGame(
      { method: 'POST', params: { gameId }, body: { playerId: guest.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('only_host_can_cancel');

    const gameRes = await getGame({ method: 'GET', params: { id: gameId } }, pool);
    expect(gameRes.body.status).toBe('waiting');
  });

  it('(c) unknown gameId → 404', async () => {
    const phantom = await makePlayer(pool, { name: 'Phantom', role: 'hider' });
    const res = await handleCancelGame(
      { method: 'POST', params: { gameId: '00000000-0000-0000-0000-000000000000' }, body: { playerId: phantom.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(404);
  });

  it('(d) missing playerId → 400', async () => {
    const { gameId } = await setupGameWithHost();
    const res = await handleCancelGame(
      { method: 'POST', params: { gameId }, body: {} },
      pool, '', null,
    );
    expect(res.status).toBe(400);
  });

  it('(e) cancelling an already-finished game is idempotent (still 204)', async () => {
    const { gameId, host } = await setupGameWithHost();
    const first = await handleCancelGame(
      { method: 'POST', params: { gameId }, body: { playerId: host.playerId } },
      pool, '', null,
    );
    expect(first.status).toBe(204);

    const second = await handleCancelGame(
      { method: 'POST', params: { gameId }, body: { playerId: host.playerId } },
      pool, '', null,
    );
    expect(second.status).toBe(204);
  });
});
