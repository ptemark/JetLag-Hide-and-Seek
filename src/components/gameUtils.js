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
  const lonDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)));
  return {
    lat_min: lat - latDelta,
    lat_max: lat + latDelta,
    lon_min: lon - lonDelta,
    lon_max: lon + lonDelta,
  };
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
