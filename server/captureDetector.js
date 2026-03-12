/**
 * captureDetector.js — Proximity-based capture detection for the game loop.
 *
 * Each tick during the SEEKING phase the detector checks whether all seekers
 * with known locations are inside the hider's hiding zone. When they are, the
 * game is captured.
 *
 * Capture rules (RULES.md):
 *   1. Find the zone that currently contains the hider.
 *   2. All seekers with known locations AND not on transit must be within that zone's radius.
 *   3. Players whose lat/lon is null are excluded (location not yet reported).
 *   4. Seekers with onTransit === true are excluded (they are still travelling).
 *   5. No hiders or no seekers with known locations → no capture.
 *
 * Two-phase End Game (RULES.md §End Game):
 *   Phase 1: All seekers enter the hiding zone (checkCapture).
 *   Phase 2: A seeker sends spot_hider; server calls checkSpot to verify the
 *            spotter is within spotRadiusM of the hider before finalising capture.
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
 * Check whether seekers have captured the hider.
 *
 * In single-team mode (seekerTeams = 0), all seekers with known locations
 * must be within the hider's zone simultaneously.
 *
 * In two-team mode (seekerTeams = 2), each team is evaluated independently.
 * The first team whose entire membership (with known locations) is inside the
 * zone wins.  The result includes a `captureTeam` field ('A', 'B', or null).
 *
 * @param {object} gameState
 *   Snapshot from GameStateManager.getGameState():
 *   { gameId, status, seekerTeams?: number, players: { [playerId]: { lat, lon, role, team } } }
 * @param {Array<{ stationId: string, lat: number, lon: number, radiusM: number }>} zones
 *   Hiding zones for the game (from the zone calculation service).
 * @returns {{
 *   captured:      boolean,
 *   hiderZone:     object | null,
 *   seekersInZone: string[],
 *   captureTeam:   string | null,
 * }}
 */
export function checkCapture(gameState, zones) {
  const empty = { captured: false, hiderZone: null, seekersInZone: [], captureTeam: null };
  if (!gameState || !zones || zones.length === 0) return empty;

  const players = Object.entries(gameState.players ?? {});
  const hiders  = players.filter(([, p]) => p.role === 'hider'  && p.lat != null && p.lon != null);
  // Exclude seekers on transit (onTransit === true) — same as null-location exclusion.
  const seekers = players.filter(([, p]) => p.role === 'seeker' && p.lat != null && p.lon != null && !p.onTransit);

  if (hiders.length === 0 || seekers.length === 0) return empty;

  // Find the zone that contains the first hider.
  const [, hider] = hiders[0];
  const hiderZone = zones.find(
    (z) => haversineDistance(hider.lat, hider.lon, z.lat, z.lon) <= z.radiusM,
  ) ?? null;

  if (!hiderZone) return empty;

  const inZone = (s) =>
    haversineDistance(s.lat, s.lon, hiderZone.lat, hiderZone.lon) <= hiderZone.radiusM;

  // Two-team mode: check each team independently.
  const seekerTeams = gameState.seekerTeams ?? 0;
  if (seekerTeams >= 2) {
    const teams = [...new Set(seekers.map(([, s]) => s.team).filter(Boolean))];
    for (const team of teams) {
      const teamSeekers = seekers.filter(([, s]) => s.team === team);
      if (teamSeekers.length === 0) continue;
      const inZoneIds = teamSeekers.filter(([, s]) => inZone(s)).map(([id]) => id);
      if (inZoneIds.length === teamSeekers.length) {
        return { captured: true, hiderZone, seekersInZone: inZoneIds, captureTeam: team };
      }
    }
    return { captured: false, hiderZone, seekersInZone: [], captureTeam: null };
  }

  // Single-team mode: all seekers must be in zone.
  const seekersInZone = seekers
    .filter(([, s]) => inZone(s))
    .map(([id]) => id);

  const captured = seekersInZone.length === seekers.length;
  return { captured, hiderZone, seekersInZone, captureTeam: null };
}

/**
 * Check whether a specific seeker (the "spotter") is within spotRadiusM of
 * the hider's last known location. Used for the second phase of End Game
 * capture: the spotter sends a `spot_hider` WS message and the server calls
 * this function to confirm physical proximity before finalising the game.
 *
 * @param {object} gameState
 *   Snapshot from GameStateManager.getGameState():
 *   { gameId, status, players: { [playerId]: { lat, lon, role } } }
 * @param {string} spotterId  Player ID of the seeker claiming to see the hider.
 * @param {number} spotRadiusM  Maximum metres between spotter and hider.
 * @returns {{
 *   spotted:  boolean,
 *   distance: number | null,
 *   hiderLat: number | null,
 *   hiderLon: number | null,
 * }}
 */
export function checkSpot(gameState, spotterId, spotRadiusM) {
  const empty = { spotted: false, distance: null, hiderLat: null, hiderLon: null };
  if (!gameState || !spotterId || spotRadiusM == null) return empty;

  const players = Object.entries(gameState.players ?? {});
  const hiders  = players.filter(([, p]) => p.role === 'hider'  && p.lat != null && p.lon != null);
  const spotter = gameState.players?.[spotterId];

  if (hiders.length === 0) return empty;
  if (!spotter || spotter.lat == null || spotter.lon == null) return empty;

  const [, hider] = hiders[0];
  const distance = haversineDistance(spotter.lat, spotter.lon, hider.lat, hider.lon);
  const spotted  = distance <= spotRadiusM;
  return { spotted, distance, hiderLat: hider.lat, hiderLon: hider.lon };
}
