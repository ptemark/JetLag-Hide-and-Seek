/**
 * Catch-all Vercel serverless function.
 *
 * Routes all /api/* requests through the existing router, keeping the
 * deployment within Vercel Hobby's 12-function limit (this counts as 1).
 *
 * DB pool is created lazily on the first request and reused across warm
 * invocations. Tables are created idempotently on cold start.
 */
import { createPool, createTables } from '../db/db.js';
import { handleRequest } from '../functions/router.js';

let _pool = null;
let _tablesReady = null;

function ensurePool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = createPool(process.env.DATABASE_URL);
    _tablesReady = createTables(_pool);
  }
  return _pool;
}

/**
 * Fire-and-forget: write a row to _request_log.
 * Never throws — logging failures must not affect the response.
 */
function logRequest(pool, { method, rawUrl, strippedUrl, statusCode, route }) {
  if (!pool) return;
  pool.query(
    `INSERT INTO _request_log (method, raw_url, stripped_url, status_code, route)
     VALUES ($1, $2, $3, $4, $5)`,
    [method, rawUrl, strippedUrl, statusCode, route ?? null],
  ).catch((err) => console.error('[api] logRequest failed:', err.message));
}

export default async function handler(req, res) {
  ensurePool();
  if (_tablesReady) {
    try {
      await _tablesReady;
    } catch (err) {
      // DB unavailable (e.g. Neon waking from pause, transient connection error).
      // Reset so the next request retries table setup rather than re-throwing
      // the same cached rejection forever across warm Lambda invocations.
      console.error('[api] createTables failed — resetting pool:', err.message);
      _pool = null;
      _tablesReady = null;
    }
  }

  const rawUrl = req.url;

  // Strip /api prefix so the router sees /players instead of /api/players
  req.url = req.url.replace(/^\/api/, '') || '/';
  const strippedUrl = req.url;

  // Intercept writeHead to capture the status code for logging.
  let statusCode = 200;
  let matchedRoute = null;
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (code, headers) => {
    statusCode = code;
    return origWriteHead(code, headers);
  };

  console.log(`[api] ${req.method} raw=${rawUrl} stripped=${strippedUrl}`);

  try {
    return await handleRequest(req, res, { pool: _pool, onRouteMatched: (r) => { matchedRoute = r; } });
  } finally {
    console.log(`[api] ${req.method} ${strippedUrl} → ${statusCode} route=${matchedRoute ?? 'none'}`);
    logRequest(_pool, {
      method: req.method ?? 'UNKNOWN',
      rawUrl,
      strippedUrl,
      statusCode,
      route: matchedRoute,
    });
  }
}
