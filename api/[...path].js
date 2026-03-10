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
  const pool = ensurePool();
  if (_tablesReady) await _tablesReady;

  // Strip /api prefix so the router sees /players instead of /api/players
  req.url = req.url.replace(/^\/api/, '') || '/';

  return handleRequest(req, res, { pool });
}
