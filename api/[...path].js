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

  // Strip /api prefix so the router sees /players instead of /api/players
  req.url = req.url.replace(/^\/api/, '') || '/';

  return handleRequest(req, res, { pool: _pool });
}
