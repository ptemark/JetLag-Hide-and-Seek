import { randomUUID }                   from 'node:crypto';
import { setup, teardown }              from './setup.js';
import { handleCreateGame, getGame }    from '../functions/games.js';
import { makePlayer }                   from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('handleCreateGame / getGame', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('creates a game with default params and returns 201 with expected fields', async () => {
    const res = await handleCreateGame({ method: 'POST', body: null }, pool);
    expect(res.status).toBe(201);
    expect(res.body.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.status).toBe('waiting');
    expect(res.body.size).toBe('medium');
    expect(res.body.seekerTeams).toBe(0);
  });

  it('creates a large game with seekerTeams=2 and persists both fields', async () => {
    const res = await handleCreateGame({ method: 'POST', body: { size: 'large', seekerTeams: 2 } }, pool);
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('large');
    expect(res.body.seekerTeams).toBe(2);
  });

  it('rejects invalid size with 400', async () => {
    const res = await handleCreateGame({ method: 'POST', body: { size: 'huge' } }, pool);
    expect(res.status).toBe(400);
  });

  it('rejects seekerTeams=1 with 400', async () => {
    const res = await handleCreateGame({ method: 'POST', body: { seekerTeams: 1 } }, pool);
    expect(res.status).toBe(400);
  });

  it('accepts an unknown playerId and returns 201 (host_player_id is advisory)', async () => {
    const unknownId = randomUUID();
    const res = await handleCreateGame({ method: 'POST', body: { playerId: unknownId } }, pool);
    expect(res.status).toBe(201);
    expect(res.body.gameId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retrieves a created game by id with status=waiting and players array', async () => {
    const created = await handleCreateGame({ method: 'POST', body: {} }, pool);
    expect(created.status).toBe(201);
    const { gameId } = created.body;

    const res = await getGame({ method: 'GET', params: { id: gameId } }, pool);
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe(gameId);
    expect(res.body.status).toBe('waiting');
    expect(Array.isArray(res.body.players)).toBe(true);
  });

  it('returns 404 for a game id that does not exist', async () => {
    const res = await getGame({ method: 'GET', params: { id: randomUUID() } }, pool);
    expect(res.status).toBe(404);
  });
});
