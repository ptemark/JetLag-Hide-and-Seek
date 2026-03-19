/**
 * questions.js — Serverless handlers for the question/answer system.
 *
 * Routes:
 *   POST  /questions                — seeker submits a question to the hider
 *   GET   /questions?playerId=      — list questions addressed to a player
 *   POST  /answers/:questionId      — hider submits an answer; triggers WS broadcast
 *
 * All handlers accept an optional pg Pool as a second argument.
 * When omitted they fall back to an in-process Map (tests / local dev).
 *
 * When an answer is submitted, the handler optionally notifies the managed
 * game server via POST /internal/notify so it can broadcast the event to
 * all connected seekers.  The notification is fire-and-forget: a failure
 * does not fail the response.  The server URL is read from the GAME_SERVER_URL
 * environment variable (injected at call time so callers can override it).
 */

import { randomUUID } from 'node:crypto';
import {
  dbCreateQuestion,
  dbGetQuestionsForPlayer,
  dbGetQuestionsForGame,
  dbSubmitAnswer,
  dbDrawCard,
  dbSaveQuestionPhoto,
  dbGetQuestionPhoto,
  dbGetCurseExpiry,
} from '../db/gameStore.js';
import { drawCardInProcess, randomCardDescriptor, _curses } from './cards.js';

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

const VALID_CATEGORIES = ['matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'];

/** Maximum decoded photo size in bytes (500 KB). Base64 representation is ~4/3 larger. */
const MAX_PHOTO_BYTES = 512_000;

/** Maximum base64 string length corresponding to MAX_PHOTO_BYTES. */
const MAX_PHOTO_BASE64_LEN = Math.ceil(MAX_PHOTO_BYTES * 4 / 3);

/**
 * Fetch tentacle proximity data from the managed server.
 * Returns `{ withinRadius, distanceKm }` with nulls on any failure.
 * Failures are silent — the question is still created with null values.
 *
 * @param {{ gameId: string, targetLat: number, targetLon: number, radiusKm: number }} params
 * @param {string|undefined} gameServerUrl
 * @param {string|null} adminApiKey
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ withinRadius: boolean|null, distanceKm: number|null }>}
 */
async function fetchTentacleData({ gameId, targetLat, targetLon, radiusKm }, gameServerUrl, adminApiKey, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
  if (!serverUrl || !fetchFn || !key) {
    return { withinRadius: null, distanceKm: null };
  }
  try {
    const params = new URLSearchParams({
      targetLat: String(targetLat),
      targetLon: String(targetLon),
      radiusKm:  String(radiusKm),
    });
    const res = await fetchFn(
      `${serverUrl}/internal/games/${gameId}/tentacle?${params}`,
      { headers: { 'Authorization': `Bearer ${key}` } },
    );
    const data = await res.json();
    return {
      withinRadius: data.withinRadius ?? null,
      distanceKm:   data.distanceKm  ?? null,
    };
  } catch {
    return { withinRadius: null, distanceKm: null };
  }
}

/**
 * Fetch measuring distance data from the managed server.
 * Returns `{ hiderDistanceKm, seekerDistanceKm, hiderIsCloser }` with nulls on any failure.
 * Failures are silent — the question is still created with null values.
 *
 * @param {{ gameId: string, seekerId: string, targetLat: number, targetLon: number }} params
 * @param {string|undefined} gameServerUrl
 * @param {string|null} adminApiKey
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ hiderDistanceKm: number|null, seekerDistanceKm: number|null, hiderIsCloser: boolean|null }>}
 */
async function fetchMeasuringData({ gameId, seekerId, targetLat, targetLon }, gameServerUrl, adminApiKey, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
  if (!serverUrl || !fetchFn || !key) {
    return { hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null };
  }
  try {
    const params = new URLSearchParams({
      seekerId: String(seekerId),
      targetLat: String(targetLat),
      targetLon: String(targetLon),
    });
    const res = await fetchFn(
      `${serverUrl}/internal/games/${gameId}/measuring?${params}`,
      { headers: { 'Authorization': `Bearer ${key}` } },
    );
    const data = await res.json();
    return {
      hiderDistanceKm:  data.hiderDistanceKm  ?? null,
      seekerDistanceKm: data.seekerDistanceKm ?? null,
      hiderIsCloser:    data.hiderIsCloser    ?? null,
    };
  } catch {
    return { hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null };
  }
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Build an Overpass QL query that returns public-transit stop nodes within
 * a specified radius (metres) of a lat/lon point.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusM
 * @returns {string}
 */
function buildNearestStationQuery(lat, lon, radiusM = 2000) {
  const around = `around:${radiusM},${lat},${lon}`;
  return (
    `[out:json][timeout:25];` +
    `(` +
    `node["public_transport"="stop_position"](${around});` +
    `node["railway"="station"](${around});` +
    `node["railway"="halt"](${around});` +
    `node["amenity"="bus_station"](${around});` +
    `);` +
    `out body;`
  );
}

/**
 * Haversine great-circle distance in kilometres.
 * Used locally to pick the nearest Overpass node without importing from the
 * server layer (which is a separate deployment unit).
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const a = sinDLat * sinDLat
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch the nearest transit station to the hider's current position.
 * Steps: (1) call the managed server's hider-position endpoint to get lat/lon,
 * (2) query the OSM Overpass API for transit stops within 2 km,
 * (3) pick the closest node by haversine distance.
 *
 * Returns nulls on any failure (no hider position, Overpass error, no stations found).
 *
 * @param {{ gameId: string }} params
 * @param {string|undefined} gameServerUrl
 * @param {string|null} adminApiKey
 * @param {typeof fetch} fetchFn  Used for BOTH the hider-position call and Overpass.
 * @returns {Promise<{ nearestStationName: string|null, nearestStationLat: number|null, nearestStationLon: number|null, nearestStationDistanceKm: number|null }>}
 */
async function fetchTransitData({ gameId }, gameServerUrl, adminApiKey, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
  const nullResult = { nearestStationName: null, nearestStationLat: null, nearestStationLon: null, nearestStationDistanceKm: null };
  if (!serverUrl || !fetchFn || !key) return nullResult;
  try {
    // Step 1: get hider's current position from managed server.
    const posRes = await fetchFn(
      `${serverUrl}/internal/games/${gameId}/hider-position`,
      { headers: { 'Authorization': `Bearer ${key}` } },
    );
    if (!posRes.ok) return nullResult;
    const { lat, lon } = await posRes.json();
    if (lat == null || lon == null) return nullResult;

    // Step 2: query Overpass for nearby transit stations.
    const query = buildNearestStationQuery(lat, lon);
    const overpassRes = await fetchFn(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!overpassRes.ok) return nullResult;
    const data = await overpassRes.json();
    const nodes = (data?.elements ?? []).filter(el => el.type === 'node');
    if (nodes.length === 0) return nullResult;

    // Step 3: find nearest node.
    let nearest = null;
    let nearestDist = Infinity;
    for (const node of nodes) {
      const dist = haversineDistanceKm(lat, lon, node.lat, node.lon);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = node;
      }
    }
    return {
      nearestStationName:       nearest.tags?.name ?? nearest.tags?.['name:en'] ?? 'Unknown Station',
      nearestStationLat:        nearest.lat,
      nearestStationLon:        nearest.lon,
      nearestStationDistanceKm: nearestDist,
    };
  } catch {
    return nullResult;
  }
}

/** Valid feature types for matching questions. */
export const VALID_FEATURE_TYPES = ['airport', 'train_station', 'bus_station', 'ferry_terminal', 'university', 'hospital'];

/**
 * Overpass QL node clause per feature type.
 * Each value is inserted into `node[...](around:<radius>,<lat>,<lon>)`.
 */
const FEATURE_TYPE_QUERIES = {
  airport:        '"aeroway"="aerodrome"',
  train_station:  '"railway"="station"',
  bus_station:    '"amenity"="bus_station"',
  ferry_terminal: '"amenity"="ferry_terminal"',
  university:     '"amenity"="university"',
  hospital:       '"amenity"="hospital"',
};

/** Search radius in metres per feature type. */
const FEATURE_RADIUS_M = {
  airport:        50_000,
  train_station:   5_000,
  bus_station:     5_000,
  ferry_terminal:  5_000,
  university:      5_000,
  hospital:        5_000,
};

/**
 * Fetch the nearest OSM feature of a given type to a lat/lon via Overpass.
 * Returns `{ id: number, name: string }` or `null` on any failure / no results.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string} featureType  One of VALID_FEATURE_TYPES.
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ id: number, name: string }|null>}
 */
async function fetchNearestFeature(lat, lon, featureType, fetchFn) {
  const clause = FEATURE_TYPE_QUERIES[featureType];
  if (!clause) return null;
  const radiusM = FEATURE_RADIUS_M[featureType] ?? 5_000;
  const around  = `around:${radiusM},${lat},${lon}`;
  const query   = `[out:json][timeout:25];node[${clause}](${around});out body;`;
  try {
    const overpassRes = await fetchFn(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!overpassRes.ok) return null;
    const data = await overpassRes.json();
    const nodes = (data?.elements ?? []).filter(el => el.type === 'node');
    if (nodes.length === 0) return null;
    // Pick nearest node by haversine distance.
    let nearest = null;
    let nearestDist = Infinity;
    for (const node of nodes) {
      const dist = haversineDistanceKm(lat, lon, node.lat, node.lon);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = node;
      }
    }
    return {
      id:   nearest.id,
      name: nearest.tags?.name ?? nearest.tags?.['name:en'] ?? featureType,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch matching data: get both players' positions, find nearest feature of
 * the requested type for each, and compare by OSM node ID.
 *
 * Returns nulls on any failure (missing server config, positions unavailable,
 * Overpass error).  Failures are silent — the question is still created.
 *
 * @param {{ gameId: string, seekerId: string, featureType: string }} params
 * @param {string|undefined} gameServerUrl
 * @param {string|null} adminApiKey
 * @param {typeof fetch} fetchFn  Used for both the positions call and Overpass.
 * @returns {Promise<{ matchingHiderFeatureName: string|null, matchingSeekerFeatureName: string|null, matchingFeaturesMatch: boolean|null }>}
 */
async function fetchMatchingData({ gameId, seekerId, featureType }, gameServerUrl, adminApiKey, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
  const nullResult = { matchingHiderFeatureName: null, matchingSeekerFeatureName: null, matchingFeaturesMatch: null };
  if (!serverUrl || !fetchFn || !key) return nullResult;
  if (!VALID_FEATURE_TYPES.includes(featureType)) return nullResult;
  try {
    const posRes = await fetchFn(
      `${serverUrl}/internal/games/${gameId}/matching?seekerId=${encodeURIComponent(seekerId)}`,
      { headers: { 'Authorization': `Bearer ${key}` } },
    );
    if (!posRes.ok) return nullResult;
    const { hiderLat, hiderLon, seekerLat, seekerLon } = await posRes.json();
    if (hiderLat == null || hiderLon == null || seekerLat == null || seekerLon == null) {
      return nullResult;
    }
    const [hiderFeature, seekerFeature] = await Promise.all([
      fetchNearestFeature(hiderLat, hiderLon, featureType, fetchFn),
      fetchNearestFeature(seekerLat, seekerLon, featureType, fetchFn),
    ]);
    const matchingHiderFeatureName  = hiderFeature?.name  ?? null;
    const matchingSeekerFeatureName = seekerFeature?.name ?? null;
    const matchingFeaturesMatch = (hiderFeature != null && seekerFeature != null)
      ? hiderFeature.id === seekerFeature.id
      : null;
    return { matchingHiderFeatureName, matchingSeekerFeatureName, matchingFeaturesMatch };
  } catch {
    return nullResult;
  }
}

// ── In-process stores (no DB pool) ───────────────────────────────────────────

const _questions = new Map();
const _answers   = new Map();
const _photos    = new Map(); // Map<questionId, { photoId, questionId, photoData, uploadedAt }>

/**
 * Per-game team membership for the in-process path.
 * Keyed `${gameId}:${playerId}` → team string (e.g. 'A' or 'B').
 * Set this in tests to simulate two-team games.
 */
export const _teamMemberships = new Map();

/** Return a copy of the in-process question store (for testing). */
export function _getQuestionStore() { return new Map(_questions); }

/** Return a copy of the in-process answer store (for testing). */
export function _getAnswerStore() { return new Map(_answers); }

/** Return a copy of the in-process photo store (for testing). */
export function _getPhotoStore() { return new Map(_photos); }

/** Clear all in-process stores (for test isolation). */
export function _clearStores() { _questions.clear(); _answers.clear(); _photos.clear(); _teamMemberships.clear(); }

/** Set the status of an in-process question (for testing expiry/answered scenarios). */
export function _setQuestionStatus(questionId, status) {
  const q = _questions.get(questionId);
  if (q) _questions.set(questionId, { ...q, status });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: notify the managed server that a new pending question exists
 * so it can broadcast a `question_pending` WS event with the expiry deadline.
 */
function notifyQuestionPending({ gameId, questionId, expiresAt }, gameServerUrl, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
    Promise.resolve(fetchFn(`${serverUrl}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'question_pending', gameId, questionId, expiresAt }),
    })).catch(() => { /* intentionally silent */ });
  }
}

/**
 * Fetch thermometer distances from the managed server.
 * Returns `{ currentDistanceM, previousDistanceM }` with nulls on any failure.
 * Failures are silent — the question is still created with null distances.
 *
 * @param {{ gameId: string, seekerId: string }} params
 * @param {string|undefined} gameServerUrl
 * @param {string|null} adminApiKey
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ currentDistanceM: number|null, previousDistanceM: number|null }>}
 */
async function fetchThermometerData({ gameId, seekerId }, gameServerUrl, adminApiKey, fetchFn) {
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
  if (!serverUrl || !fetchFn || !key) {
    return { currentDistanceM: null, previousDistanceM: null };
  }
  try {
    const res = await fetchFn(
      `${serverUrl}/internal/games/${gameId}/thermometer?seekerId=${encodeURIComponent(seekerId)}`,
      { headers: { 'Authorization': `Bearer ${key}` } },
    );
    const data = await res.json();
    return {
      currentDistanceM:  data.currentDistanceM  ?? null,
      previousDistanceM: data.previousDistanceM ?? null,
    };
  } catch {
    return { currentDistanceM: null, previousDistanceM: null };
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /questions
 * Body: { gameId, askerId, targetId, category, text, gameScale? }
 *
 * `gameScale` is optional. When provided for photo questions it is used to
 * compute the correct answer deadline (small → 10 min, medium → 15 min,
 * large → 20 min). When omitted the DB path joins with `games` to derive
 * the scale; the in-process path falls back to 15 min.
 *
 * @param {{ method: string, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]  Override for GAME_SERVER_URL env var.
 * @param {typeof fetch} [fetchFn]  Injectable fetch (tests / local dev).
 * @param {string|null} [adminApiKey]  Override for ADMIN_API_KEY env var (thermometer auth).
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function submitQuestion(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch, adminApiKey = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { gameId, askerId, targetId, category, text, gameScale,
          tentacleTargetLat, tentacleTargetLon, tentacleRadiusKm,
          measuringTargetLat, measuringTargetLon,
          matchingFeatureType,
        } = req.body ?? {};

  if (!gameId   || typeof gameId   !== 'string') return { status: 400, body: { error: 'gameId is required' } };
  if (!askerId  || typeof askerId  !== 'string') return { status: 400, body: { error: 'askerId is required' } };
  if (!targetId || typeof targetId !== 'string') return { status: 400, body: { error: 'targetId is required' } };
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return { status: 400, body: { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` } };
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { status: 400, body: { error: 'text is required' } };
  }

  if (pool) {
    // Async DB path — always returns a Promise.
    const thermometerFetch = category === 'thermometer'
      ? fetchThermometerData({ gameId, seekerId: askerId }, gameServerUrl, adminApiKey, fetchFn)
      : Promise.resolve({ currentDistanceM: null, previousDistanceM: null });

    const tentacleFetch = (category === 'tentacle'
        && tentacleTargetLat != null && tentacleTargetLon != null && tentacleRadiusKm != null)
      ? fetchTentacleData({ gameId, targetLat: tentacleTargetLat, targetLon: tentacleTargetLon, radiusKm: tentacleRadiusKm }, gameServerUrl, adminApiKey, fetchFn)
      : Promise.resolve({ withinRadius: null, distanceKm: null });

    const measuringFetch = (category === 'measuring'
        && measuringTargetLat != null && measuringTargetLon != null)
      ? fetchMeasuringData({ gameId, seekerId: askerId, targetLat: measuringTargetLat, targetLon: measuringTargetLon }, gameServerUrl, adminApiKey, fetchFn)
      : Promise.resolve({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });

    const transitFetch = category === 'transit'
      ? fetchTransitData({ gameId }, gameServerUrl, adminApiKey, fetchFn)
      : Promise.resolve({ nearestStationName: null, nearestStationLat: null, nearestStationLon: null, nearestStationDistanceKm: null });

    const matchingFetch = (category === 'matching' && matchingFeatureType != null)
      ? fetchMatchingData({ gameId, seekerId: askerId, featureType: matchingFeatureType }, gameServerUrl, adminApiKey, fetchFn)
      : Promise.resolve({ matchingHiderFeatureName: null, matchingSeekerFeatureName: null, matchingFeaturesMatch: null });

    return dbGetCurseExpiry(pool, gameId).then(curseExpiry => {
      if (curseExpiry && new Date(curseExpiry) > new Date()) {
        return { status: 409, body: { error: 'curse_active', curseEndsAt: curseExpiry } };
      }
      return Promise.all([thermometerFetch, tentacleFetch, measuringFetch, transitFetch, matchingFetch]).then(([td, tent, meas, trans, match]) =>
        dbCreateQuestion(pool, {
          gameId, askerId, targetId, category, text, gameScale,
          thermometerCurrentDistanceM:  td.currentDistanceM,
          thermometerPreviousDistanceM: td.previousDistanceM,
          tentacleTargetLat:    tentacleTargetLat  ?? null,
          tentacleTargetLon:    tentacleTargetLon  ?? null,
          tentacleRadiusKm:     tentacleRadiusKm   ?? null,
          tentacleDistanceKm:   tent.distanceKm    ?? null,
          tentacleWithinRadius: tent.withinRadius   ?? null,
          measuringTargetLat:       measuringTargetLat       ?? null,
          measuringTargetLon:       measuringTargetLon       ?? null,
          measuringHiderDistanceKm:  meas.hiderDistanceKm    ?? null,
          measuringSeekerDistanceKm: meas.seekerDistanceKm   ?? null,
          measuringHiderIsCloser:    meas.hiderIsCloser       ?? null,
          transitNearestStationName:       trans.nearestStationName       ?? null,
          transitNearestStationLat:        trans.nearestStationLat        ?? null,
          transitNearestStationLon:        trans.nearestStationLon        ?? null,
          transitNearestStationDistanceKm: trans.nearestStationDistanceKm ?? null,
          matchingFeatureType:       matchingFeatureType ?? null,
          matchingHiderFeatureName:  match.matchingHiderFeatureName  ?? null,
          matchingSeekerFeatureName: match.matchingSeekerFeatureName ?? null,
          matchingFeaturesMatch:     match.matchingFeaturesMatch     ?? null,
        }).then(row => {
          if (row.conflict) return { status: 409, body: { error: 'A pending question already exists for this game' } };
          notifyQuestionPending({ gameId, questionId: row.questionId, expiresAt: row.expiresAt }, gameServerUrl, fetchFn);
          return { status: 201, body: row };
        }),
      );
    });
  }

  // Check for an active curse in the in-process store.
  const curseEndsAt = _curses.get(gameId);
  if (curseEndsAt && new Date(curseEndsAt) > new Date()) {
    return { status: 409, body: { error: 'curse_active', curseEndsAt } };
  }

  // Enforce one-pending-question-at-a-time per game in the in-process store.
  const hasPending = [..._questions.values()].some(
    q => q.gameId === gameId && q.status === 'pending',
  );
  if (hasPending) {
    return { status: 409, body: { error: 'A pending question already exists for this game' } };
  }

  // notifyFetch is the fetch function used for question_pending notification.
  // For thermometer/tentacle questions, the injected fetchFn is reserved for the
  // data endpoint; the notify uses globalThis.fetch so the two are not conflated in tests.
  const _buildInProcessQuestion = (
    thermometerCurrentDistanceM, thermometerPreviousDistanceM,
    tentacleOpts = {},
    notifyFetch = fetchFn,
    measuringOpts = {},
    transitOpts = {},
    matchingOpts = {},
  ) => {
    const expiresAt = new Date(Date.now() + computeExpiryMs(gameScale, category)).toISOString();
    const question = {
      questionId: randomUUID(),
      gameId,
      askerId,
      targetId,
      category,
      text: text.trim(),
      status: 'pending',
      expiresAt,
      createdAt: new Date().toISOString(),
      thermometerCurrentDistanceM,
      thermometerPreviousDistanceM,
      tentacleTargetLat:    tentacleOpts.targetLat    ?? null,
      tentacleTargetLon:    tentacleOpts.targetLon    ?? null,
      tentacleRadiusKm:     tentacleOpts.radiusKm     ?? null,
      tentacleDistanceKm:   tentacleOpts.distanceKm   ?? null,
      tentacleWithinRadius: tentacleOpts.withinRadius  ?? null,
      measuringTargetLat:       measuringOpts.targetLat        ?? null,
      measuringTargetLon:       measuringOpts.targetLon        ?? null,
      measuringHiderDistanceKm:  measuringOpts.hiderDistanceKm  ?? null,
      measuringSeekerDistanceKm: measuringOpts.seekerDistanceKm ?? null,
      measuringHiderIsCloser:    measuringOpts.hiderIsCloser    ?? null,
      transitNearestStationName:       transitOpts.nearestStationName       ?? null,
      transitNearestStationLat:        transitOpts.nearestStationLat        ?? null,
      transitNearestStationLon:        transitOpts.nearestStationLon        ?? null,
      transitNearestStationDistanceKm: transitOpts.nearestStationDistanceKm ?? null,
      matchingFeatureType:       matchingOpts.featureType        ?? null,
      matchingHiderFeatureName:  matchingOpts.hiderFeatureName   ?? null,
      matchingSeekerFeatureName: matchingOpts.seekerFeatureName  ?? null,
      matchingFeaturesMatch:     matchingOpts.featuresMatch      ?? null,
    };
    _questions.set(question.questionId, question);
    notifyQuestionPending({ gameId, questionId: question.questionId, expiresAt: question.expiresAt }, gameServerUrl, notifyFetch);
    return { status: 201, body: question };
  };

  if (category === 'thermometer') {
    const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
    const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
    if (serverUrl && fetchFn && key) {
      // Async path: fetch thermometer data then build the question.
      // Use globalThis.fetch for the notify so the caller's fetchFn is dedicated
      // to the thermometer endpoint (one call per submit, easier to test).
      return fetchThermometerData({ gameId, seekerId: askerId }, gameServerUrl, adminApiKey, fetchFn)
        .then(td => _buildInProcessQuestion(td.currentDistanceM, td.previousDistanceM, {}, globalThis.fetch));
    }
    // No server configured — build synchronously with null distances.
    return _buildInProcessQuestion(null, null);
  }

  if (category === 'tentacle'
      && tentacleTargetLat != null && tentacleTargetLon != null && tentacleRadiusKm != null) {
    const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
    const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
    if (serverUrl && fetchFn && key) {
      return fetchTentacleData(
        { gameId, targetLat: tentacleTargetLat, targetLon: tentacleTargetLon, radiusKm: tentacleRadiusKm },
        gameServerUrl, adminApiKey, fetchFn,
      ).then(tent => _buildInProcessQuestion(null, null, {
        targetLat:    tentacleTargetLat,
        targetLon:    tentacleTargetLon,
        radiusKm:     tentacleRadiusKm,
        distanceKm:   tent.distanceKm,
        withinRadius: tent.withinRadius,
      }, globalThis.fetch));
    }
    // No server configured — build with stored coords but null computed fields.
    return _buildInProcessQuestion(null, null, {
      targetLat:    tentacleTargetLat,
      targetLon:    tentacleTargetLon,
      radiusKm:     tentacleRadiusKm,
      distanceKm:   null,
      withinRadius: null,
    });
  }

  if (category === 'measuring'
      && measuringTargetLat != null && measuringTargetLon != null) {
    const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
    const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
    if (serverUrl && fetchFn && key) {
      return fetchMeasuringData(
        { gameId, seekerId: askerId, targetLat: measuringTargetLat, targetLon: measuringTargetLon },
        gameServerUrl, adminApiKey, fetchFn,
      ).then(meas => _buildInProcessQuestion(null, null, {}, globalThis.fetch, {
        targetLat:        measuringTargetLat,
        targetLon:        measuringTargetLon,
        hiderDistanceKm:  meas.hiderDistanceKm,
        seekerDistanceKm: meas.seekerDistanceKm,
        hiderIsCloser:    meas.hiderIsCloser,
      }));
    }
    // No server configured — build with stored coords but null computed fields.
    return _buildInProcessQuestion(null, null, {}, fetchFn, {
      targetLat:        measuringTargetLat,
      targetLon:        measuringTargetLon,
      hiderDistanceKm:  null,
      seekerDistanceKm: null,
      hiderIsCloser:    null,
    });
  }

  if (category === 'transit') {
    const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
    const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
    if (serverUrl && fetchFn && key) {
      return fetchTransitData({ gameId }, gameServerUrl, adminApiKey, fetchFn)
        .then(trans => _buildInProcessQuestion(null, null, {}, globalThis.fetch, {}, {
          nearestStationName:       trans.nearestStationName,
          nearestStationLat:        trans.nearestStationLat,
          nearestStationLon:        trans.nearestStationLon,
          nearestStationDistanceKm: trans.nearestStationDistanceKm,
        }));
    }
    // No server configured — build with null transit fields.
    return _buildInProcessQuestion(null, null, {}, fetchFn, {}, {});
  }

  if (category === 'matching' && matchingFeatureType != null) {
    const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
    const key = adminApiKey ?? process.env.ADMIN_API_KEY ?? null;
    if (serverUrl && fetchFn && key) {
      return fetchMatchingData(
        { gameId, seekerId: askerId, featureType: matchingFeatureType },
        gameServerUrl, adminApiKey, fetchFn,
      ).then(match => _buildInProcessQuestion(null, null, {}, globalThis.fetch, {}, {}, {
        featureType:       matchingFeatureType,
        hiderFeatureName:  match.matchingHiderFeatureName,
        seekerFeatureName: match.matchingSeekerFeatureName,
        featuresMatch:     match.matchingFeaturesMatch,
      }));
    }
    // No server configured — build with stored featureType but null computed fields.
    return _buildInProcessQuestion(null, null, {}, fetchFn, {}, {}, {
      featureType:       matchingFeatureType,
      hiderFeatureName:  null,
      seekerFeatureName: null,
      featuresMatch:     null,
    });
  }

  return _buildInProcessQuestion(null, null);
}

/**
 * GET /questions?playerId= | GET /questions?gameId=
 *
 * When `gameId` is provided, returns all Q&A pairs for the game (seeker history).
 * When `playerId` is provided, returns questions addressed to that player (hider inbox).
 * At least one of the two params must be present.
 *
 * @param {{ method: string, query?: Record<string, string> }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function listQuestions(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { playerId, gameId, teamId } = req.query ?? {};

  // ── gameId path: full Q&A history for a game ─────────────────────────────
  if (gameId && typeof gameId === 'string') {
    const resolvedTeamId = (teamId && typeof teamId === 'string') ? teamId : null;
    if (pool) {
      return dbGetQuestionsForGame(pool, gameId, resolvedTeamId).then(questions => ({
        status: 200,
        body: { gameId, questions },
      }));
    }
    // In-process: build history by joining _questions and _answers.
    const questions = [..._questions.values()]
      .filter(q => {
        if (q.gameId !== gameId) return false;
        if (resolvedTeamId) {
          return _teamMemberships.get(`${gameId}:${q.askerId}`) === resolvedTeamId;
        }
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(q => {
        const answer = [..._answers.values()].find(a => a.questionId === q.questionId) ?? null;
        return {
          ...q,
          answer: answer ? { text: answer.text, createdAt: answer.createdAt } : null,
        };
      });
    return { status: 200, body: { gameId, questions } };
  }

  // ── playerId path: hider inbox ────────────────────────────────────────────
  if (!playerId || typeof playerId !== 'string') {
    return { status: 400, body: { error: 'playerId or gameId query parameter is required' } };
  }

  if (pool) {
    return dbGetQuestionsForPlayer(pool, playerId).then(questions => ({
      status: 200,
      body: { playerId, questions },
    }));
  }

  const questions = [..._questions.values()]
    .filter(q => q.targetId === playerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { status: 200, body: { playerId, questions } };
}

/**
 * POST /answers/:questionId
 * Body: { responderId, text }
 *
 * After persisting the answer, fires a fire-and-forget HTTP POST to
 * GAME_SERVER_URL/internal/notify so the managed server can broadcast
 * a `question_answered` event to connected seekers.
 *
 * @param {{ method: string, params: { questionId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]  Override for GAME_SERVER_URL env var.
 * @param {typeof fetch} [fetchFn]  Injectable fetch (tests / local dev).
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export async function submitAnswer(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { questionId } = req.params ?? {};
  if (!questionId || typeof questionId !== 'string') {
    return { status: 400, body: { error: 'questionId param is required' } };
  }

  const { responderId, text } = req.body ?? {};
  if (!responderId || typeof responderId !== 'string') {
    return { status: 400, body: { error: 'responderId is required' } };
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { status: 400, body: { error: 'text is required' } };
  }

  let answer;
  let gameId = null;

  // Resolve the server URL early so both card-draw and question-answered notifies can use it.
  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;

  if (pool) {
    const row = await dbSubmitAnswer(pool, { questionId, responderId, text: text.trim() });
    if (!row) return { status: 404, body: { error: 'question not found' } };
    if (row.questionExpired) return { status: 409, body: { error: 'question_expired' } };
    answer = row;

    // Draw a card for the answering player (fire-and-forget; hand-full is silently ignored).
    // When the draw succeeds, notify the managed server so the hider's CardPanel can refresh.
    if (row.gameId) {
      gameId = row.gameId;
      const { type, effect } = randomCardDescriptor();
      dbDrawCard(pool, { gameId: row.gameId, playerId: responderId, type, effect })
        .then((drawnCard) => {
          if (drawnCard && serverUrl && fetchFn) {
            fetchFn(`${serverUrl}/internal/notify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'card_drawn',
                gameId: drawnCard.gameId,
                playerId: responderId,
                cardId: drawnCard.cardId,
                cardType: drawnCard.type,
              }),
            }).catch(() => { /* intentionally silent */ });
          }
        })
        .catch(() => { /* silent */ });
    }
  } else {
    if (!_questions.has(questionId)) {
      return { status: 404, body: { error: 'question not found' } };
    }
    const question = _questions.get(questionId);
    if (question.status !== 'pending') {
      return { status: 409, body: { error: 'question_expired' } };
    }
    gameId = question.gameId ?? null;
    answer = {
      answerId: randomUUID(),
      questionId,
      responderId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    _answers.set(answer.answerId, answer);
    _questions.set(questionId, { ...question, status: 'answered' });

    // Draw a card for the answering player in the in-process store.
    // When the draw succeeds, notify the managed server so the hider's CardPanel can refresh.
    if (gameId) {
      const drawnCard = drawCardInProcess({ gameId, playerId: responderId });
      if (drawnCard && serverUrl && fetchFn) {
        fetchFn(`${serverUrl}/internal/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'card_drawn',
            gameId,
            playerId: responderId,
            cardId: drawnCard.cardId,
            cardType: drawnCard.type,
          }),
        }).catch(() => { /* intentionally silent */ });
      }
    }
  }

  // Fire-and-forget: notify managed server to broadcast to seekers.
  if (serverUrl && fetchFn) {
    fetchFn(`${serverUrl}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'question_answered',
        questionId,
        answerId: answer.answerId,
        responderId,
        gameId,
      }),
    }).catch(() => { /* intentionally silent */ });
  }

  return { status: 201, body: answer };
}

/**
 * POST /questions/:questionId/photo
 * Body: { photoData } — base64-encoded image string.
 *
 * Stores the photo associated with a question. Idempotent: re-uploading
 * replaces the previous photo.
 *
 * @param {{ method: string, params: { questionId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export async function uploadQuestionPhoto(req, pool = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { questionId } = req.params ?? {};
  if (!questionId || typeof questionId !== 'string') {
    return { status: 400, body: { error: 'questionId param is required' } };
  }

  const { photoData } = req.body ?? {};
  if (!photoData || typeof photoData !== 'string' || !photoData.trim()) {
    return { status: 400, body: { error: 'photoData is required' } };
  }

  if (typeof photoData === 'string' && photoData.length > MAX_PHOTO_BASE64_LEN) {
    return { status: 413, body: { error: 'Photo exceeds 500 KB limit' } };
  }

  if (pool) {
    const photo = await dbSaveQuestionPhoto(pool, { questionId, photoData: photoData.trim() });
    return { status: 201, body: photo };
  }

  // In-process store: verify question exists.
  if (!_questions.has(questionId)) {
    return { status: 404, body: { error: 'question not found' } };
  }
  const photo = {
    photoId: randomUUID(),
    questionId,
    photoData: photoData.trim(),
    uploadedAt: new Date().toISOString(),
  };
  _photos.set(questionId, photo);
  return { status: 201, body: { photoId: photo.photoId, questionId, uploadedAt: photo.uploadedAt } };
}

/**
 * GET /questions/:questionId/photo
 *
 * Returns the photo record for a question, or 404 if no photo has been uploaded.
 *
 * @param {{ method: string, params: { questionId: string } }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export async function getQuestionPhoto(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { questionId } = req.params ?? {};
  if (!questionId || typeof questionId !== 'string') {
    return { status: 400, body: { error: 'questionId param is required' } };
  }

  if (pool) {
    const photo = await dbGetQuestionPhoto(pool, questionId);
    if (!photo) return { status: 404, body: { error: 'photo not found' } };
    return { status: 200, body: photo };
  }

  const photo = _photos.get(questionId);
  if (!photo) return { status: 404, body: { error: 'photo not found' } };
  return { status: 200, body: photo };
}
