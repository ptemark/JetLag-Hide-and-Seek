/**
 * Shared hint-derivation functions for computed question data.
 * Used by both AnswerPanel (hider view) and QuestionPanel (seeker history).
 */

/**
 * Derive the tentacle result label from proximity data.
 * @param {boolean|null} withinRadius
 * @param {number|null} distanceKm
 * @returns {string}
 */
export function tentacleHint(withinRadius, distanceKm) {
  if (withinRadius === true)  return `Tentacle hint: within radius — ${distanceKm.toFixed(2)} km away`;
  if (withinRadius === false) return `Tentacle hint: outside radius — ${distanceKm.toFixed(2)} km away`;
  return 'Tentacle hint: unknown — position unavailable';
}

/**
 * Derive the measuring result label from hider/seeker distance comparison.
 * @param {boolean|null} hiderIsCloser
 * @param {number|null} hiderDistanceKm
 * @param {number|null} seekerDistanceKm
 * @returns {string}
 */
export function measuringHint(hiderIsCloser, hiderDistanceKm, seekerDistanceKm) {
  if (hiderIsCloser === true)  return `Measuring hint: hider is closer — hider ${hiderDistanceKm.toFixed(2)} km, seeker ${seekerDistanceKm.toFixed(2)} km`;
  if (hiderIsCloser === false) return `Measuring hint: seeker is closer — hider ${hiderDistanceKm.toFixed(2)} km, seeker ${seekerDistanceKm.toFixed(2)} km`;
  return 'Measuring hint: unknown — position unavailable';
}

/**
 * Derive the matching result label from feature comparison data.
 * @param {boolean|null} featuresMatch
 * @param {string|null} featureType
 * @param {string|null} hiderFeatureName
 * @param {string|null} seekerFeatureName
 * @returns {string}
 */
export function matchingHint(featuresMatch, featureType, hiderFeatureName, seekerFeatureName) {
  if (featuresMatch === true)  return `Matching hint: same ${featureType} — both nearest to ${hiderFeatureName}`;
  if (featuresMatch === false) return `Matching hint: different ${featureType} — hider: ${hiderFeatureName}, seeker: ${seekerFeatureName}`;
  return 'Matching hint: unknown — position unavailable';
}

/**
 * Derive the transit hint label from nearest station data.
 * @param {string|null} nearestStationName
 * @param {number|null} nearestStationDistanceKm
 * @returns {string}
 */
export function transitHint(nearestStationName, nearestStationDistanceKm) {
  if (nearestStationName != null) {
    return `Transit hint: nearest station is ${nearestStationName} — ${nearestStationDistanceKm.toFixed(2)} km away`;
  }
  return 'Transit hint: unknown — position unavailable';
}

/**
 * Derive the thermometer result label from two distance readings.
 * @param {number|null} current - distance in metres at question time
 * @param {number|null} previous - distance in metres one location update earlier
 * @returns {string}
 */
export function thermometerHint(current, previous) {
  if (current == null || previous == null) {
    return 'Thermometer hint: unknown — position unavailable';
  }
  if (current < previous) return 'Thermometer hint: warmer — you moved closer';
  if (current > previous) return 'Thermometer hint: colder — you moved further away';
  return 'Thermometer hint: same — no distance change';
}
