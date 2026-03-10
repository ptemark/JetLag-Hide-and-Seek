import { createPool, createTables } from '../db/db.js';
import { submitScore } from '../functions/scores.js';

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
  try {
    const pool = ensurePool();
    if (_tablesReady) await _tablesReady;
    const result = await submitScore({ method: req.method, body: req.body }, pool);
    res.status(result.status).json(result.body);
  } catch (_err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
