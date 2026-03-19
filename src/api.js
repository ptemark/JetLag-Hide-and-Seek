/**
 * api.js — Frontend API client for JetLag: The Game.
 *
 * Thin wrappers around fetch for all serverless endpoints consumed by the SPA.
 * BASE_URL defaults to same-origin (Vercel rewrites /api/* to serverless fns).
 */

export const BASE_URL = '';

/** Abort a fetch if it has not resolved within this duration (DESIGN.md §13). */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Wrapper around fetch that aborts and throws 'Request timed out' if the
 * request does not resolve within FETCH_TIMEOUT_MS.  The abort timer is
 * cleared on both success and failure so no dangling timer is left behind.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timerId);
  }
}

// Export for unit testing only — not part of the public API surface.
export { fetchWithTimeout, FETCH_TIMEOUT_MS };

/**
 * Register a new player.
 * POST /api/players  { name, role }  → { playerId, name, role, createdAt }
 *
 * @param {{ name: string, role: 'hider'|'seeker' }} options
 * @returns {Promise<{ playerId: string, name: string, role: string, createdAt: string }>}
 */
export async function registerPlayer({ name, role }) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role }),
  });
  if (!res.ok) throw new Error(`registerPlayer failed: ${res.status}`);
  return res.json();
}

/**
 * Create a new game.
 * POST /api/games  { size, bounds, seekerTeams?, playerId? }  → { gameId, size, status, seekerTeams, hostPlayerId, ... }
 *
 * @param {{ size: 'small'|'medium'|'large', bounds: object, seekerTeams?: 0|2, playerId?: string }} options
 * @returns {Promise<{ gameId: string, size: string, status: string, seekerTeams: number, hostPlayerId: string|null }>}
 */
export async function createGame({ size, bounds, seekerTeams = 0, playerId = null }) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size, bounds, seekerTeams, playerId }),
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
  const res = await fetchWithTimeout(`${BASE_URL}/api/games/${encodeURIComponent(gameId)}`);
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
  const res = await fetchWithTimeout(`${BASE_URL}/api/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, askerId, targetId, category, text }),
  });
  if (!res.ok) throw new Error(`submitQuestion failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch questions from the server.
 *
 * Pass `{ playerId }` to get the hider's inbox (questions addressed to them).
 * Pass `{ gameId }` to get the full Q&A history for a game (seeker history view).
 *
 * GET /api/questions?playerId=  → { playerId, questions: [...] }
 * GET /api/questions?gameId=    → { gameId,   questions: [...] }
 *
 * @param {{ playerId?: string, gameId?: string, teamId?: string }} options
 */
export async function listQuestions({ playerId, gameId, teamId } = {}) {
  const params = new URLSearchParams();
  if (gameId)        params.append('gameId',   gameId);
  else if (playerId) params.append('playerId', playerId);
  if (teamId)        params.append('teamId',   teamId);
  const res = await fetchWithTimeout(`${BASE_URL}/api/questions?${params}`);
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
  const res = await fetchWithTimeout(`${BASE_URL}/api/answers/${encodeURIComponent(questionId)}`, {
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
  const res = await fetchWithTimeout(`${BASE_URL}/api/cards?${params}`);
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
  const res = await fetchWithTimeout(`${BASE_URL}/api/cards/${encodeURIComponent(cardId)}/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error(`playCard failed: ${res.status}`);
  return res.json();
}

/**
 * Upload a base64-encoded photo for a photo question.
 * POST /api/questions/:questionId/photo  { photoData }
 *   → { photoId, questionId, uploadedAt }
 *
 * @param {{ questionId: string, photoData: string }} options
 */
export async function uploadQuestionPhoto({ questionId, photoData }) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/questions/${encodeURIComponent(questionId)}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoData }),
  });
  if (!res.ok) throw new Error(`uploadQuestionPhoto failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch the photo for a question.
 * GET /api/questions/:questionId/photo
 *   → { photoId, questionId, photoData, uploadedAt }
 *
 * @param {string} questionId
 */
export async function fetchQuestionPhoto(questionId) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/questions/${encodeURIComponent(questionId)}/photo`);
  if (!res.ok) throw new Error(`fetchQuestionPhoto failed: ${res.status}`);
  return res.json();
}

/**
 * Submit a score for a completed game.
 * POST /api/scores  { playerId, gameId, hidingTimeMs, captured, bonusSeconds? }
 *   → { scoreId, playerId, gameId, hidingTimeMs, bonusSeconds, captured, submittedAt }
 *
 * @param {{ playerId: string, gameId: string, hidingTimeMs: number, captured: boolean, bonusSeconds?: number }} options
 */
export async function submitScore({ playerId, gameId, hidingTimeMs, captured, bonusSeconds = 0 }) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, gameId, hidingTimeMs, captured, bonusSeconds }),
  });
  if (!res.ok) throw new Error(`submitScore failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch ranked leaderboard scores with player name and game scale.
 * GET /api/scores?limit=20[&gameId=]
 *   → { scores: [{ rank, playerName, scale, scoreSeconds, bonusSeconds, createdAt }] }
 *
 * @param {{ limit?: number, gameId?: string }} options
 */
export async function fetchLeaderboard({ limit = 20, gameId } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (gameId) params.append('gameId', gameId);
  const res = await fetchWithTimeout(`${BASE_URL}/api/scores?${params}`);
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
  return res.json();
}

/**
 * Start a game's hiding phase via the serverless endpoint.
 * POST /api/games/:gameId/start  { scale, hidingDurationMin? }  → 204
 *
 * The serverless handler notifies the managed game server to call
 * startGame + beginHiding with the correct scale-aware phase durations.
 *
 * `hidingDurationMin` is optional; when provided it overrides the scale default
 * and must fall within the valid range for the chosen scale.
 *
 * @param {{ gameId: string, scale: string, hidingDurationMin?: number }} options
 * @returns {Promise<void>}
 */
export async function startGame({ gameId, scale, hidingDurationMin }) {
  const body = { scale };
  if (hidingDurationMin !== undefined) body.hidingDurationMin = hidingDurationMin;
  const res = await fetchWithTimeout(`${BASE_URL}/api/games/${encodeURIComponent(gameId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { /* ignore parse errors */ }
    throw new Error(body?.message || `startGame failed: ${res.status}`);
  }
}

/**
 * Lock the hider's chosen hiding zone for a game.
 * POST /api/games/:gameId/zone  { stationId, lat, lon, radiusM, playerId }
 *   → { zoneId, gameId, stationId, lat, lon, radiusM, lockedAt }
 *
 * @param {{ gameId: string, stationId: string, lat: number, lon: number, radiusM: number, playerId: string }} options
 */
export async function lockZone({ gameId, stationId, lat, lon, radiusM, playerId }) {
  const res = await fetchWithTimeout(`${BASE_URL}/api/games/${encodeURIComponent(gameId)}/zone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stationId, lat, lon, radiusM, playerId }),
  });
  if (!res.ok) throw new Error(`lockZone failed: ${res.status}`);
  return res.json();
}
