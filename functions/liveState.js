/**
 * liveState.js — Serverless handler for retrieving live game state.
 *
 * GET /live/:gameId → current live state from the managed server or an
 *                     in-process GameStateManager (for tests / local dev).
 *
 * Options accepted as the second argument:
 *   serverUrl {string}           — base URL of the managed server
 *                                  (e.g. "http://game-server:3001").
 *                                  When set the function proxies to
 *                                  GET {serverUrl}/internal/state/:gameId.
 *   gsm       {GameStateManager} — in-process GameStateManager instance.
 *                                  Takes precedence over serverUrl; used for
 *                                  testing and embedded deployments.
 *
 * If neither option is supplied the function returns 503.
 */

/**
 * Get current live state for a game.
 *
 * @param {{ method: string, params: { gameId?: string } }} req
 * @param {{ serverUrl?: string, gsm?: object }} [opts]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function getLiveState(req, opts = {}) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { gameId } = req.params ?? {};
  if (!gameId) {
    return { status: 400, body: { error: 'gameId is required' } };
  }

  const { serverUrl, gsm } = opts;

  // In-process GSM — used for testing and embedded server deployments.
  if (gsm) {
    const state = gsm.getGameState(gameId);
    if (!state) return { status: 404, body: { error: 'game not found' } };
    return { status: 200, body: state };
  }

  // Remote managed server — proxy to its internal HTTP endpoint.
  if (serverUrl) {
    let res;
    try {
      res = await fetch(
        `${serverUrl}/internal/state/${encodeURIComponent(gameId)}`,
      );
    } catch {
      return { status: 503, body: { error: 'managed server unavailable' } };
    }
    if (res.status === 404) return { status: 404, body: { error: 'game not found' } };
    if (!res.ok) return { status: 502, body: { error: 'upstream error' } };
    const body = await res.json();
    return { status: 200, body };
  }

  return { status: 503, body: { error: 'live state unavailable: no server configured' } };
}
