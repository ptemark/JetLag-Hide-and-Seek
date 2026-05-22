import { setup, teardown }                              from './setup.js';
import { registerPlayer }                               from '../functions/players.js';
import {
  handleCreateGame,
  getGame,
  joinGame,
  handleStartGame,
}                                                       from '../functions/games.js';
import { submitQuestion, submitAnswer }                 from '../functions/questions.js';
import { getCards, playCard }                           from '../functions/cards.js';
import { submitScore, getLeaderboard }                  from '../functions/scores.js';

// Task 189 — end-to-end happy-path integration test exercising every serverless
// handler involved in a full game in one sequential describe.  Each step shares
// state through the outer `state` object.  Managed-server side effects are
// suppressed by passing '' for the gameServerUrl and null for the fetchFn.
describe.skipIf(!process.env.DATABASE_URL)('full game flow', () => {
  let pool;
  const state = {};

  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('(01) registers Alice as hider', async () => {
    const res = await registerPlayer(
      { method: 'POST', body: { name: 'Alice', role: 'hider' } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.role).toBe('hider');
    state.hider = res.body;
  });

  it('(02) registers Bob as seeker', async () => {
    const res = await registerPlayer(
      { method: 'POST', body: { name: 'Bob', role: 'seeker' } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.role).toBe('seeker');
    state.seeker = res.body;
  });

  it('(03) creates a medium game', async () => {
    const res = await handleCreateGame(
      {
        method: 'POST',
        body: { size: 'medium', bounds: {}, seekerTeams: 0, playerId: null },
      },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.size).toBe('medium');
    state.game = res.body;
  });

  it('(04) hider joins as hider', async () => {
    const res = await joinGame(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.hider.playerId, role: 'hider' },
      },
      pool,
    );
    expect(res.status).toBe(200);
  });

  it('(05) seeker joins as seeker', async () => {
    const res = await joinGame(
      {
        method: 'POST',
        params: { gameId: state.game.gameId },
        body:   { playerId: state.seeker.playerId, role: 'seeker' },
      },
      pool,
    );
    expect(res.status).toBe(200);
  });

  // Task 195 — no pre-start hider-zone requirement.  The serverless function
  // also does NOT update the DB status — that is the managed server's job.
  it('(06) handleStartGame → 204; DB status remains "waiting"', async () => {
    const startRes = await handleStartGame(
      { method: 'POST', params: { gameId: state.game.gameId }, body: {} },
      pool, '', null,
    );
    expect(startRes.status).toBe(204);

    const gameRes = await getGame(
      { method: 'GET', params: { id: state.game.gameId } },
      pool,
    );
    expect(gameRes.status).toBe(200);
    expect(gameRes.body.status).toBe('waiting');
  });

  it('(07) seeker submits a thermometer question targeting the hider', async () => {
    const res = await submitQuestion(
      {
        method: 'POST',
        body: {
          gameId:   state.game.gameId,
          askerId:  state.seeker.playerId,
          targetId: state.hider.playerId,
          category: 'thermometer',
          text:     'Are you closer?',
        },
      },
      pool, '', null, null,
    );
    expect(res.status).toBe(201);
    expect(res.body.questionId).toMatch(/^[0-9a-f-]{36}$/);
    state.question = res.body;
  });

  it('(08) hider answers the question', async () => {
    const res = await submitAnswer(
      {
        method: 'POST',
        params: { questionId: state.question.questionId },
        body:   { responderId: state.hider.playerId, text: 'Yes' },
      },
      pool, '', null,
    );
    expect(res.status).toBe(201);
  });

  // Card is drawn for the responder (hider) per functions/questions.js line 826.
  // Draw happens fire-and-forget inside submitAnswer — yield to let the async
  // INSERT complete before querying.
  it('(09) getCards for hider returns a non-empty hand', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const res = await getCards(
      { method: 'GET', query: { gameId: state.game.gameId, playerId: state.hider.playerId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hand)).toBe(true);
    expect(res.body.hand.length).toBeGreaterThan(0);
    state.card = res.body.hand[0];
  });

  it('(10) hider plays the drawn card → status="played"', async () => {
    const res = await playCard(
      {
        method: 'POST',
        params: { cardId: state.card.cardId },
        body:   { playerId: state.hider.playerId },
      },
      pool, '', null,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('played');
  });

  it('(11) hider submits final score (captured=true)', async () => {
    const res = await submitScore(
      {
        method: 'POST',
        body: {
          playerId:    state.hider.playerId,
          gameId:      state.game.gameId,
          hidingTimeMs: 300_000,
          captured:    true,
          bonusSeconds: 0,
        },
      },
      pool,
    );
    expect(res.status).toBe(201);
  });

  it('(12) seeker submits final score (captured=false)', async () => {
    const res = await submitScore(
      {
        method: 'POST',
        body: {
          playerId:    state.seeker.playerId,
          gameId:      state.game.gameId,
          hidingTimeMs: 100_000,
          captured:    false,
          bonusSeconds: 0,
        },
      },
      pool,
    );
    expect(res.status).toBe(201);
  });

  it('(13) getLeaderboard returns both players ranked', async () => {
    const res = await getLeaderboard(
      { method: 'GET', query: { gameId: state.game.gameId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(2);

    const names = res.body.scores.map(s => s.playerName);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });
});
