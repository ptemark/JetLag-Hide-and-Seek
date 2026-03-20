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
