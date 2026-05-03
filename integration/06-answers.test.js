import { setup, teardown }                              from './setup.js';
import { submitAnswer, listQuestions }                   from '../functions/questions.js';
import { getCards }                                      from '../functions/cards.js';
import { makePlayer, makeGame, makeJoin, makeQuestion }  from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('answers', () => {
  let pool;
  let hider;
  let seeker;

  beforeAll(async () => {
    pool   = await setup();
    hider  = await makePlayer(pool, { name: 'Hider Alice',  role: 'hider' });
    seeker = await makePlayer(pool, { name: 'Seeker Bob',   role: 'seeker' });
  });

  afterAll(async () => { await teardown(pool); });

  // ── Helper: create a fresh isolated game with both players joined ─────────

  async function freshGame() {
    const game = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');
    return game;
  }

  // ── (a) valid answer changes question status to 'answered' ────────────────

  it('(a) valid answer for pending question → 201, listQuestions shows status=answered', async () => {
    const game = await freshGame();
    const question = await makeQuestion(pool, {
      gameId:   game.gameId,
      askerId:  seeker.playerId,
      targetId: hider.playerId,
    });

    const res = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );

    expect(res.status).toBe(201);

    const listRes = await listQuestions(
      { method: 'GET', query: { gameId: game.gameId } },
      pool,
    );
    expect(listRes.status).toBe(200);
    const found = listRes.body.questions.find(q => q.questionId === question.questionId);
    expect(found).toBeDefined();
    expect(found.status).toBe('answered');
  });

  // ── (b) answer text is persisted ─────────────────────────────────────────

  it('(b) answer text is persisted and returned by listQuestions', async () => {
    const game = await freshGame();
    const question = await makeQuestion(pool, {
      gameId:   game.gameId,
      askerId:  seeker.playerId,
      targetId: hider.playerId,
    });

    const answerText = 'Definitely closer to the station!';
    await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: hider.playerId, text: answerText } },
      pool, '', null,
    );

    const listRes = await listQuestions(
      { method: 'GET', query: { gameId: game.gameId } },
      pool,
    );
    expect(listRes.status).toBe(200);
    const found = listRes.body.questions.find(q => q.questionId === question.questionId);
    expect(found).toBeDefined();
    expect(found.answer).not.toBeNull();
    expect(found.answer.text).toBe(answerText);
  });

  // ── (c) non-existent questionId → 404 ────────────────────────────────────

  it('(c) non-existent questionId → 404', async () => {
    const res = await submitAnswer(
      { method: 'POST', params: { questionId: '00000000-0000-0000-0000-000000000000' }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );
    expect(res.status).toBe(404);
  });

  // ── (d) already-answered question → 409 ──────────────────────────────────

  it('(d) answering an already-answered question → 409', async () => {
    const game = await freshGame();
    const question = await makeQuestion(pool, {
      gameId:   game.gameId,
      askerId:  seeker.playerId,
      targetId: hider.playerId,
    });

    const first = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );
    expect(first.status).toBe(201);

    const second = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: hider.playerId, text: 'No, wait' } },
      pool, '', null,
    );
    expect(second.status).toBe(409);
  });

  // ── side-effect: card drawn for the respondent after a successful answer ──

  it('(e) answering draws a card for the respondent (hider)', async () => {
    const game = await freshGame();
    const question = await makeQuestion(pool, {
      gameId:   game.gameId,
      askerId:  seeker.playerId,
      targetId: hider.playerId,
    });

    await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );

    // The card draw is fire-and-forget inside submitAnswer — yield to the event
    // loop long enough for the async DB write to complete before querying.
    await new Promise(resolve => setTimeout(resolve, 100));

    const cardsRes = await getCards(
      { method: 'GET', query: { gameId: game.gameId, playerId: hider.playerId } },
      pool,
    );
    expect(cardsRes.status).toBe(200);
    expect(cardsRes.body.hand).toBeInstanceOf(Array);
    expect(cardsRes.body.hand.length).toBeGreaterThan(0);
  });
});
