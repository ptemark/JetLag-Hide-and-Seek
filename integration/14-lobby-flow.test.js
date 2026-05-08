import { setup, teardown } from './setup.js';
import {
  handleCreateGame,
  getGame,
  joinGame,
  handleStartGame,
  markReady,
  getReadyStatus,
} from '../functions/games.js';
import { makePlayer } from './helpers.js';

// Task 199 — full lobby visibility and start flow.
// Verifies the API surface that the lobby UI relies on after Tasks 191
// (status persistence), 192 (DB-backed ready), 193 (player list polling),
// and 195 (no pre-start zone requirement).  Single sequential describe;
// steps share state via an outer `state` object.
describe.skipIf(!process.env.DATABASE_URL)('full lobby flow', () => {
  let pool;
  const state = {};

  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('(01) registers Alice as hider', async () => {
    state.alice = await makePlayer(pool, { name: 'Alice', role: 'hider' });
    expect(state.alice.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.alice.role).toBe('hider');
  });

  it('(02) registers Bob as seeker', async () => {
    state.bob = await makePlayer(pool, { name: 'Bob', role: 'seeker' });
    expect(state.bob.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.bob.role).toBe('seeker');
  });

  it('(03) Alice creates a game as host', async () => {
    const res = await handleCreateGame(
      {
        method: 'POST',
        body: {
          size: 'medium',
          bounds: {},
          seekerTeams: 0,
          playerId: state.alice.playerId,
        },
      },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.hostPlayerId).toBe(state.alice.playerId);
    state.game = res.body;
  });

  it('(04) Alice joins as hider', async () => {
    const res = await joinGame(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.alice.playerId, role: 'hider' },
      },
      pool,
    );
    expect(res.status).toBe(200);
  });

  it('(05) Bob joins as seeker', async () => {
    const res = await joinGame(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.bob.playerId, role: 'seeker' },
      },
      pool,
    );
    expect(res.status).toBe(200);
  });

  it('(06) getGame surfaces both players, roles, and host marker', async () => {
    const res = await getGame(
      { method: 'GET', params: { id: state.game.gameId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body.players.length).toBe(2);

    const names = res.body.players.map(p => p.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');

    const hiders  = res.body.players.filter(p => p.role === 'hider');
    const seekers = res.body.players.filter(p => p.role === 'seeker');
    expect(hiders.length).toBe(1);
    expect(seekers.length).toBe(1);

    expect(res.body.hostPlayerId).toBe(state.alice.playerId);
  });

  it('(07) Alice marks ready → 1/2', async () => {
    const res = await markReady(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.alice.playerId, ready: true },
      },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ readyCount: 1, totalCount: 2 });
  });

  it('(08) Bob marks ready → 2/2', async () => {
    const res = await markReady(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.bob.playerId, ready: true },
      },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ readyCount: 2, totalCount: 2 });
  });

  it('(09) getReadyStatus reflects 2/2', async () => {
    const res = await getReadyStatus(
      { method: 'GET', params: { gameId: state.game.gameId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ readyCount: 2, totalCount: 2 });
  });

  it('(10) handleStartGame returns 204 with no zone locked', async () => {
    const res = await handleStartGame(
      { method: 'POST', params: { gameId: state.game.gameId }, body: {} },
      pool, '', null,
    );
    expect(res.status).toBe(204);
  });

  it('(11) Carol joins as a third seeker; getGame shows 3 players', async () => {
    state.carol = await makePlayer(pool, { name: 'Carol', role: 'seeker' });

    const join = await joinGame(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.carol.playerId, role: 'seeker' },
      },
      pool,
    );
    expect(join.status).toBe(200);

    const res = await getGame(
      { method: 'GET', params: { id: state.game.gameId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body.players.length).toBe(3);
    expect(res.body.players.map(p => p.name)).toContain('Carol');
  });

  it('(12) Carol marks ready → 3/3', async () => {
    const res = await markReady(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.carol.playerId, ready: true },
      },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ readyCount: 3, totalCount: 3 });
  });
});
