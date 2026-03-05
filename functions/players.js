/**
 * players.js — Serverless handler for player registration.
 *
 * POST /players  { name, role }  → { playerId, name, role, createdAt }
 *
 * Pass a pg Pool as the second argument to persist to the database.
 * Omit the pool (or pass null) to use the in-memory store — useful for
 * same-process unit tests. Real persistence requires a pool.
 */

import { randomUUID } from 'node:crypto';
import { dbCreatePlayer } from '../db/gameStore.js';

export const VALID_ROLES = Object.freeze(['hider', 'seeker']);

// In-process store — used when no DB pool is provided (tests / local dev).
const _players = new Map();

/**
 * Register a new player.
 *
 * When `pool` is supplied the player is persisted to the database and a
 * Promise is returned.  Without a pool the operation is synchronous and
 * uses the in-process Map.
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function registerPlayer(req, pool = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { name, role } = req.body ?? {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { status: 400, body: { error: 'name is required' } };
  }
  if (!VALID_ROLES.includes(role)) {
    return { status: 400, body: { error: `role must be one of: ${VALID_ROLES.join(', ')}` } };
  }

  const trimmedName = name.trim();

  if (pool) {
    return dbCreatePlayer(pool, { name: trimmedName }).then(player => ({
      status: 201,
      body: { ...player, role },
    }));
  }

  const player = {
    playerId: randomUUID(),
    name: trimmedName,
    role,
    createdAt: new Date().toISOString(),
  };

  _players.set(player.playerId, player);
  return { status: 201, body: player };
}

/** Return a copy of the in-process player store (for testing). */
export function _getStore() {
  return new Map(_players);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _players.clear();
}
