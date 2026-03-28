/**
 * Catch-all handler for /api/games/* paths.
 * Delegates to the same router as the root catch-all.
 */
import { createPool, createTables } from '../../db/db.js';
import { handleRequest } from '../../functions/router.js';

let _pool = null;
let _tablesReady = null;

function ensurePool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = createPool(process.env.DATABASE_URL);
    _tablesReady = createTables(_pool);
  }
  return _pool;
}

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
      console.error('[api] createTables failed — resetting pool:', err.message);
      _pool = null;
      _tablesReady = null;
    }
  }

  const rawUrl = req.url;
  req.url = req.url.replace(/^\/api/, '') || '/';
  const strippedUrl = req.url;

  let statusCode = 200;
  let matchedRoute = null;
  if (typeof res.writeHead === 'function') {
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (code, headers) => {
      statusCode = code;
      return origWriteHead(code, headers);
    };
  }

  console.log(`[api] ${req.method} raw=${rawUrl} stripped=${strippedUrl}`);

  try {
    return await handleRequest(req, res, { pool: _pool, onRouteMatched: (r) => { matchedRoute = r; } });
  } finally {
    console.log(`[api] ${req.method} ${strippedUrl} → ${statusCode} route=${matchedRoute ?? 'none'}`);
    logRequest(_pool, { method: req.method ?? 'UNKNOWN', rawUrl, strippedUrl, statusCode, route: matchedRoute });
  }
}
