// Earth's mean radius in km (WGS-84 approximation).
const EARTH_RADIUS_KM = 6371;

/**
 * Convert a km distance to degrees of longitude at a given latitude.
 * Used to position the east-edge resize handle on the preview map.
 *
 * @param {number} km  - Distance in kilometres.
 * @param {number} lat - Latitude in decimal degrees.
 * @returns {number}   - Equivalent longitude delta in degrees.
 */
export function lonDeltaDeg(km, lat) {
  return km / (111 * Math.cos(lat * (Math.PI / 180)));
}

/**
 * Compute the great-circle distance in kilometres between two lat/lon points
 * using the Haversine formula.
 *
 * @param {{ lat: number, lon: number }} a - First point.
 * @param {{ lat: number, lon: number }} b - Second point.
 * @returns {number} Distance in kilometres.
 */
export function haversineKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }) {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Compute the great-circle distance in metres between two lat/lon points.
 * Delegates to haversineKm to avoid duplicating the Haversine formula.
 *
 * Used to determine whether the hider is inside their hiding zone during the
 * seeking phase (RULES.md §Hiding Rules rule 3; §Definitions — Hiding Zone:
 * 500 m for Small/Medium, 1 km for Large).
 *
 * @param {{ lat: number, lon: number }} a - First point.
 * @param {{ lat: number, lon: number }} b - Second point.
 * @returns {number} Distance in metres.
 */
export function haversineDistanceM(a, b) {
  return haversineKm(a, b) * 1000;
}

/**
 * Convert a centre point + radius to an axis-aligned bounding box.
 *
 * @param {{ lat: number, lon: number }} center - Centre of the zone.
 * @param {number} radiusKm                     - Zone radius in kilometres.
 * @returns {{ lat_min: number, lat_max: number, lon_min: number, lon_max: number }}
 */
export function centerRadiusToBounds({ lat, lon }, radiusKm) {
  // 1 degree latitude ≈ 111 km everywhere.
  // 1 degree longitude ≈ 111 km * cos(lat) — shrinks toward the poles.
  const latDelta = radiusKm / 111;
  const lonDelta = lonDeltaDeg(radiusKm, lat);
  return {
    lat_min: lat - latDelta,
    lat_max: lat + latDelta,
    lon_min: lon - lonDelta,
    lon_max: lon + lonDelta,
  };
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * Used to display the hider's accumulated hiding time during gameplay
 * and on the ResultsScreen. (RULES.md §Winning: score = hiding time + bonuses)
 *
 * @param {number} ms  - Duration in milliseconds (non-negative).
 * @returns {string}   - "Xh Ym Zs", "Ym Zs", or "Zs".
 */
export function formatDuration(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0)  return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/**
 * Format an ISO timestamp as a MM:SS countdown from now.
 *
 * @param {string|null} iso  — ISO 8601 expiry timestamp, or null.
 * @returns {string|null}    — "M:SS" string, "0:00" if already expired, or null if no timestamp.
 */
export function formatCountdown(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return '0:00';
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
