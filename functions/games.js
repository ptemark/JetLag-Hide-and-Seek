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
import { dbCreateGame, dbGetGame, dbGetGamePlayerCounts, dbCleanupStaleGames, dbJoinGame, dbSetReady, dbGetReadyCounts, dbUpdateGameStatus } from '../db/gameStore.js';
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

  if (!VALID_SIZES.includes(size)) {
    return { status: 400, body: { error: `size must be one of: ${VALID_SIZES.join(', ')}` } };
  }
  if (seekerTeams !== 0 && seekerTeams !== 2) {
    return { status: 400, body: { error: 'seekerTeams must be 0 (disabled) or 2' } };
  }

  try {
    const game = await createGame({ size, bounds, seekerTeams, hostPlayerId: playerId }, pool);
    return { status: 201, body: game };
  } catch {
    return { status: 500, body: { error: 'Internal Server Error' } };
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

  // When a DB pool is available, validate minimum player requirements before
  // notifying the managed server. Without a pool the server performs its own
  // checks. Hider zone selection happens AFTER start during the hiding phase
  // (RULES.md §Hiding Rules rule 2; DESIGN.md §19a "No pre-start hider-zone
  // requirement").
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

  try {
    await notifyGameStart({ gameId, scale, hidingDurationMs, seekingDurationMs: hidingDurationMs }, gameServerUrl, fetchFn);
  } catch {
    return { status: 503, body: { error: 'game_server_unavailable', message: 'Game server could not be reached. Please try again.' } };
  }

  // Authoritatively flip status to 'hiding' in Postgres from the serverless
  // layer so the non-host's 3 s WaitingRoom poll (GET /api/games/:id) sees
  // the transition regardless of whether the managed server's onPhaseChange
  // write succeeded. The managed server's write is still attempted in
  // parallel (defence in depth) and is idempotent — hiding → hiding is a
  // no-op UPDATE. Without this serverless write, a managed server whose
  // `store` is null (e.g. DATABASE_URL missing in the Docker runtime env)
  // leaves DB.status='waiting' forever and the hider stays stuck on the
  // lobby. See DESIGN.md §19a "Authority of games.status".
  if (pool) {
    try {
      await dbUpdateGameStatus(pool, { gameId, status: 'hiding' });
    } catch {
      // Swallowing here is intentional: the managed server has already
      // accepted the start and is broadcasting WS phase_change to the
      // host. Returning 500 to the host now would be misleading. The
      // managed server's own write will still attempt the flip; the
      // non-host poll will retry every 3 s and pick it up if either
      // write eventually succeeds.
    }
  }

  return { status: 204, body: {} };
}

/**
 * Notify the managed server to stop a game and broadcast a cancellation
 * to all connected players. Fire-and-forget; the response is immediate.
 *
 * @param {{ gameId: string }} options
 * @param {string|undefined} gameServerUrl
 * @param {typeof fetch} fetchFn
 * @returns {Promise<void>}
 */
async function notifyGameCancel({ gameId }, gameServerUrl, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (!serverUrl || !fetchFn) return;
  await fetchFn(
    `${serverUrl}/internal/games/${encodeURIComponent(gameId)}/cancel`,
    { method: 'POST' },
  );
}

/**
 * HTTP handler: host-initiated cancel of an ongoing game.
 *
 * POST /games/:gameId/cancel  { playerId }  → 204
 *
 * Only the host (game.hostPlayerId === playerId) may cancel. The handler
 * writes status='finished' to Postgres so non-host pollers see the change
 * and (best-effort) notifies the managed server to stop the game loop and
 * broadcast a `game_cancelled` WS message to connected clients.
 *
 * Without a pool, returns 204 — no DB to update; this path is exercised
 * only by unit tests and local dev.
 *
 * @param {{ method: string, params: { gameId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleCancelGame(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method Not Allowed' } };

  const { gameId } = req.params ?? {};
  const { playerId } = req.body ?? {};
  if (!gameId)   return { status: 400, body: { error: 'gameId is required' } };
  if (!playerId) return { status: 400, body: { error: 'playerId is required' } };

  if (!pool) {
    // No DB: nothing to persist; let the managed-server notify happen if wired.
    await notifyGameCancel({ gameId }, gameServerUrl, fetchFn).catch(() => {});
    return { status: 204, body: {} };
  }

  const game = await dbGetGame(pool, gameId);
  if (!game) return { status: 404, body: { error: 'game not found' } };
  if (game.hostPlayerId !== playerId) {
    return { status: 403, body: { error: 'only_host_can_cancel', message: 'Only the game host can cancel.' } };
  }

  await dbUpdateGameStatus(pool, { gameId, status: 'finished' });

  // Notify managed server (best-effort): broadcast WS cancel + stop loop.
  // We deliberately don't fail the request if the managed server is down —
  // the DB status flip is enough for non-host pollers to exit the lobby /
  // GameMap, and the loop's auto-shutdown handles eventual cleanup.
  await notifyGameCancel({ gameId }, gameServerUrl, fetchFn).catch(() => {});

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
 * When a pg pool is provided the ready state is persisted to the
 * `game_ready_players` table (Task 192) so it survives serverless cold
 * starts and is consistent across Lambda instances.  Without a pool the
 * in-process Map is used (tests / local dev).
 *
 * @param {{ params: { gameId: string }, body: { playerId?: string, ready?: boolean } }} req
 * @param {import('pg').Pool|null} [pool]
 */
export async function markReady(req, pool = null) {
  const { gameId } = req.params ?? {};
  const { playerId, ready = true } = req.body ?? {};
  if (!gameId)   return { status: 400, body: { error: 'gameId is required' } };
  if (!playerId) return { status: 400, body: { error: 'playerId is required' } };

  if (pool) {
    await dbSetReady(pool, { gameId, playerId, ready: !!ready });
    const counts = await dbGetReadyCounts(pool, gameId);
    return { status: 200, body: counts };
  }

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
export async function getReadyStatus(req, pool = null) {
  const { gameId } = req.params ?? {};
  if (!gameId) return { status: 400, body: { error: 'gameId is required' } };

  if (pool) {
    const counts = await dbGetReadyCounts(pool, gameId);
    return { status: 200, body: counts };
  }

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
