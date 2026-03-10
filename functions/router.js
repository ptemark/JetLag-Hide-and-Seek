/**
 * router.js — Minimal HTTP adapter for serverless function handlers.
 *
 * Parses an incoming Node.js http.IncomingMessage, routes it to the
 * appropriate handler, and writes the response.
 *
 * Rate limiting: each client (identified by X-Forwarded-For or socket IP) is
 * limited to 100 requests per 60-second window. Exceeding the limit returns
 * 429 Too Many Requests with Retry-After and X-RateLimit-Remaining headers.
 *
 * Error handling: unhandled exceptions thrown by route handlers are caught and
 * returned as 500 Internal Server Error, preventing raw stack traces from
 * leaking to clients.
 *
 * Route table:
 *   POST   /players              → registerPlayer
 *   GET    /games/:id            → getGame
 *   POST   /scores               → submitScore
 *   POST   /sessions             → initiateSession
 *   DELETE /sessions/:sessionId  → terminateSession
 *   GET    /live/:gameId         → getLiveState
 *   GET    /admin                → getAdminStatus
 */

import { registerPlayer } from './players.js';
import { getGame } from './games.js';
import { submitScore } from './scores.js';
import { initiateSession, terminateSession } from './sessions.js';
import { getLiveState } from './liveState.js';
import { getAdminStatus } from './admin.js';
import { defaultLimiter } from './rateLimiter.js';

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
 * HTTP methods that never carry a request body.
 * Skipping readBody for these methods eliminates stream overhead and reduces
 * execution time, lowering serverless invocation costs.
 */
const BODYLESS_METHODS = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);

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
  { method: 'GET',    pattern: /^\/admin$/, handler: getAdminStatus },
];

/**
 * Extract the client IP from an incoming request for rate-limit keying.
 * Prefers the leftmost address in X-Forwarded-For (set by reverse proxies).
 * Falls back to the socket's remote address.
 *
 * @param {import('node:http').IncomingMessage} httpReq
 * @returns {string}
 */
function clientKey(httpReq) {
  const forwarded = httpReq.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return httpReq.socket?.remoteAddress ?? 'unknown';
}

/**
 * Handle an incoming HTTP request by routing it to the correct handler.
 *
 * @param {import('node:http').IncomingMessage} httpReq
 * @param {import('node:http').ServerResponse} httpRes
 * @param {object} [opts]
 * @param {{ check: (key: string) => { allowed: boolean, remaining: number, resetAtMs: number } }} [opts.limiter]
 *   Rate-limiter instance.  Defaults to the shared defaultLimiter.
 */
export async function handleRequest(httpReq, httpRes, opts = {}) {
  const limiter = opts.limiter ?? defaultLimiter;

  // --- Rate limiting ---
  const key = clientKey(httpReq);
  const rateResult = limiter.check(key);
  if (!rateResult.allowed) {
    const retryAfterSec = Math.ceil((rateResult.resetAtMs - Date.now()) / 1000);
    httpRes.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(retryAfterSec, 1)),
      'X-RateLimit-Remaining': '0',
    });
    httpRes.end(JSON.stringify({ error: 'Too Many Requests' }));
    return;
  }

  const method = httpReq.method ?? 'GET';
  const urlPath = new URL(httpReq.url ?? '/', `http://${httpReq.headers?.host ?? 'localhost'}`).pathname;

  // --- Parse body (POST / PUT / PATCH only) ---
  // GET, DELETE, HEAD, and OPTIONS requests never carry a body; skipping
  // readBody avoids attaching stream listeners and waiting for an 'end' event
  // that would otherwise add latency to every read request.
  let body = null;
  if (!BODYLESS_METHODS.has(method)) {
    try {
      body = await readBody(httpReq);
    } catch {
      httpRes.writeHead(400, { 'Content-Type': 'application/json' });
      httpRes.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
  }

  // --- Route ---
  for (const route of ROUTES) {
    const match = urlPath.match(route.pattern);
    if (match && method === route.method) {
      const req = { method, path: urlPath, params: match.groups ?? {}, body, headers: httpReq.headers ?? {} };
      let result;
      try {
        result = await route.handler(req);
      } catch {
        httpRes.writeHead(500, { 'Content-Type': 'application/json' });
        httpRes.end(JSON.stringify({ error: 'Internal Server Error' }));
        return;
      }
      httpRes.writeHead(result.status, { 'Content-Type': 'application/json' });
      httpRes.end(JSON.stringify(result.body));
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
