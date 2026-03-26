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
import { dbCreateGame, dbGetGame, dbGetGamePlayerCounts, dbGetGameZone, dbCleanupStaleGames, dbJoinGame } from '../db/gameStore.js';
import { checkAdminAuth } from './auth.js';
import { SCALE_DURATION_RANGES } from '../config/gameRules.js';
export { SCALE_DURATION_RANGES };

export const VALID_SIZES = Object.freeze(['small', 'medium', 'large']);
export const VALID_STATUSES = Object.freeze(['waiting', 'hiding', 'seeking', 'finished']);
// Player roles — duplicated here so callers can import from one module.
export const VALID_ROLES = Object.freeze(['hider', 'seeker']);

// In-process store — used when no DB pool is provided (tests / local dev).
const _games = new Map();

// In-process game-players store.  Maps gameId → Map<playerId, { role, team }>.
const _gamePlayers = new Map();

// In-process ready store.  Maps gameId → Set<playerId>.
const _readyPlayers = new Map();

/**
 * Create a new game.
 *
 * When `pool` is supplied the game is persisted to the database and a
 * Promise is returned.  Without a pool the operation is synchronous and
 * uses the in-process Map.
 *
 * @param {{ size?: string, bounds?: object, seekerTeams?: number, hostPlayerId?: string|null }} options
 * @param {import('pg').Pool|null} [pool]
 * @returns {object | Promise<object>} game record
 */
export function createGame({ size = 'medium', bounds = {}, seekerTeams = 0, hostPlayerId = null } = {}, pool = null) {
  if (!VALID_SIZES.includes(size)) {
    throw new Error(`size must be one of: ${VALID_SIZES.join(', ')}`);
  }
  if (seekerTeams !== 0 && seekerTeams !== 2) {
    throw new Error('seekerTeams must be 0 (disabled) or 2');
  }

  if (pool) {
    return dbCreateGame(pool, { size, bounds, seekerTeams, hostPlayerId });
  }

  const game = {
    gameId: randomUUID(),
    size,
    status: 'waiting',
    seekerTeams,
    hostPlayerId,
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
 * Uses async/await so that rejections from the DB path (e.g. Neon cold-start,
 * FK constraint because host_player_id is not yet in the players table) are
 * caught and returned as a structured 400/500 response rather than propagating
 * as an unhandled rejection to the router's generic 500 handler.
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleCreateGame(req, pool = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { size = 'medium', bounds = {}, seekerTeams = 0, playerId = null } = req.body ?? {};

  try {
    const game = await createGame({ size, bounds, seekerTeams, hostPlayerId: playerId }, pool);
    return { status: 201, body: game };
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
}

/**
 * Notify the managed server to begin the hiding phase for a game.
 * Returns a resolved Promise when no server URL is configured (local dev).
 * Throws if the fetch fails or the server returns a non-2xx status.
 *
 * @param {{ gameId: string, scale?: string, hidingDurationMs?: number, seekingDurationMs?: number }} options
 * @param {string|undefined} gameServerUrl
 * @param {typeof fetch} fetchFn
 * @returns {Promise<void>}
 */
async function notifyGameStart({ gameId, scale, hidingDurationMs, seekingDurationMs }, gameServerUrl, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (!serverUrl || !fetchFn) {
    return;
  }

  const payload = { scale };
  if (hidingDurationMs != null) payload.hidingDurationMs = hidingDurationMs;
  if (seekingDurationMs != null) payload.seekingDurationMs = seekingDurationMs;

  const response = await fetchFn(
    `${serverUrl}/internal/games/${encodeURIComponent(gameId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`game server responded with ${response.status}`);
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

  // When a DB pool is available, validate minimum player requirements and hider
  // zone before notifying the managed server. Without a pool the server performs
  // its own checks.
  if (pool) {
    const { hiderCount, seekerCount } = await dbGetGamePlayerCounts(pool, gameId);
    if (hiderCount < 1) {
      return { status: 400, body: { error: 'insufficient_players', message: 'Game requires at least one hider' } };
    }
    if (seekerCount < 1) {
      return { status: 400, body: { error: 'insufficient_players', message: 'Game requires at least one seeker' } };
    }
    const zone = await dbGetGameZone(pool, gameId);
    if (!zone) {
      return { status: 400, body: { error: 'no_hider_zone', message: 'Hider has not selected a hiding zone' } };
    }
  }

  const hidingDurationMs = hidingDurationMin != null ? hidingDurationMin * 60_000 : undefined;

  try {
    await notifyGameStart({ gameId, scale, hidingDurationMs, seekingDurationMs: hidingDurationMs }, gameServerUrl, fetchFn);
  } catch {
    return { status: 503, body: { error: 'game_server_unavailable', message: 'Game server could not be reached. Please try again.' } };
  }

  return { status: 204, body: {} };
}

/**
 * HTTP handler: delete waiting games older than maxAgeHours.
 *
 * POST /games/cleanup  { maxAgeHours?: number }  → 200 { deletedCount }
 *
 * Requires a valid admin Bearer token (ADMIN_API_KEY env var).
 * Without a DB pool, returns { deletedCount: 0 }.
 *
 * @param {{ method: string, headers?: Record<string, string>, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [adminApiKey]  Override for ADMIN_API_KEY env var.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function cleanupStaleGames(req, pool = null, adminApiKey) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const key = adminApiKey !== undefined
    ? adminApiKey
    : (typeof process !== 'undefined' ? process.env.ADMIN_API_KEY : '') ?? '';

  const authResult = checkAdminAuth(req.headers ?? {}, key);
  if (!authResult.ok) {
    return { status: authResult.status, body: { error: authResult.error } };
  }

  const { maxAgeHours = 24 } = req.body ?? {};
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  if (pool) {
    const result = await dbCleanupStaleGames(pool, maxAgeMs);
    return { status: 200, body: result };
  }

  return { status: 200, body: { deletedCount: 0 } };
}

/**
 * Record a player joining a game.
 *
 * POST /games/:gameId/join  { playerId, role, team? }  → { gameId, playerId, role, team }
 *
 * Idempotent — calling it twice for the same (gameId, playerId) pair returns
 * the existing record rather than an error.
 *
 * @param {{ params: { gameId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function joinGame(req, pool = null) {
  const { gameId } = req.params ?? {};
  const { playerId, role, team = null } = req.body ?? {};

  if (!playerId || typeof playerId !== 'string' || playerId.trim().length === 0) {
    return { status: 400, body: { error: 'playerId is required' } };
  }
  if (!VALID_ROLES.includes(role)) {
    return { status: 400, body: { error: `role must be one of: ${VALID_ROLES.join(', ')}` } };
  }

  if (pool) {
    return dbJoinGame(pool, { gameId, playerId, role, team }).then(result => ({
      status: 200,
      body: result,
    }));
  }

  // In-process path.
  if (!_gamePlayers.has(gameId)) {
    _gamePlayers.set(gameId, new Map());
  }
  const existing = _gamePlayers.get(gameId).get(playerId);
  if (existing) {
    return { status: 200, body: { gameId, playerId, ...existing } };
  }
  const entry = { role, team };
  _gamePlayers.get(gameId).set(playerId, entry);
  return { status: 200, body: { gameId, playerId, role, team } };
}

/** Return a copy of the in-process game store (for testing). */
export function _getStore() {
  return new Map(_games);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _games.clear();
}

/** Return a copy of the in-process game-players store (for testing). */
export function _getGamePlayers() {
  return new Map(_gamePlayers);
}

/** Clear the in-process game-players store (for test isolation). */
export function _clearGamePlayers() {
  _gamePlayers.clear();
}

/**
 * Mark a player as ready or not ready in the WaitingRoom.
 *
 * Implements RULES.md §Setup — "All players begin at a common starting point."
 * Players tap Ready to confirm they have gathered before the host starts.
 * This is soft enforcement: the host can still start at any time.
 *
 * POST /games/:gameId/ready  { playerId, ready: boolean }
 *   → { readyCount: number, totalCount: number }
 *
 * @param {{ params: { gameId: string }, body: { playerId?: string, ready?: boolean } }} req
 * @param {import('pg').Pool|null} [pool]
 */
export function markReady(req, pool = null) {
  const { gameId } = req.params ?? {};
  const { playerId, ready = true } = req.body ?? {};
  if (!gameId)   return { status: 400, body: { error: 'gameId is required' } };
  if (!playerId) return { status: 400, body: { error: 'playerId is required' } };

  if (!_readyPlayers.has(gameId)) _readyPlayers.set(gameId, new Set());
  const readySet = _readyPlayers.get(gameId);
  if (ready) {
    readySet.add(playerId);
  } else {
    readySet.delete(playerId);
  }

  const readyCount  = readySet.size;
  const totalCount  = _gamePlayers.get(gameId)?.size ?? 0;
  return { status: 200, body: { readyCount, totalCount } };
}

/**
 * Return current ready status for a game.
 *
 * GET /games/:gameId/ready
 *   → { readyCount: number, totalCount: number }
 *
 * @param {{ params: { gameId: string } }} req
 * @param {import('pg').Pool|null} [pool]
 */
export function getReadyStatus(req, pool = null) {
  const { gameId } = req.params ?? {};
  if (!gameId) return { status: 400, body: { error: 'gameId is required' } };

  const readyCount = _readyPlayers.get(gameId)?.size ?? 0;
  const totalCount = _gamePlayers.get(gameId)?.size ?? 0;
  return { status: 200, body: { readyCount, totalCount } };
}

/** Return a copy of the in-process ready-players store (for testing). */
export function _getReadyPlayers() {
  return new Map(_readyPlayers);
}

/** Clear the in-process ready-players store (for test isolation). */
export function _clearReadyPlayers() {
  _readyPlayers.clear();
}
