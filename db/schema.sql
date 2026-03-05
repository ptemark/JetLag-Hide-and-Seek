-- schema.sql — JetLag: The Game
-- Apply with: psql $DATABASE_URL -f db/schema.sql
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING guards).

-- -------------------------------------------------------------------------
-- players
-- Identity record for each participant across all games.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- games
-- One row per game session.  Active state lives in the managed game-loop
-- container; this table is the persistent checkpoint.
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- game_players
-- Joins players to games, recording each player's role.
-- Deleted automatically when the parent game or player is removed.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_players (
  game_id    UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id  UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('hider', 'seeker')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, player_id)
);

-- -------------------------------------------------------------------------
-- scores
-- Outcome record written at the end of each game.
-- score_seconds = total time the hider survived (higher is better for hider).
-- captured_at is NULL if the hider was never found.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scores (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id      UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score_seconds  INTEGER     NOT NULL DEFAULT 0,
  captured_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, player_id)
);
