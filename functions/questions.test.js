import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  submitQuestion,
  listQuestions,
  submitAnswer,
  uploadQuestionPhoto,
  getQuestionPhoto,
  _getQuestionStore,
  _getAnswerStore,
  _getPhotoStore,
  _clearStores,
} from './questions.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQuestion(overrides = {}) {
  return {
    gameId: 'game-1',
    askerId: 'seeker-1',
    targetId: 'hider-1',
    category: 'matching',
    text: 'Are you near a red building?',
    ...overrides,
  };
}

// ── submitQuestion ────────────────────────────────────────────────────────────

describe('submitQuestion', () => {
  beforeEach(() => _clearStores());

  it('returns 201 and a question record for a valid request', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion() });
    expect(status).toBe(201);
    expect(body.questionId).toBeTruthy();
    expect(body.gameId).toBe('game-1');
    expect(body.askerId).toBe('seeker-1');
    expect(body.targetId).toBe('hider-1');
    expect(body.category).toBe('matching');
    expect(body.text).toBe('Are you near a red building?');
    expect(body.status).toBe('pending');
    expect(body.createdAt).toBeTruthy();
  });

  it('stores the question in the in-process store', () => {
    const { body } = submitQuestion({ method: 'POST', body: makeQuestion() });
    expect(_getQuestionStore().has(body.questionId)).toBe(true);
  });

  it('generates unique questionIds', () => {
    const { body: b1 } = submitQuestion({ method: 'POST', body: makeQuestion() });
    const { body: b2 } = submitQuestion({ method: 'POST', body: makeQuestion() });
    expect(b1.questionId).not.toBe(b2.questionId);
  });

  it('trims whitespace from text', () => {
    const { body } = submitQuestion({ method: 'POST', body: makeQuestion({ text: '  hello  ' }) });
    expect(body.text).toBe('hello');
  });

  it('accepts all valid categories', () => {
    for (const [i, category] of ['matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'].entries()) {
      const { status } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: `game-cat-${i}`, category }) });
      expect(status).toBe(201);
    }
  });

  it('returns 400 for missing gameId', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: undefined }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/gameId/);
  });

  it('returns 400 for missing askerId', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ askerId: undefined }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/askerId/);
  });

  it('returns 400 for missing targetId', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ targetId: undefined }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/targetId/);
  });

  it('returns 400 for invalid category', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ category: 'mystery' }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/category/);
  });

  it('returns 400 for blank text', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ text: '   ' }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/text/);
  });

  it('returns 400 for missing text', () => {
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ text: undefined }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/text/);
  });

  it('returns 405 for non-POST methods', () => {
    const { status } = submitQuestion({ method: 'GET', body: makeQuestion() });
    expect(status).toBe(405);
  });

  it('returns 409 when a pending question already exists for the same game', () => {
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-1' }) });
    const { status, body } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-1' }) });
    expect(status).toBe(409);
    expect(body.error).toMatch(/pending/i);
  });

  it('allows a new question in a different game even if one game has a pending question', () => {
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-1' }) });
    const { status } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-2' }) });
    expect(status).toBe(201);
  });

  it('includes expiresAt in the returned question', () => {
    const { body } = submitQuestion({ method: 'POST', body: makeQuestion({ category: 'matching' }) });
    expect(body.expiresAt).toBeTruthy();
    const diff = new Date(body.expiresAt) - new Date(body.createdAt);
    expect(diff).toBeGreaterThan(0);
  });

  it('sets a longer expiresAt for photo questions than for non-photo', () => {
    const { body: photo } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gp', category: 'photo' }) });
    _clearStores();
    const { body: standard } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gs', category: 'matching' }) });
    const photoExpiry = new Date(photo.expiresAt) - new Date(photo.createdAt);
    const standardExpiry = new Date(standard.expiresAt) - new Date(standard.createdAt);
    expect(photoExpiry).toBeGreaterThan(standardExpiry);
  });

  // Photo expiry by game scale — RULES.md: 10 min small, 15 min medium, 20 min large.
  it.each([
    ['small',  10 * 60 * 1000],
    ['medium', 15 * 60 * 1000],
    ['large',  20 * 60 * 1000],
  ])('photo question expiresAt reflects game scale %s (%i ms) in-process', (scale, expectedMs) => {
    const { status, body } = submitQuestion({
      method: 'POST',
      body: makeQuestion({ gameId: `scale-${scale}`, category: 'photo', gameScale: scale }),
    });
    expect(status).toBe(201);
    const diff = new Date(body.expiresAt) - new Date(body.createdAt);
    expect(diff).toBeGreaterThanOrEqual(expectedMs - 500);
    expect(diff).toBeLessThan(expectedMs + 500);
  });

  it('photo question via pool passes gameScale to dbCreateQuestion', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const mockRow = {
      questionId: 'q-scale', gameId: 'g-s', askerId: 'a-1', targetId: 't-1',
      category: 'photo', text: 'snap', status: 'pending', expiresAt,
      createdAt: new Date().toISOString(),
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ curse_expires_at: null }] })  // dbGetCurseExpiry
        .mockResolvedValueOnce({ rows: [] })                            // pending check
        // No SELECT games query — gameScale supplied in body
        .mockResolvedValueOnce({ rows: [
          { id: mockRow.questionId, game_id: mockRow.gameId, asker_id: mockRow.askerId,
            target_id: mockRow.targetId, category: mockRow.category, text: mockRow.text,
            status: mockRow.status, expires_at: mockRow.expiresAt, created_at: mockRow.createdAt },
        ] }),
    };
    const result = await submitQuestion(
      { method: 'POST', body: makeQuestion({ gameId: 'g-s', category: 'photo', gameScale: 'small' }) },
      pool,
    );
    expect(result.status).toBe(201);
    // Verify only 3 queries fired (curse + pending + INSERT) — no extra SELECT games.
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('allows a new question after the previous one is answered', async () => {
    const { body: q } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-3' }) });
    await submitAnswer(
      { method: 'POST', params: { questionId: q.questionId }, body: { responderId: 'hider-1', text: 'Yes.' } },
    );
    const { status } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-3' }) });
    expect(status).toBe(201);
  });

  it('delegates to pool when provided', async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const mockRow = {
      questionId: 'q-1', gameId: 'g-1', askerId: 'a-1', targetId: 't-1',
      category: 'photo', text: 'test', status: 'pending', expiresAt, createdAt: new Date().toISOString(),
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ curse_expires_at: null }] })  // dbGetCurseExpiry — no curse
        .mockResolvedValueOnce({ rows: [] })                            // pending check returns none
        .mockResolvedValueOnce({ rows: [
          { id: mockRow.questionId, game_id: mockRow.gameId, asker_id: mockRow.askerId,
            target_id: mockRow.targetId, category: mockRow.category, text: mockRow.text,
            status: mockRow.status, expires_at: mockRow.expiresAt, created_at: mockRow.createdAt }
        ] }),
    };
    const result = await submitQuestion({ method: 'POST', body: makeQuestion() }, pool);
    expect(result.status).toBe(201);
    expect(result.body.questionId).toBe('q-1');
    expect(result.body.expiresAt).toBeTruthy();
  });

  it('returns 409 via pool when a pending question exists for the game', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ curse_expires_at: null }] })  // dbGetCurseExpiry — no curse
        .mockResolvedValueOnce({ rows: [{ id: 'existing-q' }] }),       // pending check returns one
    };
    const result = await submitQuestion({ method: 'POST', body: makeQuestion() }, pool);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/pending/i);
  });

  it('returns 409 curse_active via pool when a curse is active for the game', async () => {
    const curseEndsAt = new Date(Date.now() + 90_000).toISOString();
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ curse_expires_at: curseEndsAt }] }),
    };
    const result = await submitQuestion({ method: 'POST', body: makeQuestion() }, pool);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('curse_active');
    expect(result.body.curseEndsAt).toBe(curseEndsAt);
  });

  it('returns 201 via pool when a past curse exists but has already expired', async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const pastCurse = new Date(Date.now() - 1000).toISOString();
    const mockRow = {
      questionId: 'q-nc', gameId: 'g-1', askerId: 'a-1', targetId: 't-1',
      category: 'matching', text: 'test', status: 'pending', expiresAt, createdAt: new Date().toISOString(),
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ curse_expires_at: pastCurse }] })  // expired curse
        .mockResolvedValueOnce({ rows: [] })                                  // no pending question
        .mockResolvedValueOnce({ rows: [
          { id: mockRow.questionId, game_id: mockRow.gameId, asker_id: mockRow.askerId,
            target_id: mockRow.targetId, category: mockRow.category, text: mockRow.text,
            status: mockRow.status, expires_at: mockRow.expiresAt, created_at: mockRow.createdAt }
        ] }),
    };
    const result = await submitQuestion({ method: 'POST', body: makeQuestion() }, pool);
    expect(result.status).toBe(201);
  });

  it('returns 409 curse_active (in-process) when curse card was played for the game', async () => {
    const { _clearCards, _curses } = await import('./cards.js');
    _clearCards();
    const curseEndsAt = new Date(Date.now() + 90_000).toISOString();
    _curses.set('game-1', curseEndsAt);
    const result = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-1' }) });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('curse_active');
    expect(result.body.curseEndsAt).toBe(curseEndsAt);
    _clearCards();
  });

  it('allows question (in-process) when curse has expired', async () => {
    const { _clearCards, _curses } = await import('./cards.js');
    _clearCards();
    _curses.set('game-1', new Date(Date.now() - 1000).toISOString()); // past curse
    const result = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'game-1' }) });
    expect(result.status).toBe(201);
    _clearCards();
  });

  it('fires question_pending notify with gameId, questionId, expiresAt on success (in-process)', () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const { status, body } = submitQuestion(
      { method: 'POST', body: makeQuestion() },
      null,
      'http://game-server',
      mockFetch,
    );
    expect(status).toBe(201);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/notify');
    const payload = JSON.parse(opts.body);
    expect(payload.type).toBe('question_pending');
    expect(payload.gameId).toBe('game-1');
    expect(payload.questionId).toBe(body.questionId);
    expect(payload.expiresAt).toBeTruthy();
  });

  it('does not fire question_pending notify when no server URL is provided', () => {
    const mockFetch = vi.fn();
    submitQuestion({ method: 'POST', body: makeQuestion() }, null, undefined, mockFetch);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fire question_pending notify on 409 conflict', () => {
    const mockFetch = vi.fn();
    // Create a question so the second one conflicts.
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'conflict-game' }) }, null, 'http://gs', mockFetch);
    mockFetch.mockClear();
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'conflict-game' }) }, null, 'http://gs', mockFetch);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires question_pending notify via pool on success', async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const mockRow = {
      questionId: 'q-pool', gameId: 'g-1', askerId: 'a-1', targetId: 't-1',
      category: 'matching', text: 'test', status: 'pending', expiresAt, createdAt: new Date().toISOString(),
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ curse_expires_at: null }] })  // dbGetCurseExpiry
        .mockResolvedValueOnce({ rows: [] })                            // no pending question
        .mockResolvedValueOnce({ rows: [
          { id: mockRow.questionId, game_id: mockRow.gameId, asker_id: mockRow.askerId,
            target_id: mockRow.targetId, category: mockRow.category, text: mockRow.text,
            status: mockRow.status, expires_at: mockRow.expiresAt, created_at: mockRow.createdAt }
        ] }),
    };
    const mockFetch = vi.fn().mockResolvedValue({});
    await submitQuestion({ method: 'POST', body: makeQuestion() }, pool, 'http://gs', mockFetch);
    expect(mockFetch).toHaveBeenCalledOnce();
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.type).toBe('question_pending');
    expect(payload.questionId).toBe('q-pool');
  });
});

// ── listQuestions ─────────────────────────────────────────────────────────────

describe('listQuestions', () => {
  beforeEach(() => _clearStores());

  it('returns 200 and all questions for the target player', () => {
    // Use distinct gameIds so each question is not blocked by the pending-question constraint.
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gl-1', targetId: 'hider-1' }) });
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gl-2', targetId: 'hider-1' }) });
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gl-3', targetId: 'hider-2' }) });

    const { status, body } = listQuestions({ method: 'GET', query: { playerId: 'hider-1' } });
    expect(status).toBe(200);
    expect(body.playerId).toBe('hider-1');
    expect(body.questions).toHaveLength(2);
  });

  it('returns empty array when player has no questions', () => {
    const { status, body } = listQuestions({ method: 'GET', query: { playerId: 'hider-9' } });
    expect(status).toBe(200);
    expect(body.questions).toHaveLength(0);
  });

  it('returns 400 when neither playerId nor gameId is provided', () => {
    const { status, body } = listQuestions({ method: 'GET', query: {} });
    expect(status).toBe(400);
    expect(body.error).toMatch(/playerId or gameId/);
  });

  it('returns 405 for non-GET methods', () => {
    const { status } = listQuestions({ method: 'POST', query: { playerId: 'p1' } });
    expect(status).toBe(405);
  });

  it('includes expiresAt in questions returned from in-process store', () => {
    submitQuestion({ method: 'POST', body: makeQuestion({ targetId: 'hider-x' }) });
    const { body } = listQuestions({ method: 'GET', query: { playerId: 'hider-x' } });
    expect(body.questions[0].expiresAt).toBeTruthy();
  });

  it('delegates to pool when provided', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { status, body } = await listQuestions({ method: 'GET', query: { playerId: 'p1' } }, pool);
    expect(status).toBe(200);
    expect(body.questions).toHaveLength(0);
    expect(pool.query).toHaveBeenCalledOnce();
  });

  // ── gameId path ───────────────────────────────────────────────────────────

  it('returns 200 with all questions for the game when gameId is provided', () => {
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gh-1', askerId: 's1', targetId: 'h1' }) });
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gh-2', askerId: 's1', targetId: 'h1' }) });

    const { status, body } = listQuestions({ method: 'GET', query: { gameId: 'gh-1' } });
    expect(status).toBe(200);
    expect(body.gameId).toBe('gh-1');
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].gameId).toBe('gh-1');
  });

  it('returns empty questions array when no questions exist for game', () => {
    const { status, body } = listQuestions({ method: 'GET', query: { gameId: 'no-such-game' } });
    expect(status).toBe(200);
    expect(body.questions).toHaveLength(0);
  });

  it('includes answer data on answered questions when fetching by gameId', async () => {
    const { body: q } = submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gh-ans' }) });
    await submitAnswer({ method: 'POST', params: { questionId: q.questionId }, body: { responderId: 'h1', text: 'Yes!' } });

    const { body } = listQuestions({ method: 'GET', query: { gameId: 'gh-ans' } });
    expect(body.questions[0].answer).toEqual(expect.objectContaining({ text: 'Yes!' }));
  });

  it('returns null answer for pending questions when fetching by gameId', () => {
    submitQuestion({ method: 'POST', body: makeQuestion({ gameId: 'gh-pend' }) });
    const { body } = listQuestions({ method: 'GET', query: { gameId: 'gh-pend' } });
    expect(body.questions[0].answer).toBeNull();
  });

  it('delegates gameId path to pool', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { status, body } = await listQuestions({ method: 'GET', query: { gameId: 'g1' } }, pool);
    expect(status).toBe(200);
    expect(body.gameId).toBe('g1');
    expect(body.questions).toHaveLength(0);
    expect(pool.query).toHaveBeenCalledOnce();
  });
});

// ── submitAnswer ──────────────────────────────────────────────────────────────

describe('submitAnswer', () => {
  beforeEach(() => _clearStores());

  function createQuestion() {
    const { body } = submitQuestion({ method: 'POST', body: makeQuestion() });
    return body;
  }

  it('returns 201 and answer record for valid request', async () => {
    const question = createQuestion();
    const { status, body } = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: 'Yes, near the library.' } },
    );
    expect(status).toBe(201);
    expect(body.answerId).toBeTruthy();
    expect(body.questionId).toBe(question.questionId);
    expect(body.responderId).toBe('hider-1');
    expect(body.text).toBe('Yes, near the library.');
    expect(body.createdAt).toBeTruthy();
  });

  it('marks the question as answered', async () => {
    const question = createQuestion();
    await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: 'Yes.' } },
    );
    const store = _getQuestionStore();
    expect(store.get(question.questionId).status).toBe('answered');
  });

  it('stores the answer in the answer store', async () => {
    const question = createQuestion();
    const { body } = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: 'Yes.' } },
    );
    expect(_getAnswerStore().has(body.answerId)).toBe(true);
  });

  it('trims whitespace from answer text', async () => {
    const question = createQuestion();
    const { body } = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: '  Yes.  ' } },
    );
    expect(body.text).toBe('Yes.');
  });

  it('returns 404 for unknown questionId', async () => {
    const { status, body } = await submitAnswer(
      { method: 'POST', params: { questionId: 'no-such-id' }, body: { responderId: 'hider-1', text: 'Yes.' } },
    );
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 for missing responderId', async () => {
    const question = createQuestion();
    const { status, body } = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { text: 'Yes.' } },
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/responderId/);
  });

  it('returns 400 for blank text', async () => {
    const question = createQuestion();
    const { status, body } = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: '   ' } },
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/text/);
  });

  it('returns 400 for missing questionId param', async () => {
    const { status, body } = await submitAnswer(
      { method: 'POST', params: {}, body: { responderId: 'hider-1', text: 'Yes.' } },
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/questionId/);
  });

  it('returns 405 for non-POST methods', async () => {
    const { status } = await submitAnswer(
      { method: 'GET', params: { questionId: 'any' }, body: {} },
    );
    expect(status).toBe(405);
  });

  it('fires notify to game server when GAME_SERVER_URL is set', async () => {
    const question = createQuestion();
    const mockFetch = vi.fn().mockResolvedValue({});
    await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: 'Yes.' } },
      null,
      'http://gameserver:3000',
      mockFetch,
    );
    // fetch is fire-and-forget; allow microtasks to flush
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://gameserver:3000/internal/notify');
    expect(JSON.parse(opts.body).type).toBe('question_answered');
    expect(JSON.parse(opts.body).questionId).toBe(question.questionId);
  });

  it('does not fire notify when game server URL is absent', async () => {
    const question = createQuestion();
    const mockFetch = vi.fn();
    await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: 'Yes.' } },
      null,
      undefined,
      mockFetch,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fail if game server notify request rejects', async () => {
    const question = createQuestion();
    const mockFetch = vi.fn().mockRejectedValue(new Error('network'));
    const { status } = await submitAnswer(
      { method: 'POST', params: { questionId: question.questionId }, body: { responderId: 'hider-1', text: 'Yes.' } },
      null,
      'http://gameserver:3000',
      mockFetch,
    );
    expect(status).toBe(201);
  });

  it('delegates to pool when provided', async () => {
    const mockAnswer = {
      answerId: 'ans-1', questionId: 'q-1', responderId: 'r-1',
      text: 'Yes.', createdAt: new Date().toISOString(),
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'q-1' }] })   // check question exists
        .mockResolvedValueOnce({ rows: [                       // insert answer
          { id: mockAnswer.answerId, question_id: mockAnswer.questionId,
            responder_id: mockAnswer.responderId, text: mockAnswer.text,
            created_at: mockAnswer.createdAt }
        ] })
        .mockResolvedValueOnce({ rows: [] }),                 // update question status
    };
    const { status, body } = await submitAnswer(
      { method: 'POST', params: { questionId: 'q-1' }, body: { responderId: 'r-1', text: 'Yes.' } },
      pool,
    );
    expect(status).toBe(201);
    expect(body.answerId).toBe('ans-1');
  });

  it('returns 404 via pool when question does not exist', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { status, body } = await submitAnswer(
      { method: 'POST', params: { questionId: 'missing' }, body: { responderId: 'r-1', text: 'Yes.' } },
      pool,
    );
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });
});

// ── Router integration ────────────────────────────────────────────────────────

describe('question routes via router', () => {
  beforeEach(() => _clearStores());

  it('POST /questions is reachable through router', async () => {
    const { handleRequest } = await import('./router.js');
    const { Readable } = await import('node:stream');

    const body = JSON.stringify(makeQuestion());
    const req = Object.assign(Readable.from([body]), {
      method: 'POST', url: '/questions',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const chunks = [];
    const res = {
      writeHead: vi.fn(),
      end: (chunk) => { if (chunk) chunks.push(chunk); },
    };
    await handleRequest(req, res, { limiter: { check: () => ({ allowed: true }) } });
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.questionId).toBeTruthy();
  });

  it('GET /questions?playerId= is reachable through router', async () => {
    const { handleRequest } = await import('./router.js');
    const { Readable } = await import('node:stream');

    const req = Object.assign(Readable.from([]), {
      method: 'GET', url: '/questions?playerId=hider-1',
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const chunks = [];
    const res = {
      writeHead: vi.fn(),
      end: (chunk) => { if (chunk) chunks.push(chunk); },
    };
    await handleRequest(req, res, { limiter: { check: () => ({ allowed: true }) } });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.playerId).toBe('hider-1');
  });

  it('POST /answers/:questionId is reachable through router', async () => {
    const { body: question } = submitQuestion({ method: 'POST', body: makeQuestion() });
    const { handleRequest } = await import('./router.js');
    const { Readable } = await import('node:stream');

    const body = JSON.stringify({ responderId: 'hider-1', text: 'Yes.' });
    const req = Object.assign(Readable.from([body]), {
      method: 'POST', url: `/answers/${question.questionId}`,
      headers: { host: 'localhost', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const chunks = [];
    const res = {
      writeHead: vi.fn(),
      end: (chunk) => { if (chunk) chunks.push(chunk); },
    };
    await handleRequest(req, res, { limiter: { check: () => ({ allowed: true }) } });
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
  });

  it('POST /questions/:questionId/photo is reachable through router', async () => {
    const { body: question } = submitQuestion({ method: 'POST', body: makeQuestion() });
    const { handleRequest } = await import('./router.js');
    const { Readable } = await import('node:stream');

    const body = JSON.stringify({ photoData: 'data:image/png;base64,abc123' });
    const req = Object.assign(Readable.from([body]), {
      method: 'POST', url: `/questions/${question.questionId}/photo`,
      headers: { host: 'localhost', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const chunks = [];
    const res = {
      writeHead: vi.fn(),
      end: (chunk) => { if (chunk) chunks.push(chunk); },
    };
    await handleRequest(req, res, { limiter: { check: () => ({ allowed: true }) } });
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.photoId).toBeTruthy();
  });

  it('GET /questions/:questionId/photo is reachable through router', async () => {
    const { body: question } = submitQuestion({ method: 'POST', body: makeQuestion() });
    await uploadQuestionPhoto({
      method: 'POST', params: { questionId: question.questionId },
      body: { photoData: 'data:image/png;base64,xyz' },
    });
    const { handleRequest } = await import('./router.js');
    const { Readable } = await import('node:stream');

    const req = Object.assign(Readable.from([]), {
      method: 'GET', url: `/questions/${question.questionId}/photo`,
      headers: { host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const chunks = [];
    const res = {
      writeHead: vi.fn(),
      end: (chunk) => { if (chunk) chunks.push(chunk); },
    };
    await handleRequest(req, res, { limiter: { check: () => ({ allowed: true }) } });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.photoData).toBe('data:image/png;base64,xyz');
  });
});

// ── uploadQuestionPhoto ───────────────────────────────────────────────────────

describe('uploadQuestionPhoto', () => {
  beforeEach(() => _clearStores());

  function createQuestion() {
    const { body } = submitQuestion({ method: 'POST', body: makeQuestion() });
    return body;
  }

  it('returns 201 and photo record for valid request', async () => {
    const question = createQuestion();
    const { status, body } = await uploadQuestionPhoto({
      method: 'POST',
      params: { questionId: question.questionId },
      body: { photoData: 'data:image/png;base64,abc' },
    });
    expect(status).toBe(201);
    expect(body.photoId).toBeTruthy();
    expect(body.questionId).toBe(question.questionId);
    expect(body.uploadedAt).toBeTruthy();
  });

  it('stores photo in the in-process store', async () => {
    const question = createQuestion();
    await uploadQuestionPhoto({
      method: 'POST',
      params: { questionId: question.questionId },
      body: { photoData: 'data:image/png;base64,abc' },
    });
    expect(_getPhotoStore().has(question.questionId)).toBe(true);
  });

  it('trims whitespace from photoData', async () => {
    const question = createQuestion();
    await uploadQuestionPhoto({
      method: 'POST',
      params: { questionId: question.questionId },
      body: { photoData: '  data:image/png;base64,abc  ' },
    });
    const stored = _getPhotoStore().get(question.questionId);
    expect(stored.photoData).toBe('data:image/png;base64,abc');
  });

  it('overwrites a previous photo on re-upload', async () => {
    const question = createQuestion();
    await uploadQuestionPhoto({
      method: 'POST', params: { questionId: question.questionId },
      body: { photoData: 'data:image/png;base64,first' },
    });
    await uploadQuestionPhoto({
      method: 'POST', params: { questionId: question.questionId },
      body: { photoData: 'data:image/png;base64,second' },
    });
    const stored = _getPhotoStore().get(question.questionId);
    expect(stored.photoData).toBe('data:image/png;base64,second');
  });

  it('returns 404 for unknown questionId', async () => {
    const { status, body } = await uploadQuestionPhoto({
      method: 'POST',
      params: { questionId: 'no-such-id' },
      body: { photoData: 'data:image/png;base64,abc' },
    });
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 when questionId param is missing', async () => {
    const { status, body } = await uploadQuestionPhoto({
      method: 'POST', params: {}, body: { photoData: 'data:image/png;base64,abc' },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/questionId/);
  });

  it('returns 400 when photoData is missing', async () => {
    const question = createQuestion();
    const { status, body } = await uploadQuestionPhoto({
      method: 'POST', params: { questionId: question.questionId }, body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/photoData/);
  });

  it('returns 400 when photoData is blank', async () => {
    const question = createQuestion();
    const { status, body } = await uploadQuestionPhoto({
      method: 'POST', params: { questionId: question.questionId }, body: { photoData: '   ' },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/photoData/);
  });

  it('returns 405 for non-POST methods', async () => {
    const { status } = await uploadQuestionPhoto({
      method: 'GET', params: { questionId: 'any' }, body: {},
    });
    expect(status).toBe(405);
  });

  it('delegates to pool when provided', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'ph-1', question_id: 'q-1', uploaded_at: new Date().toISOString() }],
      }),
    };
    const { status, body } = await uploadQuestionPhoto({
      method: 'POST',
      params: { questionId: 'q-1' },
      body: { photoData: 'data:image/png;base64,abc' },
    }, pool);
    expect(status).toBe(201);
    expect(body.photoId).toBe('ph-1');
    expect(body.questionId).toBe('q-1');
  });
});

// ── getQuestionPhoto ──────────────────────────────────────────────────────────

describe('getQuestionPhoto', () => {
  beforeEach(() => _clearStores());

  function createQuestionWithPhoto() {
    const { body: question } = submitQuestion({ method: 'POST', body: makeQuestion() });
    uploadQuestionPhoto({
      method: 'POST',
      params: { questionId: question.questionId },
      body: { photoData: 'data:image/png;base64,testdata' },
    });
    return question;
  }

  it('returns 200 and photo record for existing photo', async () => {
    const question = createQuestionWithPhoto();
    const { status, body } = await getQuestionPhoto({
      method: 'GET',
      params: { questionId: question.questionId },
    });
    expect(status).toBe(200);
    expect(body.photoId).toBeTruthy();
    expect(body.questionId).toBe(question.questionId);
    expect(body.photoData).toBe('data:image/png;base64,testdata');
    expect(body.uploadedAt).toBeTruthy();
  });

  it('returns 404 when no photo exists', async () => {
    const { body: question } = submitQuestion({ method: 'POST', body: makeQuestion() });
    const { status, body } = await getQuestionPhoto({
      method: 'GET',
      params: { questionId: question.questionId },
    });
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it('returns 404 for unknown questionId', async () => {
    const { status, body } = await getQuestionPhoto({
      method: 'GET',
      params: { questionId: 'no-such' },
    });
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 when questionId param is missing', async () => {
    const { status, body } = await getQuestionPhoto({ method: 'GET', params: {} });
    expect(status).toBe(400);
    expect(body.error).toMatch(/questionId/);
  });

  it('returns 405 for non-GET methods', async () => {
    const { status } = await getQuestionPhoto({ method: 'POST', params: { questionId: 'q1' } });
    expect(status).toBe(405);
  });

  it('delegates to pool when provided', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: 'ph-1', question_id: 'q-1',
          photo_data: 'data:image/png;base64,abc',
          uploaded_at: new Date().toISOString(),
        }],
      }),
    };
    const { status, body } = await getQuestionPhoto({
      method: 'GET', params: { questionId: 'q-1' },
    }, pool);
    expect(status).toBe(200);
    expect(body.photoData).toBe('data:image/png;base64,abc');
  });

  it('returns 404 via pool when photo does not exist', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { status } = await getQuestionPhoto({
      method: 'GET', params: { questionId: 'missing' },
    }, pool);
    expect(status).toBe(404);
  });
});

// ── submitQuestion — thermometer enrichment ────────────────────────────────

describe('submitQuestion — thermometer enrichment', () => {
  beforeEach(() => _clearStores());

  it('fetches thermometer endpoint and stores distances for thermometer questions (in-process)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ result: 'warmer', currentDistanceM: 500, previousDistanceM: 1200 }),
    });

    const { status, body } = await submitQuestion(
      { method: 'POST', body: makeQuestion({ category: 'thermometer', text: 'warmer or colder?' }) },
      null,
      'http://game-server',
      mockFetch,
      'test-admin-key',
    );

    expect(status).toBe(201);
    expect(body.thermometerCurrentDistanceM).toBe(500);
    expect(body.thermometerPreviousDistanceM).toBe(1200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/internal/games/game-1/thermometer');
    expect(url).toContain('seekerId=seeker-1');
    expect(opts.headers['Authorization']).toBe('Bearer test-admin-key');
  });

  it('stores null distances when thermometer fetch fails (in-process)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));

    const { status, body } = await submitQuestion(
      { method: 'POST', body: makeQuestion({ category: 'thermometer', text: 'warmer or colder?' }) },
      null,
      'http://game-server',
      mockFetch,
      'test-admin-key',
    );

    expect(status).toBe(201);
    expect(body.thermometerCurrentDistanceM).toBeNull();
    expect(body.thermometerPreviousDistanceM).toBeNull();
  });

  it('does not fetch thermometer endpoint for non-thermometer categories (in-process)', async () => {
    const mockFetch = vi.fn();

    await submitQuestion(
      { method: 'POST', body: makeQuestion({ category: 'matching', text: 'Is it near water?' }) },
      null,
      'http://game-server',
      mockFetch,
      'test-admin-key',
    );

    // mockFetch only called for question_pending notify, not for thermometer
    const thermometerCalls = mockFetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/thermometer'),
    );
    expect(thermometerCalls).toHaveLength(0);
  });

  it('stores null distances when no gameServerUrl is configured (in-process)', async () => {
    const { status, body } = await submitQuestion(
      { method: 'POST', body: makeQuestion({ category: 'thermometer', text: 'warmer?' }) },
      null,
      undefined,     // no gameServerUrl
      undefined,     // no fetch
      null,          // no adminApiKey
    );

    expect(status).toBe(201);
    expect(body.thermometerCurrentDistanceM).toBeNull();
    expect(body.thermometerPreviousDistanceM).toBeNull();
  });

  it('fetches thermometer endpoint and passes distances to dbCreateQuestion (pool path)', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const capturedArgs = {};

    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })   // no active curse
        .mockResolvedValueOnce({ rows: [] })   // pending check: no conflict
        .mockImplementationOnce((sql, params) => {
          capturedArgs.params = params;
          return Promise.resolve({ rows: [{
            id: 'q-therm', game_id: 'game-1', asker_id: 'seeker-1', target_id: 'hider-1',
            category: 'thermometer', text: 'warmer?', status: 'pending',
            expires_at: expiresAt, created_at: new Date(),
            thermometer_current_distance_m: params[6],
            thermometer_previous_distance_m: params[7],
          }] });
        }),
    };

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ result: 'colder', currentDistanceM: 900, previousDistanceM: 400 }),
    });

    const { status, body } = await submitQuestion(
      { method: 'POST', body: makeQuestion({ category: 'thermometer', text: 'warmer?' }) },
      pool,
      'http://game-server',
      mockFetch,
      'test-admin-key',
    );

    expect(status).toBe(201);
    expect(body.thermometerCurrentDistanceM).toBe(900);
    expect(body.thermometerPreviousDistanceM).toBe(400);
    // Verify distances were passed as INSERT params
    expect(capturedArgs.params[6]).toBe(900);
    expect(capturedArgs.params[7]).toBe(400);
  });
});
