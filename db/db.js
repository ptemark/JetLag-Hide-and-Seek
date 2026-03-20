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
 *
 * IMPORTANT: this string must be kept in sync with db/schema.sql.
 * Any new table, column, or migration added to schema.sql must also be
 * added here so that Vercel cold-starts create a fully up-to-date schema.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  size          TEXT        NOT NULL
                  CHECK (size IN ('small', 'medium', 'large')),
  bounds        JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'hiding', 'seeking', 'finished')),
  seeker_teams  INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS seeker_teams INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS curse_expires_at TIMESTAMPTZ;
ALTER TABLE games ADD COLUMN IF NOT EXISTS host_player_id UUID REFERENCES players(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS game_players (
  game_id    UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id  UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('hider', 'seeker')),
  team       TEXT        CHECK (team IN ('A', 'B')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, player_id)
);

ALTER TABLE game_players ADD COLUMN IF NOT EXISTS team TEXT CHECK (team IN ('A', 'B'));

CREATE UNIQUE INDEX IF NOT EXISTS game_players_one_hider
  ON game_players (game_id) WHERE role = 'hider';

CREATE TABLE IF NOT EXISTS questions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  asker_id    UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_id   UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL
                CHECK (category IN ('matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle')),
  text        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'answered', 'expired')),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS thermometer_current_distance_m FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS thermometer_previous_distance_m FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tentacle_target_lat FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tentacle_target_lon FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tentacle_radius_km FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tentacle_distance_km FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tentacle_within_radius BOOLEAN;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS measuring_target_lat FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS measuring_target_lon FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS measuring_hider_distance_km FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS measuring_seeker_distance_km FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS measuring_hider_is_closer BOOLEAN;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS transit_nearest_station_name TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS transit_nearest_station_lat FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS transit_nearest_station_lon FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS transit_nearest_station_distance_km FLOAT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS matching_feature_type TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS matching_hider_feature_name TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS matching_seeker_feature_name TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS matching_features_match BOOLEAN;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_category_check;
ALTER TABLE questions ADD CONSTRAINT questions_category_check
  CHECK (category IN ('matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'));

CREATE TABLE IF NOT EXISTS answers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID        NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  responder_id UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id   UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL
                CHECK (type IN ('time_bonus', 'powerup', 'curse')),
  effect      JSONB       NOT NULL DEFAULT '{}',
  status      TEXT        NOT NULL DEFAULT 'in_hand'
                CHECK (status IN ('in_hand', 'played')),
  drawn_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  played_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS game_zones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID        NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  station_id  TEXT        NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER     NOT NULL,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS question_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID        NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  photo_data   TEXT        NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scores (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id      UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score_seconds  INTEGER     NOT NULL DEFAULT 0,
  bonus_seconds  INTEGER     NOT NULL DEFAULT 0,
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
