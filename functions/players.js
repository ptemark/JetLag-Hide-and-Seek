/**
 * players.js — Serverless handler for player registration.
 *
 * POST /players  { name, role }  → { playerId, name, role, createdAt }
 *
 * Storage is in-memory (placeholder). Task 9–10 will wire this to the DB.
 * Each serverless invocation gets a fresh module scope, so this Map is
 * only useful for same-process unit tests. Real persistence requires DB.
 */

import { randomUUID } from 'node:crypto';

export const VALID_ROLES = Object.freeze(['hider', 'seeker']);

// In-process store — replaced by DB in Task 9.
const _players = new Map();

/**
 * Register a new player.
 *
 * @param {{ method: string, body: unknown }} req
 * @returns {{ status: number, body: object }}
 */
export function registerPlayer(req) {
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

  const player = {
    playerId: randomUUID(),
    name: name.trim(),
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
