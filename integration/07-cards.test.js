import { setup, teardown }                              from './setup.js';
import { getCards, playCard }                           from '../functions/cards.js';
import { submitAnswer }                                 from '../functions/questions.js';
import { makePlayer, makeGame, makeJoin, makeQuestion } from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('cards', () => {
  let pool;
  let hider;
  let seeker;
  let game;

  // Card drawn in beforeAll for the hider (respondent) — used in tests (a), (c), (d).
  let sharedCard;

  beforeAll(async () => {
    pool   = await setup();
    hider  = await makePlayer(pool, { name: 'Hider Alice',  role: 'hider' });
    seeker = await makePlayer(pool, { name: 'Seeker Bob',   role: 'seeker' });
    game   = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const question = await makeQuestion(pool, {
      gameId:   game.gameId,
      askerId:  seeker.playerId,
      targetId: hider.playerId,
    });

    await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );

    // Card draw is fire-and-forget inside submitAnswer — yield to allow async DB
    // write to complete before querying.
    await new Promise(resolve => setTimeout(resolve, 100));

    const res = await getCards(
      { method: 'GET', query: { gameId: game.gameId, playerId: hider.playerId } },
      pool,
    );
    sharedCard = res.body.hand[0];
  });

  afterAll(async () => { await teardown(pool); });

  // ── Helper: draw a fresh unplayed card for hider in an isolated game ────────

  async function freshCard() {
    const g = await makeGame(pool);
    await makeJoin(pool, g.gameId, hider.playerId,  'hider');
    await makeJoin(pool, g.gameId, seeker.playerId, 'seeker');
    const q = await makeQuestion(pool, {
      gameId:   g.gameId,
      askerId:  seeker.playerId,
      targetId: hider.playerId,
    });
    await submitAnswer(
      { method: 'POST', params: { questionId: q.questionId }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    const res = await getCards(
      { method: 'GET', query: { gameId: g.gameId, playerId: hider.playerId } },
      pool,
    );
    return res.body.hand[0];
  }

  // ── (a) getCards response shape ────────────────────────────────────────────

  it('(a) getCards for player with a card → 200, body.hand is an array, gameId and playerId present', async () => {
    const res = await getCards(
      { method: 'GET', query: { gameId: game.gameId, playerId: hider.playerId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hand)).toBe(true);
    expect(res.body.gameId).toBe(game.gameId);
    expect(res.body.playerId).toBe(hider.playerId);
  });

  // ── (b) getCards for player with no cards ─────────────────────────────────

  it('(b) getCards for player with no cards → 200, body.hand is empty array', async () => {
    const res = await getCards(
      { method: 'GET', query: { gameId: game.gameId, playerId: seeker.playerId } },
      pool,
    );
    expect(res.status).toBe(200);
    expect(res.body.hand).toEqual([]);
  });

  // ── (c) play a valid card ─────────────────────────────────────────────────

  it('(c) playCard with valid cardId and owner playerId → 200, body.status=played', async () => {
    const res = await playCard(
      { method: 'POST', params: { cardId: sharedCard.cardId }, body: { playerId: hider.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('played');
  });

  // ── (d) play the same (already-played) card again ─────────────────────────

  it('(d) playing an already-played card → 404', async () => {
    const res = await playCard(
      { method: 'POST', params: { cardId: sharedCard.cardId }, body: { playerId: hider.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(404);
  });

  // ── (e) play a non-existent cardId ────────────────────────────────────────

  it('(e) playCard with non-existent cardId → 404', async () => {
    const res = await playCard(
      { method: 'POST', params: { cardId: '00000000-0000-0000-0000-000000000000' }, body: { playerId: hider.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(404);
  });

  // ── (f) play a valid card with wrong playerId ─────────────────────────────

  it('(f) playCard with valid cardId but wrong playerId → 404', async () => {
    const card = await freshCard();
    const res = await playCard(
      { method: 'POST', params: { cardId: card.cardId }, body: { playerId: seeker.playerId } },
      pool, '', null,
    );
    expect(res.status).toBe(404);
  });
});
