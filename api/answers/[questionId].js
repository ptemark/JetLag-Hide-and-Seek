import { createPool, createTables } from '../../db/db.js';
import { submitAnswer } from '../../functions/questions.js';

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
    const questionId = req.query?.questionId ?? '';
    const inner = { method: req.method, params: { questionId }, body: req.body };
    const result = await submitAnswer(inner, pool, process.env.GAME_SERVER_URL);
    res.status(result.status).json(result.body);
  } catch (_err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
