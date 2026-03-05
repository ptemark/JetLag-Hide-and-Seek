/**
 * gameStore.js — Database-backed CRUD operations for JetLag game state.
 *
 * All functions accept a pg Pool as the first argument and return Promises.
 * Server-side code (functions/ handlers, server/) should use these when a
 * real DB pool is available; pass a mock pool in tests.
 *
 * No pg import here — callers supply the pool created by db.js:createPool().
 */

/**
 * Insert a new player record.
 * Role is NOT stored on the player row; it lives in game_players when the
 * player joins a specific game via dbJoinGame.
 *
 * @param {import('pg').Pool} pool
 * @param {{ name: string }} options
 * @returns {Promise<{ playerId: string, name: string, createdAt: string }>}
 */
export async function dbCreatePlayer(pool, { name }) {
  const res = await pool.query(
    'INSERT INTO players (name) VALUES ($1) RETURNING id, name, created_at',
    [name],
  );
  const row = res.rows[0];
  return { playerId: row.id, name: row.name, createdAt: row.created_at };
}

/**
 * Retrieve a player by ID.
 *
 * @param {import('pg').Pool} pool
 * @param {string} id
 * @returns {Promise<{ playerId: string, name: string, createdAt: string } | null>}
 */
export async function dbGetPlayer(pool, id) {
  const res = await pool.query(
    'SELECT id, name, created_at FROM players WHERE id = $1',
    [id],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { playerId: row.id, name: row.name, createdAt: row.created_at };
}

/**
 * Insert a new game record.
 *
 * @param {import('pg').Pool} pool
 * @param {{ size: string, bounds?: object }} options
 * @returns {Promise<{ gameId: string, size: string, bounds: object, status: string, createdAt: string }>}
 */
export async function dbCreateGame(pool, { size, bounds = {} }) {
  const res = await pool.query(
    'INSERT INTO games (size, bounds) VALUES ($1, $2) RETURNING id, size, bounds, status, created_at',
    [size, JSON.stringify(bounds)],
  );
  const row = res.rows[0];
  return {
    gameId: row.id,
    size: row.size,
    bounds: row.bounds,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Retrieve a game by ID, including its joined players.
 *
 * @param {import('pg').Pool} pool
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function dbGetGame(pool, id) {
  const gameRes = await pool.query(
    'SELECT id, size, bounds, status, created_at FROM games WHERE id = $1',
    [id],
  );
  if (gameRes.rows.length === 0) return null;
  const g = gameRes.rows[0];

  const playersRes = await pool.query(
    `SELECT p.id, p.name, gp.role, gp.joined_at
     FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = $1
     ORDER BY gp.joined_at`,
    [id],
  );
  const players = playersRes.rows.map(r => ({
    playerId: r.id,
    name: r.name,
    role: r.role,
    joinedAt: r.joined_at,
  }));

  return {
    gameId: g.id,
    size: g.size,
    bounds: g.bounds,
    status: g.status,
    createdAt: g.created_at,
    players,
  };
}

/**
 * Update a game's status field.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, status: string }} options
 * @returns {Promise<{ gameId: string, status: string } | null>} null if game not found
 */
export async function dbUpdateGameStatus(pool, { gameId, status }) {
  const res = await pool.query(
    'UPDATE games SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status',
    [status, gameId],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { gameId: row.id, status: row.status };
}

/**
 * Add a player to a game with a specific role.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, playerId: string, role: string }} options
 * @returns {Promise<{ gameId: string, playerId: string, role: string, joinedAt: string }>}
 */
export async function dbJoinGame(pool, { gameId, playerId, role }) {
  const res = await pool.query(
    `INSERT INTO game_players (game_id, player_id, role)
     VALUES ($1, $2, $3)
     RETURNING game_id, player_id, role, joined_at`,
    [gameId, playerId, role],
  );
  const row = res.rows[0];
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    role: row.role,
    joinedAt: row.joined_at,
  };
}

/**
 * Insert or update a score for a player in a game.
 * On conflict (same game + player pair), updates score_seconds and captured_at.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, playerId: string, scoreSeconds: number, capturedAt?: Date|string|null }} options
 * @returns {Promise<{ scoreId: string, gameId: string, playerId: string, scoreSeconds: number, capturedAt: string|null, createdAt: string }>}
 */
export async function dbSubmitScore(pool, { gameId, playerId, scoreSeconds, capturedAt = null }) {
  const res = await pool.query(
    `INSERT INTO scores (game_id, player_id, score_seconds, captured_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (game_id, player_id) DO UPDATE
       SET score_seconds = EXCLUDED.score_seconds,
           captured_at   = EXCLUDED.captured_at
     RETURNING id, game_id, player_id, score_seconds, captured_at, created_at`,
    [gameId, playerId, scoreSeconds, capturedAt],
  );
  const row = res.rows[0];
  return {
    scoreId: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    scoreSeconds: row.score_seconds,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

/**
 * Retrieve all scores for a game, highest score first.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @returns {Promise<Array<{ scoreId: string, gameId: string, playerId: string, scoreSeconds: number, capturedAt: string|null, createdAt: string }>>}
 */
export async function dbGetGameScores(pool, gameId) {
  const res = await pool.query(
    `SELECT id, game_id, player_id, score_seconds, captured_at, created_at
     FROM scores
     WHERE game_id = $1
     ORDER BY score_seconds DESC`,
    [gameId],
  );
  return res.rows.map(row => ({
    scoreId: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    scoreSeconds: row.score_seconds,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  }));
}
