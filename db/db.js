// db.js — Database client module for JetLag: The Game
//
// Wraps the pg Pool so callers never import pg directly.
// All server-side code (functions/ and server/) should use this module.
//
// Usage:
//   import { createPool, createTables } from '../db/db.js';
//   const pool = createPool(process.env.DATABASE_URL);
//   await createTables(pool);   // idempotent — safe to call on every cold start
//
// The browser SPA never imports this module; DATABASE_URL is server-only.

import pkg from 'pg';

const { Pool } = pkg;

/**
 * SQL that creates all JetLag tables if they do not yet exist.
 * Embedded here so callers do not need to read the .sql file at runtime.
 * Must stay in sync with db/schema.sql.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  size        TEXT        NOT NULL
                CHECK (size IN ('small', 'medium', 'large')),
  bounds      JSONB       NOT NULL DEFAULT '{}',
  status      TEXT        NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'hiding', 'seeking', 'finished')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id    UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id  UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('hider', 'seeker')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS scores (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id      UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score_seconds  INTEGER     NOT NULL DEFAULT 0,
  captured_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_questions_game_status ON questions (game_id, status);
CREATE INDEX IF NOT EXISTS idx_questions_game_asker  ON questions (game_id, asker_id);
CREATE INDEX IF NOT EXISTS idx_cards_game_player     ON cards     (game_id, player_id);
CREATE INDEX IF NOT EXISTS idx_scores_game           ON scores    (game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_game     ON game_players (game_id);
`.trim();

/**
 * Creates a pg connection pool for the given Postgres connection string.
 *
 * @param {string} connectionString - postgresql://user:pass@host/db?sslmode=require
 * @returns {import('pg').Pool}
 */
function createPool(connectionString) {
  if (!connectionString) {
    throw new Error('createPool: connectionString is required');
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Runs the schema migration against the given pool.
 * Idempotent — uses CREATE TABLE IF NOT EXISTS throughout.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
async function createTables(pool) {
  await pool.query(SCHEMA_SQL);
}

export { createPool, createTables, SCHEMA_SQL };
