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
 * @param {{ size: string, bounds?: object, seekerTeams?: number }} options
 * @returns {Promise<{ gameId: string, size: string, bounds: object, status: string, seekerTeams: number, createdAt: string }>}
 */
export async function dbCreateGame(pool, { size, bounds = {}, seekerTeams = 0 }) {
  const res = await pool.query(
    `INSERT INTO games (size, bounds, seeker_teams)
     VALUES ($1, $2, $3)
     RETURNING id, size, bounds, status, seeker_teams, created_at`,
    [size, JSON.stringify(bounds), seekerTeams],
  );
  const row = res.rows[0];
  return {
    gameId: row.id,
    size: row.size,
    bounds: row.bounds,
    status: row.status,
    seekerTeams: row.seeker_teams,
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
    'SELECT id, size, bounds, status, seeker_teams, created_at FROM games WHERE id = $1',
    [id],
  );
  if (gameRes.rows.length === 0) return null;
  const g = gameRes.rows[0];

  const playersRes = await pool.query(
    `SELECT p.id, p.name, gp.role, gp.team, gp.joined_at
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
    team: r.team ?? null,
    joinedAt: r.joined_at,
  }));

  return {
    gameId: g.id,
    size: g.size,
    bounds: g.bounds,
    status: g.status,
    seekerTeams: g.seeker_teams,
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
 * Add a player to a game with a specific role and optional team assignment.
 *
 * When `team` is provided it is persisted.  When omitted and the game has
 * seeker_teams = 2, the function auto-assigns the seeker to whichever team
 * currently has fewer members (A if equal).
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, playerId: string, role: string, team?: string|null }} options
 * @returns {Promise<{ gameId: string, playerId: string, role: string, team: string|null, joinedAt: string }>}
 */
export async function dbJoinGame(pool, { gameId, playerId, role, team = null }) {
  let assignedTeam = team;

  // Auto-assign team for seekers when the game uses two teams.
  if (!assignedTeam && role === 'seeker') {
    const gameRes = await pool.query(
      'SELECT seeker_teams FROM games WHERE id = $1',
      [gameId],
    );
    const seekerTeams = gameRes.rows[0]?.seeker_teams ?? 0;
    if (seekerTeams >= 2) {
      const countRes = await pool.query(
        `SELECT team, COUNT(*) AS cnt FROM game_players
         WHERE game_id = $1 AND role = 'seeker' AND team IS NOT NULL
         GROUP BY team`,
        [gameId],
      );
      const counts = { A: 0, B: 0 };
      for (const r of countRes.rows) {
        if (r.team === 'A' || r.team === 'B') counts[r.team] = Number(r.cnt);
      }
      assignedTeam = counts.B < counts.A ? 'B' : 'A';
    }
  }

  const res = await pool.query(
    `INSERT INTO game_players (game_id, player_id, role, team)
     VALUES ($1, $2, $3, $4)
     RETURNING game_id, player_id, role, team, joined_at`,
    [gameId, playerId, role, assignedTeam],
  );
  const row = res.rows[0];
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    role: row.role,
    team: row.team ?? null,
    joinedAt: row.joined_at,
  };
}

/**
 * Insert or update a score for a player in a game.
 * On conflict (same game + player pair), updates score_seconds, bonus_seconds, and captured_at.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, playerId: string, scoreSeconds: number, bonusSeconds?: number, capturedAt?: Date|string|null }} options
 * @returns {Promise<{ scoreId: string, gameId: string, playerId: string, scoreSeconds: number, bonusSeconds: number, capturedAt: string|null, createdAt: string }>}
 */
export async function dbSubmitScore(pool, { gameId, playerId, scoreSeconds, bonusSeconds = 0, capturedAt = null }) {
  const res = await pool.query(
    `INSERT INTO scores (game_id, player_id, score_seconds, bonus_seconds, captured_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (game_id, player_id) DO UPDATE
       SET score_seconds = EXCLUDED.score_seconds,
           bonus_seconds = EXCLUDED.bonus_seconds,
           captured_at   = EXCLUDED.captured_at
     RETURNING id, game_id, player_id, score_seconds, bonus_seconds, captured_at, created_at`,
    [gameId, playerId, scoreSeconds, bonusSeconds, capturedAt],
  );
  const row = res.rows[0];
  return {
    scoreId: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    scoreSeconds: row.score_seconds,
    bonusSeconds: row.bonus_seconds,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

/**
 * Retrieve all scores for a game, highest score first.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @returns {Promise<Array<{ scoreId: string, gameId: string, playerId: string, scoreSeconds: number, bonusSeconds: number, capturedAt: string|null, createdAt: string }>>}
 */
export async function dbGetGameScores(pool, gameId) {
  const res = await pool.query(
    `SELECT id, game_id, player_id, score_seconds, bonus_seconds, captured_at, created_at
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
    bonusSeconds: row.bonus_seconds,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  }));
}

// ── Game zone store ───────────────────────────────────────────────────────────

/**
 * Persist the hider's chosen hiding zone for a game.
 * Idempotent: on conflict (same game_id) updates the zone row.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, stationId: string, lat: number, lon: number, radiusM: number }} options
 * @returns {Promise<{ zoneId: string, gameId: string, stationId: string, lat: number, lon: number, radiusM: number, lockedAt: string }>}
 */
export async function dbSetGameZone(pool, { gameId, stationId, lat, lon, radiusM }) {
  const res = await pool.query(
    `INSERT INTO game_zones (game_id, station_id, lat, lon, radius_m)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (game_id) DO UPDATE
       SET station_id = EXCLUDED.station_id,
           lat        = EXCLUDED.lat,
           lon        = EXCLUDED.lon,
           radius_m   = EXCLUDED.radius_m,
           locked_at  = NOW()
     RETURNING id, game_id, station_id, lat, lon, radius_m, locked_at`,
    [gameId, stationId, lat, lon, radiusM],
  );
  const row = res.rows[0];
  return {
    zoneId:    row.id,
    gameId:    row.game_id,
    stationId: row.station_id,
    lat:       row.lat,
    lon:       row.lon,
    radiusM:   row.radius_m,
    lockedAt:  row.locked_at,
  };
}

/**
 * Retrieve the locked hiding zone for a game, or null if not yet set.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @returns {Promise<{ zoneId: string, gameId: string, stationId: string, lat: number, lon: number, radiusM: number, lockedAt: string } | null>}
 */
export async function dbGetGameZone(pool, gameId) {
  const res = await pool.query(
    `SELECT id, game_id, station_id, lat, lon, radius_m, locked_at
     FROM game_zones WHERE game_id = $1`,
    [gameId],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    zoneId:    row.id,
    gameId:    row.game_id,
    stationId: row.station_id,
    lat:       row.lat,
    lon:       row.lon,
    radiusM:   row.radius_m,
    lockedAt:  row.locked_at,
  };
}

// ── Question / Answer store ───────────────────────────────────────────────────

/** Answer deadline in milliseconds for non-photo categories. */
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Photo question expiry by game scale (RULES.md: 10–20 min depending on game size).
 * Falls back to 15 min when scale is unknown.
 */
const PHOTO_EXPIRY_MS_BY_SCALE = {
  small:  10 * 60 * 1000,
  medium: 15 * 60 * 1000,
  large:  20 * 60 * 1000,
};

/** @param {string|undefined} scale  @param {string} category */
function computeExpiryMs(scale, category) {
  if (category !== 'photo') return DEFAULT_EXPIRY_MS;
  return PHOTO_EXPIRY_MS_BY_SCALE[scale] ?? PHOTO_EXPIRY_MS_BY_SCALE.medium;
}

/**
 * Insert a new question record.
 * Rejects with 409 if a pending question already exists for the same game (or
 * the same seeker team when the game uses two seeker teams).
 *
 * When `category === 'photo'` and no `gameScale` is provided, the function
 * fetches the game's `size` from the DB to derive the correct expiry
 * (small → 10 min, medium → 15 min, large → 20 min).
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, askerId: string, targetId: string, category: string, text: string, askerTeam?: string|null, gameScale?: string, thermometerCurrentDistanceM?: number|null, thermometerPreviousDistanceM?: number|null, tentacleTargetLat?: number|null, tentacleTargetLon?: number|null, tentacleRadiusKm?: number|null, tentacleDistanceKm?: number|null, tentacleWithinRadius?: boolean|null, measuringTargetLat?: number|null, measuringTargetLon?: number|null, measuringHiderDistanceKm?: number|null, measuringSeekerDistanceKm?: number|null, measuringHiderIsCloser?: boolean|null, transitNearestStationName?: string|null, transitNearestStationLat?: number|null, transitNearestStationLon?: number|null, transitNearestStationDistanceKm?: number|null }} options
 * @returns {Promise<{ questionId: string, gameId: string, askerId: string, targetId: string, category: string, text: string, status: string, expiresAt: string, createdAt: string, thermometerCurrentDistanceM: number|null, thermometerPreviousDistanceM: number|null, tentacleTargetLat: number|null, tentacleTargetLon: number|null, tentacleRadiusKm: number|null, tentacleDistanceKm: number|null, tentacleWithinRadius: boolean|null, measuringTargetLat: number|null, measuringTargetLon: number|null, measuringHiderDistanceKm: number|null, measuringSeekerDistanceKm: number|null, measuringHiderIsCloser: boolean|null, transitNearestStationName: string|null, transitNearestStationLat: number|null, transitNearestStationLon: number|null, transitNearestStationDistanceKm: number|null } | { conflict: true }>}
 */
export async function dbCreateQuestion(pool, {
  gameId, askerId, targetId, category, text,
  askerTeam = null, gameScale,
  thermometerCurrentDistanceM = null, thermometerPreviousDistanceM = null,
  tentacleTargetLat = null, tentacleTargetLon = null, tentacleRadiusKm = null,
  tentacleDistanceKm = null, tentacleWithinRadius = null,
  measuringTargetLat = null, measuringTargetLon = null,
  measuringHiderDistanceKm = null, measuringSeekerDistanceKm = null, measuringHiderIsCloser = null,
  transitNearestStationName = null, transitNearestStationLat = null,
  transitNearestStationLon = null, transitNearestStationDistanceKm = null,
}) {
  // Enforce one-pending-question-at-a-time.  When the game uses two teams,
  // scope the check to the asker's team so both teams can ask independently.
  let pending;
  if (askerTeam) {
    // Scope pending check to questions from the same seeker team.
    pending = await pool.query(
      `SELECT q.id FROM questions q
       JOIN game_players gp ON gp.player_id = q.asker_id AND gp.game_id = q.game_id
       WHERE q.game_id = $1 AND q.status = 'pending' AND gp.team = $2
       LIMIT 1`,
      [gameId, askerTeam],
    );
  } else {
    pending = await pool.query(
      `SELECT id FROM questions WHERE game_id = $1 AND status = 'pending' LIMIT 1`,
      [gameId],
    );
  }
  if (pending.rows.length > 0) return { conflict: true };

  // Derive game scale for photo expiry when not supplied by caller.
  let scale = gameScale;
  if (!scale && category === 'photo') {
    const gameRes = await pool.query('SELECT size FROM games WHERE id = $1', [gameId]);
    scale = gameRes.rows[0]?.size;
  }

  const expiresAt = new Date(Date.now() + computeExpiryMs(scale, category));
  const res = await pool.query(
    `INSERT INTO questions (game_id, asker_id, target_id, category, text, expires_at,
                            thermometer_current_distance_m, thermometer_previous_distance_m,
                            tentacle_target_lat, tentacle_target_lon, tentacle_radius_km,
                            tentacle_distance_km, tentacle_within_radius,
                            measuring_target_lat, measuring_target_lon,
                            measuring_hider_distance_km, measuring_seeker_distance_km,
                            measuring_hider_is_closer,
                            transit_nearest_station_name, transit_nearest_station_lat,
                            transit_nearest_station_lon, transit_nearest_station_distance_km)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22)
     RETURNING id, game_id, asker_id, target_id, category, text, status, expires_at, created_at,
               thermometer_current_distance_m, thermometer_previous_distance_m,
               tentacle_target_lat, tentacle_target_lon, tentacle_radius_km,
               tentacle_distance_km, tentacle_within_radius,
               measuring_target_lat, measuring_target_lon,
               measuring_hider_distance_km, measuring_seeker_distance_km,
               measuring_hider_is_closer,
               transit_nearest_station_name, transit_nearest_station_lat,
               transit_nearest_station_lon, transit_nearest_station_distance_km`,
    [gameId, askerId, targetId, category, text, expiresAt,
     thermometerCurrentDistanceM ?? null, thermometerPreviousDistanceM ?? null,
     tentacleTargetLat ?? null, tentacleTargetLon ?? null, tentacleRadiusKm ?? null,
     tentacleDistanceKm ?? null, tentacleWithinRadius ?? null,
     measuringTargetLat ?? null, measuringTargetLon ?? null,
     measuringHiderDistanceKm ?? null, measuringSeekerDistanceKm ?? null, measuringHiderIsCloser ?? null,
     transitNearestStationName ?? null, transitNearestStationLat ?? null,
     transitNearestStationLon ?? null, transitNearestStationDistanceKm ?? null],
  );
  const row = res.rows[0];
  return {
    questionId: row.id,
    gameId: row.game_id,
    askerId: row.asker_id,
    targetId: row.target_id,
    category: row.category,
    text: row.text,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    thermometerCurrentDistanceM: row.thermometer_current_distance_m ?? null,
    thermometerPreviousDistanceM: row.thermometer_previous_distance_m ?? null,
    tentacleTargetLat:    row.tentacle_target_lat    ?? null,
    tentacleTargetLon:    row.tentacle_target_lon    ?? null,
    tentacleRadiusKm:     row.tentacle_radius_km     ?? null,
    tentacleDistanceKm:   row.tentacle_distance_km   ?? null,
    tentacleWithinRadius: row.tentacle_within_radius ?? null,
    measuringTargetLat:       row.measuring_target_lat        ?? null,
    measuringTargetLon:       row.measuring_target_lon        ?? null,
    measuringHiderDistanceKm:  row.measuring_hider_distance_km  ?? null,
    measuringSeekerDistanceKm: row.measuring_seeker_distance_km ?? null,
    measuringHiderIsCloser:    row.measuring_hider_is_closer    ?? null,
    transitNearestStationName:       row.transit_nearest_station_name        ?? null,
    transitNearestStationLat:        row.transit_nearest_station_lat         ?? null,
    transitNearestStationLon:        row.transit_nearest_station_lon         ?? null,
    transitNearestStationDistanceKm: row.transit_nearest_station_distance_km ?? null,
  };
}

/**
 * Retrieve all questions addressed to a specific player (as target), newest first.
 *
 * @param {import('pg').Pool} pool
 * @param {string} playerId
 * @returns {Promise<Array<{ questionId: string, gameId: string, askerId: string, targetId: string, category: string, text: string, status: string, expiresAt: string, createdAt: string }>>}
 */
export async function dbGetQuestionsForPlayer(pool, playerId) {
  const res = await pool.query(
    `SELECT id, game_id, asker_id, target_id, category, text, status, expires_at, created_at,
            thermometer_current_distance_m, thermometer_previous_distance_m,
            tentacle_target_lat, tentacle_target_lon, tentacle_radius_km,
            tentacle_distance_km, tentacle_within_radius,
            measuring_target_lat, measuring_target_lon,
            measuring_hider_distance_km, measuring_seeker_distance_km,
            measuring_hider_is_closer,
            transit_nearest_station_name, transit_nearest_station_lat,
            transit_nearest_station_lon, transit_nearest_station_distance_km
     FROM questions
     WHERE target_id = $1
     ORDER BY created_at DESC`,
    [playerId],
  );
  return res.rows.map(row => ({
    questionId: row.id,
    gameId: row.game_id,
    askerId: row.asker_id,
    targetId: row.target_id,
    category: row.category,
    text: row.text,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    thermometerCurrentDistanceM: row.thermometer_current_distance_m ?? null,
    thermometerPreviousDistanceM: row.thermometer_previous_distance_m ?? null,
    tentacleTargetLat:    row.tentacle_target_lat    ?? null,
    tentacleTargetLon:    row.tentacle_target_lon    ?? null,
    tentacleRadiusKm:     row.tentacle_radius_km     ?? null,
    tentacleDistanceKm:   row.tentacle_distance_km   ?? null,
    tentacleWithinRadius: row.tentacle_within_radius ?? null,
    measuringTargetLat:       row.measuring_target_lat        ?? null,
    measuringTargetLon:       row.measuring_target_lon        ?? null,
    measuringHiderDistanceKm:  row.measuring_hider_distance_km  ?? null,
    measuringSeekerDistanceKm: row.measuring_seeker_distance_km ?? null,
    measuringHiderIsCloser:    row.measuring_hider_is_closer    ?? null,
    transitNearestStationName:       row.transit_nearest_station_name        ?? null,
    transitNearestStationLat:        row.transit_nearest_station_lat         ?? null,
    transitNearestStationLon:        row.transit_nearest_station_lon         ?? null,
    transitNearestStationDistanceKm: row.transit_nearest_station_distance_km ?? null,
  }));
}

/**
 * Fetch all questions for a game with their answers (if answered).
 * Ordered newest-first.  Used by the seeker Q&A history view.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @returns {Promise<Array<{ questionId, gameId, askerId, targetId, category, text, status, expiresAt, createdAt, answer: { text, createdAt }|null }>>}
 */
export async function dbGetQuestionsForGame(pool, gameId) {
  const res = await pool.query(
    `SELECT q.id, q.game_id, q.asker_id, q.target_id, q.category, q.text,
            q.status, q.expires_at, q.created_at,
            q.thermometer_current_distance_m, q.thermometer_previous_distance_m,
            q.tentacle_target_lat, q.tentacle_target_lon, q.tentacle_radius_km,
            q.tentacle_distance_km, q.tentacle_within_radius,
            q.measuring_target_lat, q.measuring_target_lon,
            q.measuring_hider_distance_km, q.measuring_seeker_distance_km,
            q.measuring_hider_is_closer,
            q.transit_nearest_station_name, q.transit_nearest_station_lat,
            q.transit_nearest_station_lon, q.transit_nearest_station_distance_km,
            a.text AS answer_text, a.created_at AS answer_created_at
     FROM questions q
     LEFT JOIN answers a ON a.question_id = q.id
     WHERE q.game_id = $1
     ORDER BY q.created_at DESC`,
    [gameId],
  );
  return res.rows.map(row => ({
    questionId:  row.id,
    gameId:      row.game_id,
    askerId:     row.asker_id,
    targetId:    row.target_id,
    category:    row.category,
    text:        row.text,
    status:      row.status,
    expiresAt:   row.expires_at,
    createdAt:   row.created_at,
    thermometerCurrentDistanceM:  row.thermometer_current_distance_m ?? null,
    thermometerPreviousDistanceM: row.thermometer_previous_distance_m ?? null,
    tentacleTargetLat:    row.tentacle_target_lat    ?? null,
    tentacleTargetLon:    row.tentacle_target_lon    ?? null,
    tentacleRadiusKm:     row.tentacle_radius_km     ?? null,
    tentacleDistanceKm:   row.tentacle_distance_km   ?? null,
    tentacleWithinRadius: row.tentacle_within_radius ?? null,
    measuringTargetLat:       row.measuring_target_lat        ?? null,
    measuringTargetLon:       row.measuring_target_lon        ?? null,
    measuringHiderDistanceKm:  row.measuring_hider_distance_km  ?? null,
    measuringSeekerDistanceKm: row.measuring_seeker_distance_km ?? null,
    measuringHiderIsCloser:    row.measuring_hider_is_closer    ?? null,
    transitNearestStationName:       row.transit_nearest_station_name        ?? null,
    transitNearestStationLat:        row.transit_nearest_station_lat         ?? null,
    transitNearestStationLon:        row.transit_nearest_station_lon         ?? null,
    transitNearestStationDistanceKm: row.transit_nearest_station_distance_km ?? null,
    answer:      row.answer_text != null
      ? { text: row.answer_text, createdAt: row.answer_created_at }
      : null,
  }));
}

/**
 * Mark all pending questions for a game that have passed their deadline as 'expired'.
 * Returns the expired question records so callers can broadcast events.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @returns {Promise<Array<{ questionId: string, gameId: string, askerId: string }>>}
 */
export async function dbExpireStaleQuestions(pool, gameId) {
  const res = await pool.query(
    `UPDATE questions
     SET status = 'expired'
     WHERE game_id = $1 AND status = 'pending' AND expires_at <= NOW()
     RETURNING id, game_id, asker_id`,
    [gameId],
  );
  return res.rows.map(row => ({
    questionId: row.id,
    gameId: row.game_id,
    askerId: row.asker_id,
  }));
}

/**
 * Insert an answer for a question and mark the question as answered.
 * Returns the answer record on success or null if the question was not found.
 *
 * @param {import('pg').Pool} pool
 * @param {{ questionId: string, responderId: string, text: string }} options
 * @returns {Promise<{ answerId: string, questionId: string, responderId: string, text: string, createdAt: string } | null>}
 */
export async function dbSubmitAnswer(pool, { questionId, responderId, text }) {
  // Verify the question exists before inserting the answer.
  const check = await pool.query('SELECT id, game_id FROM questions WHERE id = $1', [questionId]);
  if (check.rows.length === 0) return null;
  const questionGameId = check.rows[0].game_id;

  const answerRes = await pool.query(
    `INSERT INTO answers (question_id, responder_id, text)
     VALUES ($1, $2, $3)
     RETURNING id, question_id, responder_id, text, created_at`,
    [questionId, responderId, text],
  );
  await pool.query(
    `UPDATE questions SET status = 'answered' WHERE id = $1`,
    [questionId],
  );
  const row = answerRes.rows[0];
  return {
    answerId: row.id,
    questionId: row.question_id,
    gameId: questionGameId,
    responderId: row.responder_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

// ── Question photo store ──────────────────────────────────────────────────────

/**
 * Insert or update a photo for a question.
 * On conflict (same question_id) replaces the existing photo.
 *
 * @param {import('pg').Pool} pool
 * @param {{ questionId: string, photoData: string }} options
 * @returns {Promise<{ photoId: string, questionId: string, uploadedAt: string }>}
 */
export async function dbSaveQuestionPhoto(pool, { questionId, photoData }) {
  const res = await pool.query(
    `INSERT INTO question_photos (question_id, photo_data)
     VALUES ($1, $2)
     ON CONFLICT (question_id) DO UPDATE
       SET photo_data  = EXCLUDED.photo_data,
           uploaded_at = NOW()
     RETURNING id, question_id, uploaded_at`,
    [questionId, photoData],
  );
  const row = res.rows[0];
  return { photoId: row.id, questionId: row.question_id, uploadedAt: row.uploaded_at };
}

/**
 * Retrieve the photo for a question, or null if none uploaded.
 *
 * @param {import('pg').Pool} pool
 * @param {string} questionId
 * @returns {Promise<{ photoId: string, questionId: string, photoData: string, uploadedAt: string } | null>}
 */
export async function dbGetQuestionPhoto(pool, questionId) {
  const res = await pool.query(
    `SELECT id, question_id, photo_data, uploaded_at
     FROM question_photos WHERE question_id = $1`,
    [questionId],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    photoId: row.id,
    questionId: row.question_id,
    photoData: row.photo_data,
    uploadedAt: row.uploaded_at,
  };
}

// ── Card store ────────────────────────────────────────────────────────────────

/** Maximum cards a player may hold in hand at once. */
export const HAND_LIMIT = 6;

/**
 * Insert a new card for a player if their hand has fewer than HAND_LIMIT cards.
 * Returns the new card record, or null if the hand is already full.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, playerId: string, type: string, effect: object }} options
 * @returns {Promise<{ cardId: string, gameId: string, playerId: string, type: string, effect: object, status: string, drawnAt: string } | null>}
 */
export async function dbDrawCard(pool, { gameId, playerId, type, effect }) {
  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM cards
     WHERE game_id = $1 AND player_id = $2 AND status = 'in_hand'`,
    [gameId, playerId],
  );
  if (Number(countRes.rows[0].cnt) >= HAND_LIMIT) return null;

  const res = await pool.query(
    `INSERT INTO cards (game_id, player_id, type, effect)
     VALUES ($1, $2, $3, $4)
     RETURNING id, game_id, player_id, type, effect, status, drawn_at`,
    [gameId, playerId, type, JSON.stringify(effect)],
  );
  const row = res.rows[0];
  return {
    cardId: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    type: row.type,
    effect: row.effect,
    status: row.status,
    drawnAt: row.drawn_at,
  };
}

/**
 * Retrieve all in-hand cards for a player in a game.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, playerId: string }} options
 * @returns {Promise<Array<{ cardId: string, gameId: string, playerId: string, type: string, effect: object, status: string, drawnAt: string }>>}
 */
export async function dbGetPlayerHand(pool, { gameId, playerId }) {
  const res = await pool.query(
    `SELECT id, game_id, player_id, type, effect, status, drawn_at
     FROM cards
     WHERE game_id = $1 AND player_id = $2 AND status = 'in_hand'
     ORDER BY drawn_at ASC`,
    [gameId, playerId],
  );
  return res.rows.map(row => ({
    cardId: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    type: row.type,
    effect: row.effect,
    status: row.status,
    drawnAt: row.drawn_at,
  }));
}

/**
 * Mark a card as played.  Only succeeds if the card is in_hand and belongs to
 * the given player.  Returns the updated card, or null if not found / already played.
 *
 * @param {import('pg').Pool} pool
 * @param {{ cardId: string, playerId: string }} options
 * @returns {Promise<{ cardId: string, gameId: string, playerId: string, type: string, effect: object, status: string, drawnAt: string, playedAt: string } | null>}
 */
export async function dbPlayCard(pool, { cardId, playerId }) {
  const res = await pool.query(
    `UPDATE cards
     SET status = 'played', played_at = NOW()
     WHERE id = $1 AND player_id = $2 AND status = 'in_hand'
     RETURNING id, game_id, player_id, type, effect, status, drawn_at, played_at`,
    [cardId, playerId],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    cardId: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    type: row.type,
    effect: row.effect,
    status: row.status,
    drawnAt: row.drawn_at,
    playedAt: row.played_at,
  };
}

// ── Curse card DB helpers ──────────────────────────────────────────────────────

/**
 * Set (or replace) the active curse expiry for a game.
 * Called when a hider plays a curse card.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @param {string} expiresAt  ISO 8601 timestamp string.
 * @returns {Promise<void>}
 */
export async function dbSetCurse(pool, gameId, expiresAt) {
  await pool.query(
    'UPDATE games SET curse_expires_at = $2 WHERE id = $1',
    [gameId, expiresAt],
  );
}

/**
 * Get the curse expiry timestamp for a game.
 * Returns an ISO string if a curse is or was active, otherwise null.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @returns {Promise<string | null>}
 */
export async function dbGetCurseExpiry(pool, gameId) {
  const res = await pool.query(
    'SELECT curse_expires_at FROM games WHERE id = $1',
    [gameId],
  );
  if (res.rows.length === 0) return null;
  const val = res.rows[0].curse_expires_at;
  return val ? new Date(val).toISOString() : null;
}

// ── Leaderboard query ─────────────────────────────────────────────────────────

/**
 * Retrieve ranked scores joined with player names and game scale.
 * Results are ordered by score_seconds descending (highest hidden time first).
 *
 * @param {import('pg').Pool} pool
 * @param {{ limit?: number, gameId?: string|null }} options
 * @returns {Promise<Array<{ rank: number, playerName: string, scale: string, scoreSeconds: number, bonusSeconds: number, createdAt: string }>>}
 */
export async function dbGetLeaderboard(pool, { limit = 20, gameId = null } = {}) {
  const params = [limit];
  const whereClause = gameId ? 'WHERE s.game_id = $2' : '';
  if (gameId) params.push(gameId);

  const res = await pool.query(
    `SELECT p.name AS player_name, g.size, s.score_seconds, s.bonus_seconds, s.created_at
     FROM scores s
     JOIN players p ON p.id = s.player_id
     JOIN games g ON g.id = s.game_id
     ${whereClause}
     ORDER BY s.score_seconds DESC
     LIMIT $1`,
    params,
  );
  return res.rows.map((row, i) => ({
    rank: i + 1,
    playerName: row.player_name,
    scale: row.size,
    scoreSeconds: row.score_seconds,
    bonusSeconds: row.bonus_seconds,
    createdAt: row.created_at,
  }));
}

// ── Instrumented store ────────────────────────────────────────────────────────

/**
 * Wrap the DB store functions with metrics instrumentation.
 *
 * Returns bound versions of all store functions that automatically increment
 * MetricKey.DB_READS or MetricKey.DB_WRITES on success, and
 * MetricKey.ERRORS on failure, using the provided MetricsCollector.
 *
 * @param {import('pg').Pool} pool  Database pool passed through to each function.
 * @param {import('../server/monitoring.js').MetricsCollector} metrics
 * @returns {{
 *   dbCreatePlayer: Function,
 *   dbGetPlayer: Function,
 *   dbCreateGame: Function,
 *   dbGetGame: Function,
 *   dbUpdateGameStatus: Function,
 *   dbJoinGame: Function,
 *   dbSubmitScore: Function,
 *   dbGetGameScores: Function,
 * }}
 */
export function createInstrumentedStore(pool, metrics) {
  // Keys of the MetricKey enum used here; imported lazily to avoid a circular
  // dep from db/ → server/monitoring.  The caller supplies the MetricsCollector
  // instance directly so we only need the string keys.
  const READ  = 'dbReads';
  const WRITE = 'dbWrites';
  const ERROR = 'errors';

  function wrap(fn, metricKey) {
    return async (...args) => {
      try {
        const result = await fn(pool, ...args);
        metrics.increment(metricKey);
        return result;
      } catch (err) {
        metrics.increment(ERROR);
        throw err;
      }
    };
  }

  return {
    dbCreatePlayer:    wrap(dbCreatePlayer,    WRITE),
    dbGetPlayer:       wrap(dbGetPlayer,       READ),
    dbCreateGame:      wrap(dbCreateGame,      WRITE),
    dbGetGame:         wrap(dbGetGame,         READ),
    dbUpdateGameStatus:wrap(dbUpdateGameStatus,WRITE),
    dbJoinGame:        wrap(dbJoinGame,        WRITE),
    dbSubmitScore:     wrap(dbSubmitScore,     WRITE),
    dbGetGameScores:   wrap(dbGetGameScores,   READ),
  };
}
