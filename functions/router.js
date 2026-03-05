/**
 * router.js — Minimal HTTP adapter for serverless function handlers.
 *
 * Parses an incoming Node.js http.IncomingMessage, routes it to the
 * appropriate handler, and writes the response.
 *
 * Route table:
 *   POST   /players              → registerPlayer
 *   GET    /games/:id            → getGame
 *   POST   /scores               → submitScore
 *   POST   /sessions             → initiateSession
 *   DELETE /sessions/:sessionId  → terminateSession
 *   GET    /live/:gameId         → getLiveState
 */

import { registerPlayer } from './players.js';
import { getGame } from './games.js';
import { submitScore } from './scores.js';
import { initiateSession, terminateSession } from './sessions.js';
import { getLiveState } from './liveState.js';

/**
 * Parse the JSON request body from an http.IncomingMessage.
 *
 * @param {import('node:http').IncomingMessage} httpReq
 * @returns {Promise<unknown>}
 */
function readBody(httpReq) {
  return new Promise((resolve, reject) => {
    let raw = '';
    httpReq.on('data', (chunk) => { raw += chunk; });
    httpReq.on('end', () => {
      if (!raw) { resolve(null); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    httpReq.on('error', reject);
  });
}

/**
 * Route patterns: { method, pattern, handler }
 * pattern is a regex; named groups become req.params.
 */
const ROUTES = [
  { method: 'POST',   pattern: /^\/players$/, handler: registerPlayer },
  { method: 'GET',    pattern: /^\/games\/(?<id>[^/]+)$/, handler: getGame },
  { method: 'POST',   pattern: /^\/scores$/, handler: submitScore },
  { method: 'POST',   pattern: /^\/sessions$/, handler: initiateSession },
  { method: 'DELETE', pattern: /^\/sessions\/(?<sessionId>[^/]+)$/, handler: terminateSession },
  { method: 'GET',    pattern: /^\/live\/(?<gameId>[^/]+)$/, handler: getLiveState },
];

/**
 * Handle an incoming HTTP request by routing it to the correct handler.
 *
 * @param {import('node:http').IncomingMessage} httpReq
 * @param {import('node:http').ServerResponse} httpRes
 */
export async function handleRequest(httpReq, httpRes) {
  const method = httpReq.method ?? 'GET';
  const urlPath = new URL(httpReq.url ?? '/', `http://${httpReq.headers?.host ?? 'localhost'}`).pathname;

  let body = null;
  try {
    body = await readBody(httpReq);
  } catch {
    httpRes.writeHead(400, { 'Content-Type': 'application/json' });
    httpRes.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  for (const route of ROUTES) {
    const match = urlPath.match(route.pattern);
    if (match && method === route.method) {
      const req = { method, path: urlPath, params: match.groups ?? {}, body };
      const { status, body: resBody } = await route.handler(req);
      httpRes.writeHead(status, { 'Content-Type': 'application/json' });
      httpRes.end(JSON.stringify(resBody));
      return;
    }
  }

  // Method match without path match → check if path exists for other methods
  const pathExists = ROUTES.some((r) => urlPath.match(r.pattern));
  const statusCode = pathExists ? 405 : 404;
  const errorMsg = pathExists ? 'Method Not Allowed' : 'Not Found';

  httpRes.writeHead(statusCode, { 'Content-Type': 'application/json' });
  httpRes.end(JSON.stringify({ error: errorMsg }));
}
