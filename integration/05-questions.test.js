import { setup, teardown }                    from './setup.js';
import { submitQuestion, listQuestions,
         submitAnswer }                        from '../functions/questions.js';
import { makePlayer, makeGame, makeJoin }      from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('questions', () => {
  let pool;
  let hider;
  let seeker;

  beforeAll(async () => {
    pool   = await setup();
    hider  = await makePlayer(pool, { name: 'Hider Alice',  role: 'hider' });
    seeker = await makePlayer(pool, { name: 'Seeker Bob',   role: 'seeker' });
  });
  afterAll(async () => { await teardown(pool); });

  // ── Helper: submit a question in a fresh isolated game ───────────────────────

  /**
   * Create a fresh game, join hider + seeker, then submit one question.
   * Each test that needs an isolated game calls this so the one-pending-at-a-time
   * constraint never spans across test cases.
   *
   * @param {{ category?: string, size?: string, text?: string }} [opts]
   * @returns {Promise<{ res: object, gameId: string }>}
   */
  async function submitInFreshGame({ category = 'thermometer', size = 'medium', text = 'Where are you?' } = {}) {
    const game = await makeGame(pool, { size });
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');
    const res = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category, text } },
      pool, '', null, null,
    );
    return { res, gameId: game.gameId };
  }

  // ── (a) thermometer ──────────────────────────────────────────────────────────

  it('(a) thermometer question → 201', async () => {
    const { res } = await submitInFreshGame({ category: 'thermometer' });
    expect(res.status).toBe(201);
    expect(res.body.questionId).toBeDefined();
    expect(res.body.category).toBe('thermometer');
  });

  // ── (b) matching ─────────────────────────────────────────────────────────────

  it('(b) matching question → 201', async () => {
    const { res } = await submitInFreshGame({ category: 'matching' });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('matching');
  });

  // ── (c) measuring ────────────────────────────────────────────────────────────

  it('(c) measuring question → 201', async () => {
    const { res } = await submitInFreshGame({ category: 'measuring' });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('measuring');
  });

  // ── (d) transit ──────────────────────────────────────────────────────────────

  it('(d) transit question → 201', async () => {
    const { res } = await submitInFreshGame({ category: 'transit' });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('transit');
  });

  // ── (e) tentacle ─────────────────────────────────────────────────────────────

  it('(e) tentacle question → 201', async () => {
    const { res } = await submitInFreshGame({ category: 'tentacle' });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('tentacle');
  });

  // ── (f) photo expiry longer than non-photo ───────────────────────────────────

  it('(f) photo question with size=medium has longer expiresAt than non-photo', async () => {
    const game = await makeGame(pool, { size: 'medium' });
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    // Submit non-photo question first.
    const nonPhotoRes = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'thermometer', text: 'Are you close?' } },
      pool, '', null, null,
    );
    expect(nonPhotoRes.status).toBe(201);
    const nonPhotoExpiresAt = new Date(nonPhotoRes.body.expiresAt).getTime();

    // Answer the non-photo question so the pending slot is free.
    await submitAnswer(
      { method: 'POST', params: { questionId: nonPhotoRes.body.questionId }, body: { responderId: hider.playerId, text: 'Yes' } },
      pool, '', null,
    );

    // Submit photo question.
    const photoRes = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'photo', text: 'Show me where you are.' } },
      pool, '', null, null,
    );
    expect(photoRes.status).toBe(201);
    const photoExpiresAt = new Date(photoRes.body.expiresAt).getTime();

    // Photo expiry (15 min for medium) must be further in the future than non-photo (5 min).
    expect(photoExpiresAt).toBeGreaterThan(nonPhotoExpiresAt);
  });

  // ── (g) invalid category ─────────────────────────────────────────────────────

  it('(g) invalid category "flavour" → 400', async () => {
    const game = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const res = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'flavour', text: 'What flavour?' } },
      pool, '', null, null,
    );
    expect(res.status).toBe(400);
  });

  // ── (h) missing text ─────────────────────────────────────────────────────────

  it('(h) missing text field → 400', async () => {
    const game = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const res = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'thermometer' } },
      pool, '', null, null,
    );
    expect(res.status).toBe(400);
  });

  // ── (i) one-pending-at-a-time ────────────────────────────────────────────────

  it('(i) second submitQuestion while first is pending → 409', async () => {
    const game = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    // First question — should succeed.
    const first = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'thermometer', text: 'First question?' } },
      pool, '', null, null,
    );
    expect(first.status).toBe(201);

    // Second question while first is still pending — must fail.
    const second = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'transit', text: 'Second question?' } },
      pool, '', null, null,
    );
    expect(second.status).toBe(409);
  });

  // ── (j) listQuestions returns questions addressed to a player ────────────────

  it('(j) listQuestions with hider.playerId → 200, list includes the question', async () => {
    const game = await makeGame(pool);
    await makeJoin(pool, game.gameId, hider.playerId,  'hider');
    await makeJoin(pool, game.gameId, seeker.playerId, 'seeker');

    const submitted = await submitQuestion(
      { method: 'POST', body: { gameId: game.gameId, askerId: seeker.playerId, targetId: hider.playerId, category: 'thermometer', text: 'Can you hear me?' } },
      pool, '', null, null,
    );
    expect(submitted.status).toBe(201);

    const listRes = await listQuestions(
      { method: 'GET', query: { playerId: hider.playerId } },
      pool,
    );
    expect(listRes.status).toBe(200);
    const ids = listRes.body.questions.map(q => q.questionId);
    expect(ids).toContain(submitted.body.questionId);
  });

  // ── (k) listQuestions for player who received no questions → empty ────────────

  it('(k) listQuestions for player with no questions → 200, empty array', async () => {
    const newPlayer = await makePlayer(pool, { name: 'Isolated Player', role: 'hider' });

    const listRes = await listQuestions(
      { method: 'GET', query: { playerId: newPlayer.playerId } },
      pool,
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.questions).toEqual([]);
  });
});
