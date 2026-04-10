import { createPool, createTables } from '../db/db.js';

/**
 * Initialise a database pool and ensure the schema exists.
 * Call once per test suite (beforeAll).
 *
 * @returns {Promise<import('pg').Pool>}
 */
export async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set to run integration tests');
  const pool = createPool(url);
  await createTables(pool);
  return pool;
}

/**
 * Wipe all test data and close the pool.
 * Call once per test suite (afterAll).
 *
 * CASCADE removes all child rows: game_players, questions, answers, cards,
 * game_zones, and scores — no need to order deletes manually.
 *
 * @param {import('pg').Pool} pool
 */
export async function teardown(pool) {
  await pool.query('TRUNCATE games, players CASCADE');
  await pool.end();
}
