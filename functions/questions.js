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
  dbGetQuestionsForGame,
  dbSubmitAnswer,
  dbDrawCard,
  dbSaveQuestionPhoto,
  dbGetQuestionPhoto,
} from '../db/gameStore.js';
import { drawCardInProcess, randomCardDescriptor } from './cards.js';

/** Answer deadline in milliseconds by category. Photo: 15 min; others: 5 min. */
const QUESTION_EXPIRY_MS = { photo: 15 * 60 * 1000, default: 5 * 60 * 1000 };

const VALID_CATEGORIES = ['matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'];

// ── In-process stores (no DB pool) ───────────────────────────────────────────

const _questions = new Map();
const _answers   = new Map();
const _photos    = new Map(); // Map<questionId, { photoId, questionId, photoData, uploadedAt }>

/** Return a copy of the in-process question store (for testing). */
export function _getQuestionStore() { return new Map(_questions); }

/** Return a copy of the in-process answer store (for testing). */
export function _getAnswerStore() { return new Map(_answers); }

/** Return a copy of the in-process photo store (for testing). */
export function _getPhotoStore() { return new Map(_photos); }

/** Clear all in-process stores (for test isolation). */
export function _clearStores() { _questions.clear(); _answers.clear(); _photos.clear(); }

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: notify the managed server that a new pending question exists
 * so it can broadcast a `question_pending` WS event with the expiry deadline.
 */
function notifyQuestionPending({ gameId, questionId, expiresAt }, gameServerUrl, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
    Promise.resolve(fetchFn(`${serverUrl}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'question_pending', gameId, questionId, expiresAt }),
    })).catch(() => { /* intentionally silent */ });
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /questions
 * Body: { gameId, askerId, targetId, category, text }
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function submitQuestion(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
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
    return dbCreateQuestion(pool, { gameId, askerId, targetId, category, text }).then(row => {
      if (row.conflict) return { status: 409, body: { error: 'A pending question already exists for this game' } };
      notifyQuestionPending({ gameId, questionId: row.questionId, expiresAt: row.expiresAt }, gameServerUrl, fetchFn);
      return { status: 201, body: row };
    });
  }

  // Enforce one-pending-question-at-a-time per game in the in-process store.
  const hasPending = [..._questions.values()].some(
    q => q.gameId === gameId && q.status === 'pending',
  );
  if (hasPending) {
    return { status: 409, body: { error: 'A pending question already exists for this game' } };
  }

  const expiresAt = new Date(
    Date.now() + (category === 'photo' ? QUESTION_EXPIRY_MS.photo : QUESTION_EXPIRY_MS.default),
  ).toISOString();
  const question = {
    questionId: randomUUID(),
    gameId,
    askerId,
    targetId,
    category,
    text: text.trim(),
    status: 'pending',
    expiresAt,
    createdAt: new Date().toISOString(),
  };
  _questions.set(question.questionId, question);
  notifyQuestionPending({ gameId, questionId: question.questionId, expiresAt: question.expiresAt }, gameServerUrl, fetchFn);
  return { status: 201, body: question };
}

/**
 * GET /questions?playerId= | GET /questions?gameId=
 *
 * When `gameId` is provided, returns all Q&A pairs for the game (seeker history).
 * When `playerId` is provided, returns questions addressed to that player (hider inbox).
 * At least one of the two params must be present.
 *
 * @param {{ method: string, query?: Record<string, string> }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function listQuestions(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { playerId, gameId } = req.query ?? {};

  // ── gameId path: full Q&A history for a game ─────────────────────────────
  if (gameId && typeof gameId === 'string') {
    if (pool) {
      return dbGetQuestionsForGame(pool, gameId).then(questions => ({
        status: 200,
        body: { gameId, questions },
      }));
    }
    // In-process: build history by joining _questions and _answers.
    const questions = [..._questions.values()]
      .filter(q => q.gameId === gameId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(q => {
        const answer = [..._answers.values()].find(a => a.questionId === q.questionId) ?? null;
        return {
          ...q,
          answer: answer ? { text: answer.text, createdAt: answer.createdAt } : null,
        };
      });
    return { status: 200, body: { gameId, questions } };
  }

  // ── playerId path: hider inbox ────────────────────────────────────────────
  if (!playerId || typeof playerId !== 'string') {
    return { status: 400, body: { error: 'playerId or gameId query parameter is required' } };
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
  let gameId = null;

  if (pool) {
    const row = await dbSubmitAnswer(pool, { questionId, responderId, text: text.trim() });
    if (!row) return { status: 404, body: { error: 'question not found' } };
    answer = row;

    // Draw a card for the answering player (fire-and-forget; hand-full is silently ignored).
    if (row.gameId) {
      gameId = row.gameId;
      const { type, effect } = randomCardDescriptor();
      dbDrawCard(pool, { gameId: row.gameId, playerId: responderId, type, effect }).catch(() => { /* silent */ });
    }
  } else {
    if (!_questions.has(questionId)) {
      return { status: 404, body: { error: 'question not found' } };
    }
    const question = _questions.get(questionId);
    gameId = question.gameId ?? null;
    answer = {
      answerId: randomUUID(),
      questionId,
      responderId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    _answers.set(answer.answerId, answer);
    _questions.set(questionId, { ...question, status: 'answered' });

    // Draw a card for the answering player in the in-process store.
    if (gameId) {
      drawCardInProcess({ gameId, playerId: responderId });
    }
  }

  // Fire-and-forget: notify managed server to broadcast to seekers.
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
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

/**
 * POST /questions/:questionId/photo
 * Body: { photoData } — base64-encoded image string.
 *
 * Stores the photo associated with a question. Idempotent: re-uploading
 * replaces the previous photo.
 *
 * @param {{ method: string, params: { questionId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export async function uploadQuestionPhoto(req, pool = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { questionId } = req.params ?? {};
  if (!questionId || typeof questionId !== 'string') {
    return { status: 400, body: { error: 'questionId param is required' } };
  }

  const { photoData } = req.body ?? {};
  if (!photoData || typeof photoData !== 'string' || !photoData.trim()) {
    return { status: 400, body: { error: 'photoData is required' } };
  }

  if (pool) {
    const photo = await dbSaveQuestionPhoto(pool, { questionId, photoData: photoData.trim() });
    return { status: 201, body: photo };
  }

  // In-process store: verify question exists.
  if (!_questions.has(questionId)) {
    return { status: 404, body: { error: 'question not found' } };
  }
  const photo = {
    photoId: randomUUID(),
    questionId,
    photoData: photoData.trim(),
    uploadedAt: new Date().toISOString(),
  };
  _photos.set(questionId, photo);
  return { status: 201, body: { photoId: photo.photoId, questionId, uploadedAt: photo.uploadedAt } };
}

/**
 * GET /questions/:questionId/photo
 *
 * Returns the photo record for a question, or 404 if no photo has been uploaded.
 *
 * @param {{ method: string, params: { questionId: string } }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export async function getQuestionPhoto(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { questionId } = req.params ?? {};
  if (!questionId || typeof questionId !== 'string') {
    return { status: 400, body: { error: 'questionId param is required' } };
  }

  if (pool) {
    const photo = await dbGetQuestionPhoto(pool, questionId);
    if (!photo) return { status: 404, body: { error: 'photo not found' } };
    return { status: 200, body: photo };
  }

  const photo = _photos.get(questionId);
  if (!photo) return { status: 404, body: { error: 'photo not found' } };
  return { status: 200, body: photo };
}
