/**
 * games.js — Serverless handler for game creation and state queries.
 *
 * POST /games                → new game record
 * GET  /games/:id            → game state snapshot
 * POST /games/:gameId/start  → notify managed server to begin hiding phase
 *
 * Pass a pg Pool as the second argument to persist to / read from the
 * database.  Omit the pool to use the in-process Map (tests / local dev).
 */

import { randomUUID } from 'node:crypto';
import { dbCreateGame, dbGetGame, dbGetGamePlayerCounts } from '../db/gameStore.js';

export const VALID_SIZES = Object.freeze(['small', 'medium', 'large']);
export const VALID_STATUSES = Object.freeze(['waiting', 'hiding', 'seeking', 'finished']);

/**
 * Valid hiding/seeking duration ranges per scale (RULES.md §Game Scales).
 * All values in minutes.
 */
export const SCALE_DURATION_RANGES = Object.freeze({
  small:  Object.freeze({ min: 30,  max: 60  }),
  medium: Object.freeze({ min: 60,  max: 180 }),
  large:  Object.freeze({ min: 180, max: 360 }),
});

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
export function createGame({ size = 'medium', bounds = {}, seekerTeams = 0 } = {}, pool = null) {
  if (!VALID_SIZES.includes(size)) {
    throw new Error(`size must be one of: ${VALID_SIZES.join(', ')}`);
  }
  if (seekerTeams !== 0 && seekerTeams !== 2) {
    throw new Error('seekerTeams must be 0 (disabled) or 2');
  }

  if (pool) {
    return dbCreateGame(pool, { size, bounds, seekerTeams });
  }

  const game = {
    gameId: randomUUID(),
    size,
    status: 'waiting',
    seekerTeams,
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

/**
 * HTTP handler: create a new game.
 *
 * POST /games  { size?, bounds? }  → 201 { gameId, size, status, ... }
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function handleCreateGame(req, pool = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { size = 'medium', bounds = {}, seekerTeams = 0 } = req.body ?? {};

  try {
    const result = createGame({ size, bounds, seekerTeams }, pool);
    if (result && typeof result.then === 'function') {
      return result.then(game => ({ status: 201, body: game }));
    }
    return { status: 201, body: result };
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
}

/**
 * Notify the managed server to begin the hiding phase for a game.
 * Fire-and-forget — errors are intentionally swallowed.
 *
 * @param {{ gameId: string, scale?: string, hidingDurationMs?: number, seekingDurationMs?: number }} options
 * @param {string|undefined} gameServerUrl
 * @param {typeof fetch} fetchFn
 */
function notifyGameStart({ gameId, scale, hidingDurationMs, seekingDurationMs }, gameServerUrl, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
    const payload = { scale };
    if (hidingDurationMs != null) payload.hidingDurationMs = hidingDurationMs;
    if (seekingDurationMs != null) payload.seekingDurationMs = seekingDurationMs;
    Promise.resolve(fetchFn(
      `${serverUrl}/internal/games/${encodeURIComponent(gameId)}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )).catch(() => { /* intentionally silent */ });
  }
}

/**
 * HTTP handler: start a game's hiding phase.
 *
 * POST /games/:gameId/start  { scale?, hidingDurationMin? }  → 204
 *
 * Notifies the managed game server to call startGame + beginHiding for the
 * given game.  The notify is fire-and-forget; the response is immediate.
 *
 * When `hidingDurationMin` is provided it must fall within the valid range for
 * the given `scale` (see SCALE_DURATION_RANGES).  Out-of-range values return 400.
 *
 * @param {{ method: string, params: { gameId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]  Override for GAME_SERVER_URL env var.
 * @param {typeof fetch} [fetchFn]  Injectable fetch (tests / local dev).
 * @returns {{ status: number, body: object }}
 */
export async function handleStartGame(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { gameId } = req.params ?? {};
  if (!gameId || typeof gameId !== 'string') {
    return { status: 400, body: { error: 'gameId param is required' } };
  }

  const { scale, hidingDurationMin } = req.body ?? {};

  if (hidingDurationMin !== undefined) {
    const range = SCALE_DURATION_RANGES[scale];
    if (!range) {
      return { status: 400, body: { error: `scale required when hidingDurationMin is set` } };
    }
    if (typeof hidingDurationMin !== 'number' || hidingDurationMin < range.min || hidingDurationMin > range.max) {
      return {
        status: 400,
        body: { error: `hidingDurationMin out of range for scale '${scale}': must be ${range.min}–${range.max} min` },
      };
    }
  }

  // When a DB pool is available, validate minimum player requirements before
  // notifying the managed server. Without a pool the server performs its own check.
  if (pool) {
    const { hiderCount, seekerCount } = await dbGetGamePlayerCounts(pool, gameId);
    if (hiderCount < 1) {
      return { status: 400, body: { error: 'insufficient_players', message: 'Game requires at least one hider' } };
    }
    if (seekerCount < 1) {
      return { status: 400, body: { error: 'insufficient_players', message: 'Game requires at least one seeker' } };
    }
  }

  const hidingDurationMs = hidingDurationMin != null ? hidingDurationMin * 60_000 : undefined;
  notifyGameStart({ gameId, scale, hidingDurationMs, seekingDurationMs: hidingDurationMs }, gameServerUrl, fetchFn);
  return { status: 204, body: {} };
}

/** Return a copy of the in-process game store (for testing). */
export function _getStore() {
  return new Map(_games);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _games.clear();
}
