/**
 * captureDetector.js — Proximity-based capture detection for the game loop.
 *
 * Each tick during the SEEKING phase the detector checks whether all seekers
 * with known locations are inside the hider's hiding zone. When they are, the
 * game is captured.
 *
 * Capture rules (RULES.md):
 *   1. Find the zone that currently contains the hider.
 *   2. All seekers with known locations must be within that zone's radius.
 *   3. Players whose lat/lon is null are excluded (location not yet reported).
 *   4. No hiders or no seekers with known locations → no capture.
 */

const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine distance between two latitude/longitude points.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in metres.
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Check whether all seekers with known locations are within the hider's zone.
 *
 * @param {object} gameState
 *   Snapshot from GameStateManager.getGameState():
 *   { gameId, status, players: { [playerId]: { lat, lon, role } } }
 * @param {Array<{ stationId: string, lat: number, lon: number, radiusM: number }>} zones
 *   Hiding zones for the game (from the zone calculation service).
 * @returns {{
 *   captured:      boolean,
 *   hiderZone:     object | null,
 *   seekersInZone: string[],
 * }}
 */
export function checkCapture(gameState, zones) {
  const empty = { captured: false, hiderZone: null, seekersInZone: [] };
  if (!gameState || !zones || zones.length === 0) return empty;

  const players = Object.entries(gameState.players ?? {});
  const hiders  = players.filter(([, p]) => p.role === 'hider'  && p.lat != null && p.lon != null);
  const seekers = players.filter(([, p]) => p.role === 'seeker' && p.lat != null && p.lon != null);

  if (hiders.length === 0 || seekers.length === 0) return empty;

  // Find the zone that contains the first hider.
  const [, hider] = hiders[0];
  const hiderZone = zones.find(
    (z) => haversineDistance(hider.lat, hider.lon, z.lat, z.lon) <= z.radiusM,
  ) ?? null;

  if (!hiderZone) return empty;

  // All seekers with known locations must be inside the same zone.
  const seekersInZone = seekers
    .filter(([, s]) => haversineDistance(s.lat, s.lon, hiderZone.lat, hiderZone.lon) <= hiderZone.radiusM)
    .map(([id]) => id);

  const captured = seekersInZone.length === seekers.length;

  return { captured, hiderZone, seekersInZone };
}
