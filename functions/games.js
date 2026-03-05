/**
 * games.js — Serverless handler for game creation and state queries.
 *
 * POST /games      { size }      → new game record
 * GET  /games/:id               → game state snapshot
 *
 * Pass a pg Pool as the second argument to persist to / read from the
 * database.  Omit the pool to use the in-process Map (tests / local dev).
 */

import { randomUUID } from 'node:crypto';
import { dbCreateGame, dbGetGame } from '../db/gameStore.js';

export const VALID_SIZES = Object.freeze(['small', 'medium', 'large']);
export const VALID_STATUSES = Object.freeze(['waiting', 'hiding', 'seeking', 'finished']);

// In-process store — used when no DB pool is provided (tests / local dev).
const _games = new Map();

/**
 * Create a new game.
 *
 * When `pool` is supplied the game is persisted to the database and a
 * Promise is returned.  Without a pool the operation is synchronous and
 * uses the in-process Map.
 *
 * @param {{ size?: string, bounds?: object }} options
 * @param {import('pg').Pool|null} [pool]
 * @returns {object | Promise<object>} game record
 */
export function createGame({ size = 'medium', bounds = {} } = {}, pool = null) {
  if (!VALID_SIZES.includes(size)) {
    throw new Error(`size must be one of: ${VALID_SIZES.join(', ')}`);
  }

  if (pool) {
    return dbCreateGame(pool, { size, bounds });
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
 * When `pool` is supplied the game is fetched from the database and a
 * Promise is returned.  Without a pool the in-process Map is queried.
 *
 * @param {{ method: string, params: { id: string } }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function getGame(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { id } = req.params ?? {};
  if (!id) {
    return { status: 400, body: { error: 'game id is required' } };
  }

  if (pool) {
    return dbGetGame(pool, id).then(game => {
      if (!game) return { status: 404, body: { error: 'game not found' } };
      return { status: 200, body: game };
    });
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
