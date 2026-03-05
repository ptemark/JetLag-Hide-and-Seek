/**
 * env.js — Runtime environment configuration for JetLag: The Game
 *
 * In the browser (Vite SPA) variables are read from import.meta.env.
 * In serverless functions (Node.js) variables are read from process.env.
 * Calling getEnvVar() handles both contexts transparently.
 *
 * All keys should be documented in .env.example at the project root.
 */

function getEnvVar(key, defaultValue = '') {
  // Browser context (Vite inlines VITE_* at build time)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key] ?? defaultValue;
  }
  // Node.js context (serverless functions)
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] ?? defaultValue;
  }
  return defaultValue;
}

function parseBool(value, fallback = false) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

const ENV = {
  /** Current environment name: development | staging | production */
  name: getEnvVar('VITE_ENV', 'development'),

  /** Base URL for serverless API functions */
  apiBaseUrl: getEnvVar('VITE_API_BASE_URL', 'http://localhost:3001'),

  /** WebSocket URL for the managed game-loop container */
  wsUrl: getEnvVar('VITE_WS_URL', 'ws://localhost:3002'),

  /** Map tile provider: 'osm' (default, $0) or 'google' */
  mapsProvider: getEnvVar('VITE_MAPS_PROVIDER', 'osm'),

  /** Optional Google Maps API key (only used when mapsProvider === 'google') */
  googleMapsApiKey: getEnvVar('VITE_GOOGLE_MAPS_API_KEY', ''),

  features: {
    /** Enable experimental two-team seeker mode */
    twoTeams: parseBool(getEnvVar('VITE_FEATURE_TWO_TEAMS', 'false')),

    /** Enable admin dashboard route */
    adminDashboard: parseBool(getEnvVar('VITE_FEATURE_ADMIN_DASHBOARD', 'false')),

    /** Enable GPS real-time tracking overlay */
    gpsTracking: parseBool(getEnvVar('VITE_FEATURE_GPS_TRACKING', 'true')),
  },
};

export { ENV, getEnvVar, parseBool };
