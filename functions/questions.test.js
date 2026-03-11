import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  submitQuestion,
  listQuestions,
  submitAnswer,
  _getQuestionStore,
  _getAnswerStore,
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
    for (const [i, category] of ['matching', 'thermometer', 'photo', 'tentacle'].entries()) {
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
        .mockResolvedValueOnce({ rows: [] })  // pending check returns none
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
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-q' }] }),  // pending check returns one
    };
    const result = await submitQuestion({ method: 'POST', body: makeQuestion() }, pool);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/pending/i);
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

  it('returns 400 when playerId is missing', () => {
    const { status, body } = listQuestions({ method: 'GET', query: {} });
    expect(status).toBe(400);
    expect(body.error).toMatch(/playerId/);
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
});
