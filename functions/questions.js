/**
 * questions.js — Serverless handlers for the question/answer system.
 *
 * Routes:
 *   POST  /questions                — seeker submits a question to the hider
 *   GET   /questions?playerId=      — list questions addressed to a player
 *   POST  /answers/:questionId      — hider submits an answer; triggers WS broadcast
 *
 * All handlers accept an optional pg Pool as a second argument.
 * When omitted they fall back to an in-process Map (tests / local dev).
 *
 * When an answer is submitted, the handler optionally notifies the managed
 * game server via POST /internal/notify so it can broadcast the event to
 * all connected seekers.  The notification is fire-and-forget: a failure
 * does not fail the response.  The server URL is read from the GAME_SERVER_URL
 * environment variable (injected at call time so callers can override it).
 */

import { randomUUID } from 'node:crypto';
import {
  dbCreateQuestion,
  dbGetQuestionsForPlayer,
  dbSubmitAnswer,
} from '../db/gameStore.js';

const VALID_CATEGORIES = ['matching', 'thermometer', 'photo', 'tentacle'];

// ── In-process stores (no DB pool) ───────────────────────────────────────────

const _questions = new Map();
const _answers   = new Map();

/** Return a copy of the in-process question store (for testing). */
export function _getQuestionStore() { return new Map(_questions); }

/** Return a copy of the in-process answer store (for testing). */
export function _getAnswerStore() { return new Map(_answers); }

/** Clear both in-process stores (for test isolation). */
export function _clearStores() { _questions.clear(); _answers.clear(); }

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /questions
 * Body: { gameId, askerId, targetId, category, text }
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function submitQuestion(req, pool = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { gameId, askerId, targetId, category, text } = req.body ?? {};

  if (!gameId   || typeof gameId   !== 'string') return { status: 400, body: { error: 'gameId is required' } };
  if (!askerId  || typeof askerId  !== 'string') return { status: 400, body: { error: 'askerId is required' } };
  if (!targetId || typeof targetId !== 'string') return { status: 400, body: { error: 'targetId is required' } };
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return { status: 400, body: { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` } };
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { status: 400, body: { error: 'text is required' } };
  }

  if (pool) {
    return dbCreateQuestion(pool, { gameId, askerId, targetId, category, text }).then(row => ({
      status: 201,
      body: row,
    }));
  }

  const question = {
    questionId: randomUUID(),
    gameId,
    askerId,
    targetId,
    category,
    text: text.trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  _questions.set(question.questionId, question);
  return { status: 201, body: question };
}

/**
 * GET /questions?playerId=
 *
 * @param {{ method: string, query?: Record<string, string> }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function listQuestions(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { playerId } = req.query ?? {};
  if (!playerId || typeof playerId !== 'string') {
    return { status: 400, body: { error: 'playerId query parameter is required' } };
  }

  if (pool) {
    return dbGetQuestionsForPlayer(pool, playerId).then(questions => ({
      status: 200,
      body: { playerId, questions },
    }));
  }

  const questions = [..._questions.values()]
    .filter(q => q.targetId === playerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { status: 200, body: { playerId, questions } };
}

/**
 * POST /answers/:questionId
 * Body: { responderId, text }
 *
 * After persisting the answer, fires a fire-and-forget HTTP POST to
 * GAME_SERVER_URL/internal/notify so the managed server can broadcast
 * a `question_answered` event to connected seekers.
 *
 * @param {{ method: string, params: { questionId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]  Override for GAME_SERVER_URL env var.
 * @param {typeof fetch} [fetchFn]  Injectable fetch (tests / local dev).
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export async function submitAnswer(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { questionId } = req.params ?? {};
  if (!questionId || typeof questionId !== 'string') {
    return { status: 400, body: { error: 'questionId param is required' } };
  }

  const { responderId, text } = req.body ?? {};
  if (!responderId || typeof responderId !== 'string') {
    return { status: 400, body: { error: 'responderId is required' } };
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { status: 400, body: { error: 'text is required' } };
  }

  let answer;

  if (pool) {
    const row = await dbSubmitAnswer(pool, { questionId, responderId, text: text.trim() });
    if (!row) return { status: 404, body: { error: 'question not found' } };
    answer = row;
  } else {
    if (!_questions.has(questionId)) {
      return { status: 404, body: { error: 'question not found' } };
    }
    const question = _questions.get(questionId);
    answer = {
      answerId: randomUUID(),
      questionId,
      responderId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    _answers.set(answer.answerId, answer);
    _questions.set(questionId, { ...question, status: 'answered' });
  }

  // Fire-and-forget: notify managed server to broadcast to seekers.
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
    const question = pool ? null : _questions.get(questionId);
    const gameId = question?.gameId ?? null;
    fetchFn(`${serverUrl}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'question_answered',
        questionId,
        answerId: answer.answerId,
        responderId,
        gameId,
      }),
    }).catch(() => { /* intentionally silent */ });
  }

  return { status: 201, body: answer };
}
