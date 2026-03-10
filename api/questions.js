import { createPool, createTables } from '../db/db.js';
import { submitQuestion, listQuestions } from '../functions/questions.js';

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
    const inner = { method: req.method, body: req.body, query: req.query ?? {} };
    const result = req.method === 'GET'
      ? await listQuestions(inner, pool)
      : await submitQuestion(inner, pool);
    res.status(result.status).json(result.body);
  } catch (_err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
