import { registerPlayer }             from '../functions/players.js';
import { handleCreateGame, joinGame } from '../functions/games.js';
import { lockHiderZone }              from '../functions/gameZone.js';
import { submitQuestion }             from '../functions/questions.js';

/**
 * Create a player via the real registerPlayer handler.
 *
 * @param {import('pg').Pool} pool
 * @param {{ name?: string, role?: string }} [opts]
 * @returns {Promise<{ playerId: string, name: string, role: string, createdAt: string }>}
 */
export async function makePlayer(pool, { name = 'Test Player', role = 'hider' } = {}) {
  const res = await registerPlayer({ method: 'POST', body: { name, role } }, pool);
  if (res.status !== 201) throw new Error(`makePlayer failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Create a game via the real handleCreateGame handler.
 * Note: response field is `gameId`, not `id`.
 *
 * @param {import('pg').Pool} pool
 * @param {{ size?: string, seekerTeams?: number, playerId?: string|null }} [opts]
 * @returns {Promise<{ gameId: string, [key: string]: unknown }>}
 */
export async function makeGame(pool, { size = 'medium', seekerTeams = 0, playerId = null } = {}) {
  const res = await handleCreateGame(
    { method: 'POST', body: { size, bounds: {}, seekerTeams, playerId } },
    pool,
  );
  if (res.status !== 201) throw new Error(`makeGame failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Join a game via the real joinGame handler.
 * Note: joinGame with pool returns 200, not 201.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @param {string} playerId
 * @param {string} role  'hider' | 'seeker'
 * @param {number|null} [team]
 * @returns {Promise<unknown>}
 */
export async function makeJoin(pool, gameId, playerId, role, team = null) {
  const res = await joinGame(
    { method: 'POST', params: { gameId }, body: { playerId, role, team } },
    pool,
  );
  if (res.status !== 200) throw new Error(`makeJoin failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Lock a hider zone via the real lockHiderZone handler.
 * Passes '' and null to suppress managed-server fire-and-forget HTTP call.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @param {{ stationId?: string, lat?: number, lon?: number, radiusM?: number, playerId?: string|null }} [opts]
 * @returns {Promise<unknown>}
 */
export async function makeZone(pool, gameId, opts = {}) {
  const res = await lockHiderZone(
    {
      method: 'POST',
      params: { gameId },
      body: {
        stationId: opts.stationId ?? 'test-station-1',
        lat:       opts.lat      ?? 51.5,
        lon:       opts.lon      ?? -0.1,
        radiusM:   opts.radiusM  ?? 200,
        playerId:  opts.playerId ?? null,
      },
    },
    pool, '', null,
  );
  if (res.status !== 201) throw new Error(`makeZone failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Submit a question via the real submitQuestion handler.
 * Passes '', null, null to suppress managed-server notification and skip admin checks.
 * Note: fetchFn comes BEFORE adminApiKey in the handler signature.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, askerId: string, targetId: string, category?: string }} opts
 * @returns {Promise<unknown>}
 */
export async function makeQuestion(pool, { gameId, askerId, targetId, category = 'thermometer' } = {}) {
  const res = await submitQuestion(
    { method: 'POST', body: { gameId, askerId, targetId, category, text: 'Test question' } },
    pool, '', null, null, // gameServerUrl, fetchFn, adminApiKey
  );
  if (res.status !== 201) throw new Error(`makeQuestion failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}
