/**
 * scores.js — Serverless handler for score submission.
 *
 * POST /scores  { playerId, gameId, hidingTimeMs, captured }
 *            →  { scoreId, playerId, gameId, hidingTimeMs, captured, submittedAt }
 *
 * Pass a pg Pool as the second argument to persist to the database.
 * Omit the pool to use the in-process Map (tests / local dev).
 *
 * DB mapping:
 *   hidingTimeMs  → score_seconds (rounded to nearest second)
 *   captured=true → captured_at = NOW(); false → captured_at = null
 */

import { randomUUID } from 'node:crypto';
import { dbSubmitScore } from '../db/gameStore.js';

// In-process store — used when no DB pool is provided (tests / local dev).
const _scores = new Map();

/**
 * Submit a score for a completed game.
 *
 * When `pool` is supplied the score is persisted to the database and a
 * Promise is returned.  Without a pool the operation is synchronous and
 * uses the in-process Map.
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function submitScore(req, pool = null) {
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

  if (pool) {
    const scoreSeconds = Math.round(hidingTimeMs / 1000);
    const capturedAt = captured ? new Date().toISOString() : null;
    return dbSubmitScore(pool, { gameId, playerId, scoreSeconds, capturedAt }).then(row => ({
      status: 201,
      body: {
        scoreId: row.scoreId,
        playerId: row.playerId,
        gameId: row.gameId,
        hidingTimeMs,
        captured,
        submittedAt: row.createdAt,
      },
    }));
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
