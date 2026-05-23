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
      // Transient migration failure (Neon waking from pause, FK race on cold
      // start). Reset `_tablesReady` so the next request retries the
      // migration, but keep `_pool` alive — the pool itself is healthy and
      // tables almost certainly already exist from a prior cold start.
      // Nulling the pool here would silently fall back to the in-process
      // store, which is EMPTY on this Lambda instance and inconsistent
      // across instances, causing UI counts to flicker between real values
      // and zero (Task 200).
      console.error('[api] createTables failed — will retry on next request:', err.message);
      _tablesReady = null;
    }
  }

  // Strip /api prefix so the router sees /players instead of /api/players
  req.url = req.url.replace(/^\/api/, '') || '/';
  return handleRequest(req, res, { pool: _pool });
}
