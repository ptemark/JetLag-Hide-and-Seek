/**
 * games.js — Serverless handler for basic game state queries.
 *
 * GET /games/:id  → game state snapshot
 *
 * Storage is in-memory (placeholder). Task 9–10 will wire this to the DB.
 */

import { randomUUID } from 'node:crypto';

export const VALID_SIZES = Object.freeze(['small', 'medium', 'large']);
export const VALID_STATUSES = Object.freeze(['waiting', 'hiding', 'seeking', 'finished']);

// In-process store — replaced by DB in Task 9.
const _games = new Map();

/**
 * Create a new game (used internally and by tests).
 *
 * @param {{ size: string }} options
 * @returns {object} game record
 */
export function createGame({ size = 'medium' } = {}) {
  if (!VALID_SIZES.includes(size)) {
    throw new Error(`size must be one of: ${VALID_SIZES.join(', ')}`);
  }

  const game = {
    gameId: randomUUID(),
    size,
    status: 'waiting',
    players: [],
    zones: [],
    questions: [],
    challenge_deck: [],
    createdAt: new Date().toISOString(),
  };

  _games.set(game.gameId, game);
  return game;
}

/**
 * Retrieve a game by ID.
 *
 * @param {{ method: string, params: { id: string } }} req
 * @returns {{ status: number, body: object }}
 */
export function getGame(req) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { id } = req.params ?? {};
  if (!id) {
    return { status: 400, body: { error: 'game id is required' } };
  }

  const game = _games.get(id);
  if (!game) {
    return { status: 404, body: { error: 'game not found' } };
  }

  return { status: 200, body: game };
}

/** Return a copy of the in-process game store (for testing). */
export function _getStore() {
  return new Map(_games);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _games.clear();
}
