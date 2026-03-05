/**
 * admin.js — Serverless handler for the admin dashboard endpoint.
 *
 * GET /admin → Returns a summary of active sessions, connected players,
 *              and game loop health for the managed server.
 *
 * Authentication: Bearer token required via the Authorization header.
 *   The expected token is read from opts.adminApiKey (defaults to the
 *   ADMIN_API_KEY environment variable). Returns 401 if the token is
 *   missing or wrong; 503 if ADMIN_API_KEY is not configured.
 *
 * Options accepted as the second argument:
 *   adminApiKey {string}     — expected bearer token (default: process.env.ADMIN_API_KEY)
 *   serverUrl   {string}     — base URL of the managed server
 *                              (e.g. "http://game-server:3001").
 *                              Proxies to GET {serverUrl}/internal/admin.
 *   gsm         {object}     — in-process GameStateManager (for testing /
 *                              embedded deployments).
 *   glm         {object}     — in-process GameLoopManager.
 *   wsHandler   {object}     — in-process WsHandler.
 *
 * If all in-process instances (gsm, glm, wsHandler) are provided they take
 * precedence over serverUrl. If neither is configured the handler returns 503.
 */

import { checkAdminAuth } from './auth.js';

/**
 * Retrieve admin dashboard summary.
 *
 * @param {{ method: string, headers?: Record<string, string> }} req
 * @param {{ adminApiKey?: string, serverUrl?: string, gsm?: object, glm?: object, wsHandler?: object }} [opts]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function getAdminStatus(req, opts = {}) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const adminApiKey =
    opts.adminApiKey !== undefined
      ? opts.adminApiKey
      : (typeof process !== 'undefined' ? process.env.ADMIN_API_KEY : '') ?? '';

  const authResult = checkAdminAuth(req.headers ?? {}, adminApiKey);
  if (!authResult.ok) {
    return { status: authResult.status, body: { error: authResult.error } };
  }

  const { serverUrl, gsm, glm, wsHandler } = opts;

  // In-process instances — used for testing and embedded deployments.
  if (gsm && glm && wsHandler) {
    const games = [];
    for (const [gameId] of glm._games) {
      games.push({
        gameId,
        phase: glm.getPhase(gameId),
        phaseElapsedMs: glm.getPhaseElapsed(gameId),
        playerCount: wsHandler.getGamePlayerCount(gameId),
      });
    }
    return {
      status: 200,
      body: {
        connectedPlayers: wsHandler.getConnectedCount(),
        activeGameCount: glm.getActiveGameCount(),
        games,
      },
    };
  }

  // Remote managed server — proxy to its internal HTTP endpoint.
  if (serverUrl) {
    let res;
    try {
      res = await fetch(`${serverUrl}/internal/admin`);
    } catch {
      return { status: 503, body: { error: 'managed server unavailable' } };
    }
    if (!res.ok) return { status: 502, body: { error: 'upstream error' } };
    const body = await res.json();
    return { status: 200, body };
  }

  return { status: 503, body: { error: 'admin status unavailable: no server configured' } };
}
