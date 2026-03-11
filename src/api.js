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

/**
 * Submit a question from a seeker to a hider.
 * POST /api/questions  { gameId, askerId, targetId, category, text }
 *   → { questionId, gameId, askerId, targetId, category, text, status, createdAt }
 *
 * @param {{ gameId: string, askerId: string, targetId: string, category: string, text: string }} options
 */
export async function submitQuestion({ gameId, askerId, targetId, category, text }) {
  const res = await fetch(`${BASE_URL}/api/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, askerId, targetId, category, text }),
  });
  if (!res.ok) throw new Error(`submitQuestion failed: ${res.status}`);
  return res.json();
}

/**
 * List all questions addressed to a player (hider's inbox).
 * GET /api/questions?playerId=  → { playerId, questions: [...] }
 *
 * @param {string} playerId
 */
export async function listQuestions(playerId) {
  const res = await fetch(`${BASE_URL}/api/questions?playerId=${encodeURIComponent(playerId)}`);
  if (!res.ok) throw new Error(`listQuestions failed: ${res.status}`);
  return res.json();
}

/**
 * Submit an answer to a question.
 * POST /api/answers/:questionId  { responderId, text }
 *   → { answerId, questionId, responderId, text, createdAt }
 *
 * @param {{ questionId: string, responderId: string, text: string }} options
 */
export async function submitAnswer({ questionId, responderId, text }) {
  const res = await fetch(`${BASE_URL}/api/answers/${encodeURIComponent(questionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ responderId, text }),
  });
  if (!res.ok) throw new Error(`submitAnswer failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch the hider's current card hand.
 * GET /api/cards?gameId=&playerId=  → { gameId, playerId, hand: [...] }
 *
 * @param {{ gameId: string, playerId: string }} options
 */
export async function fetchCards({ gameId, playerId }) {
  const params = new URLSearchParams({ gameId, playerId });
  const res = await fetch(`${BASE_URL}/api/cards?${params}`);
  if (!res.ok) throw new Error(`fetchCards failed: ${res.status}`);
  return res.json();
}

/**
 * Play a card from the hider's hand.
 * POST /api/cards/:cardId/play  { playerId }  → card object with effect
 *
 * @param {{ cardId: string, playerId: string }} options
 */
export async function playCardApi({ cardId, playerId }) {
  const res = await fetch(`${BASE_URL}/api/cards/${encodeURIComponent(cardId)}/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error(`playCard failed: ${res.status}`);
  return res.json();
}

/**
 * Lock the hider's chosen hiding zone for a game.
 * POST /api/games/:gameId/zone  { stationId, lat, lon, radiusM, playerId }
 *   → { zoneId, gameId, stationId, lat, lon, radiusM, lockedAt }
 *
 * @param {{ gameId: string, stationId: string, lat: number, lon: number, radiusM: number, playerId: string }} options
 */
export async function lockZone({ gameId, stationId, lat, lon, radiusM, playerId }) {
  const res = await fetch(`${BASE_URL}/api/games/${encodeURIComponent(gameId)}/zone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stationId, lat, lon, radiusM, playerId }),
  });
  if (!res.ok) throw new Error(`lockZone failed: ${res.status}`);
  return res.json();
}
