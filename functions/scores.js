/**
 * scores.js — Serverless handler for score submission.
 *
 * POST /scores  { playerId, gameId, hidingTimeMs, captured, bonusSeconds? }
 *            →  { scoreId, playerId, gameId, hidingTimeMs, bonusSeconds, captured, submittedAt }
 *
 * Pass a pg Pool as the second argument to persist to the database.
 * Omit the pool to use the in-process Map (tests / local dev).
 *
 * DB mapping:
 *   hidingTimeMs  → score_seconds (rounded to nearest second)
 *   bonusSeconds  → bonus_seconds (default 0)
 *   captured=true → captured_at = NOW(); false → captured_at = null
 */

import { randomUUID } from 'node:crypto';
import { dbSubmitScore, dbGetLeaderboard } from '../db/gameStore.js';

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

  const { playerId, gameId, hidingTimeMs, captured, bonusSeconds = 0 } = req.body ?? {};

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
  if (typeof bonusSeconds !== 'number' || bonusSeconds < 0) {
    return { status: 400, body: { error: 'bonusSeconds must be a non-negative number' } };
  }

  if (pool) {
    const scoreSeconds = Math.round(hidingTimeMs / 1000);
    const capturedAt = captured ? new Date().toISOString() : null;
    return dbSubmitScore(pool, { gameId, playerId, scoreSeconds, bonusSeconds, capturedAt }).then(row => ({
      status: 201,
      body: {
        scoreId: row.scoreId,
        playerId: row.playerId,
        gameId: row.gameId,
        hidingTimeMs,
        bonusSeconds: row.bonusSeconds,
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
    bonusSeconds,
    captured,
    submittedAt: new Date().toISOString(),
  };

  _scores.set(score.scoreId, score);
  return { status: 201, body: score };
}

/**
 * Return ranked leaderboard scores with player name and game scale.
 *
 * GET /scores?limit=20&gameId=<optional>
 *   → { scores: [{ rank, playerName, scale, scoreSeconds, bonusSeconds, createdAt }] }
 *
 * Without a DB pool, results are derived from the in-process store (no name/scale resolution).
 *
 * @param {{ method: string, query: { limit?: string, gameId?: string } }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function getLeaderboard(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const rawLimit = parseInt(req.query?.limit ?? '20', 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
  const gameId = req.query?.gameId || null;

  if (pool) {
    return dbGetLeaderboard(pool, { limit, gameId }).then(scores => ({
      status: 200,
      body: { scores },
    }));
  }

  // In-process fallback: sort by hidingTimeMs; no name/scale resolution available.
  const entries = [..._scores.values()]
    .filter(s => !gameId || s.gameId === gameId)
    .sort((a, b) => b.hidingTimeMs - a.hidingTimeMs)
    .slice(0, limit)
    .map((s, i) => ({
      rank: i + 1,
      playerName: s.playerId,
      scale: null,
      scoreSeconds: Math.round(s.hidingTimeMs / 1000),
      bonusSeconds: s.bonusSeconds,
      createdAt: s.submittedAt,
    }));

  return { status: 200, body: { scores: entries } };
}

/** Return a copy of the in-process score store (for testing). */
export function _getStore() {
  return new Map(_scores);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _scores.clear();
}
