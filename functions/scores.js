/**
 * scores.js — Serverless handler for score submission.
 *
 * POST /scores  { playerId, gameId, hidingTimeMs, captured }
 *            →  { scoreId, playerId, gameId, hidingTimeMs, captured, submittedAt }
 *
 * Storage is in-memory (placeholder). Task 9–10 will wire this to the DB.
 */

import { randomUUID } from 'node:crypto';

// In-process store — replaced by DB in Task 9.
const _scores = new Map();

/**
 * Submit a score for a completed game.
 *
 * @param {{ method: string, body: unknown }} req
 * @returns {{ status: number, body: object }}
 */
export function submitScore(req) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { playerId, gameId, hidingTimeMs, captured } = req.body ?? {};

  if (!playerId || typeof playerId !== 'string') {
    return { status: 400, body: { error: 'playerId is required' } };
  }
  if (!gameId || typeof gameId !== 'string') {
    return { status: 400, body: { error: 'gameId is required' } };
  }
  if (typeof hidingTimeMs !== 'number' || hidingTimeMs < 0) {
    return { status: 400, body: { error: 'hidingTimeMs must be a non-negative number' } };
  }
  if (typeof captured !== 'boolean') {
    return { status: 400, body: { error: 'captured must be a boolean' } };
  }

  const score = {
    scoreId: randomUUID(),
    playerId,
    gameId,
    hidingTimeMs,
    captured,
    submittedAt: new Date().toISOString(),
  };

  _scores.set(score.scoreId, score);
  return { status: 201, body: score };
}

/** Return a copy of the in-process score store (for testing). */
export function _getStore() {
  return new Map(_scores);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _scores.clear();
}
