/**
 * api.js — Frontend API client for JetLag: The Game.
 *
 * Thin wrappers around fetch for all serverless endpoints consumed by the SPA.
 * BASE_URL defaults to same-origin (Vercel rewrites /api/* to serverless fns).
 */

export const BASE_URL = '';

/**
 * Register a new player.
 * POST /api/players  { name, role }  → { playerId, name, role, createdAt }
 *
 * @param {{ name: string, role: 'hider'|'seeker' }} options
 * @returns {Promise<{ playerId: string, name: string, role: string, createdAt: string }>}
 */
export async function registerPlayer({ name, role }) {
  const res = await fetch(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role }),
  });
  if (!res.ok) throw new Error(`registerPlayer failed: ${res.status}`);
  return res.json();
}

/**
 * Create a new game.
 * POST /api/games  { size, bounds }  → { gameId, size, status, ... }
 *
 * @param {{ size: 'small'|'medium'|'large', bounds: object }} options
 * @returns {Promise<{ gameId: string, size: string, status: string }>}
 */
export async function createGame({ size, bounds }) {
  const res = await fetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size, bounds }),
  });
  if (!res.ok) throw new Error(`createGame failed: ${res.status}`);
  return res.json();
}

/**
 * Look up an existing game by ID.
 * GET /api/games/:id  → { gameId, size, status, ... }
 *
 * @param {string} gameId
 * @returns {Promise<{ gameId: string, size: string, status: string }>}
 */
export async function lookupGame(gameId) {
  const res = await fetch(`${BASE_URL}/api/games/${encodeURIComponent(gameId)}`);
  if (!res.ok) throw new Error(`lookupGame failed: ${res.status}`);
  return res.json();
}
