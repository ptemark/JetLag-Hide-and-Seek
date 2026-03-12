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

-- Idempotent migration: add seeker_teams if it doesn't exist yet.
ALTER TABLE games ADD COLUMN IF NOT EXISTS seeker_teams INTEGER NOT NULL DEFAULT 0;

-- Idempotent migration: add curse_expires_at for curse card enforcement.
ALTER TABLE games ADD COLUMN IF NOT EXISTS curse_expires_at TIMESTAMPTZ;

-- Idempotent migration: expand questions category CHECK to include measuring and transit.
-- The old 4-value constraint is dropped first (IF EXISTS) so this script is safe to re-run.
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_category_check;
ALTER TABLE questions ADD CONSTRAINT questions_category_check
  CHECK (category IN ('matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'));

-- -------------------------------------------------------------------------
-- game_players
-- Joins players to games, recording each player's role.
-- Deleted automatically when the parent game or player is removed.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_players (
  game_id    UUID        NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id  UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('hider', 'seeker')),
  team       TEXT        CHECK (team IN ('A', 'B')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, player_id)
);

-- Idempotent migration: add team column if it doesn't exist yet.
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS team TEXT CHECK (team IN ('A', 'B'));

-- -------------------------------------------------------------------------
-- questions
-- Questions submitted by seekers to narrow down the hider's location.
-- category: matching | thermometer | photo | tentacle
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- answers
-- Hider responses to seeker questions.
-- One answer per question (enforced by unique constraint).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS answers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID        NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  responder_id UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- cards
-- Challenge cards held by hiders.  Drawn automatically when a hider answers
-- a question (max 6 in-hand per player per game).
-- type: time_bonus | powerup | curse
-- effect: JSONB payload describing the card's mechanical effect.
-- status: in_hand (playable) | played (already used)
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- game_zones
-- The hiding zone chosen by the hider during the hiding phase.
-- One row per game (hider locks exactly one station).
-- stationId: OSM node id (string); lat/lon: station coordinates; radiusM: zone radius in metres.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_zones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID        NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  station_id  TEXT        NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER     NOT NULL,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- question_photos
-- Optional photo uploaded by the hider for a photo-category question.
-- One photo per question (enforced by unique constraint).
-- photo_data: base64-encoded image string.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID        NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  photo_data   TEXT        NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  bonus_seconds  INTEGER     NOT NULL DEFAULT 0,
  captured_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, player_id)
);
