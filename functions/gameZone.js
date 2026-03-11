/**
 * gameZone.js — Serverless handler for hider zone selection.
 *
 * Route:
 *   POST /games/:gameId/zone
 *   Body: { stationId, lat, lon, radiusM, playerId }
 *
 * Persists the chosen hiding zone to the `game_zones` table and notifies the
 * managed game server via POST /internal/notify so it can:
 *   1. Call GameStateManager.setGameZones() with the chosen zone.
 *   2. Broadcast a `zone_locked` WebSocket event to all players in the game.
 *
 * The notification is fire-and-forget — a network failure to reach the managed
 * server does NOT fail the HTTP response (the zone is already persisted in DB).
 *
 * Falls back to an in-process Map when no pg Pool is provided (local dev / tests).
 */

import { dbSetGameZone } from '../db/gameStore.js';

// ── In-process fallback store (no DB pool) ────────────────────────────────────

const _zones = new Map(); // gameId → zone object

/** Return a copy of the in-process zone store (for testing). */
export function _getZoneStore() { return new Map(_zones); }

/** Clear the in-process store (for test isolation). */
export function _clearZoneStore() { _zones.clear(); }

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * POST /games/:gameId/zone
 * Body: { stationId, lat, lon, radiusM, playerId }
 *
 * @param {{ method: string, params: { gameId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]   Override for GAME_SERVER_URL env var.
 * @param {typeof fetch} [fetchFn]   Injectable fetch (tests / local dev).
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function lockHiderZone(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { gameId } = req.params ?? {};
  if (!gameId || typeof gameId !== 'string') {
    return { status: 400, body: { error: 'gameId param is required' } };
  }

  const { stationId, lat, lon, radiusM, playerId } = req.body ?? {};

  if (!stationId || typeof stationId !== 'string') {
    return { status: 400, body: { error: 'stationId is required' } };
  }
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { status: 400, body: { error: 'lat and lon must be numbers' } };
  }
  if (typeof radiusM !== 'number' || radiusM <= 0) {
    return { status: 400, body: { error: 'radiusM must be a positive number' } };
  }

  let zone;

  if (pool) {
    zone = await dbSetGameZone(pool, { gameId, stationId, lat, lon, radiusM });
  } else {
    // In-process fallback
    zone = {
      zoneId:    `zone-${gameId}`,
      gameId,
      stationId,
      lat,
      lon,
      radiusM,
      lockedAt: new Date().toISOString(),
    };
    _zones.set(gameId, zone);
  }

  // Fire-and-forget: tell the managed server to update in-memory zones and broadcast.
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
    // 1. Update the game server's in-memory zone list via the existing /internal/games/:gameId/zones endpoint.
    fetchFn(`${serverUrl}/internal/games/${encodeURIComponent(gameId)}/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zones: [{ stationId, lat, lon, radiusM }],
      }),
    }).catch(() => { /* intentionally silent */ });

    // 2. Broadcast zone_locked event to all connected players.
    fetchFn(`${serverUrl}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'zone_locked',
        gameId,
        zone: { stationId, lat, lon, radiusM },
        lockedBy: playerId ?? null,
      }),
    }).catch(() => { /* intentionally silent */ });
  }

  return { status: 201, body: zone };
}
