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

function number(key, fallback) {
  const parsed = parseInt(getEnvVar(key, String(fallback)), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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

  /**
   * Database connection URL (server-side only; never exposed to the browser).
   * Format: postgresql://user:password@host/db?sslmode=require
   * Provider: Neon serverless Postgres (autoscales to zero, $0 idle).
   */
  database: {
    url: getEnvVar('DATABASE_URL', ''),
  },

  /**
   * Secret bearer token required to access the admin dashboard endpoint.
   * Server-side only — never exposed to the browser bundle.
   * Must be set in production; if empty, the admin endpoint returns 503.
   */
  adminApiKey: getEnvVar('ADMIN_API_KEY', ''),

  /**
   * Auto-scaling configuration (server-side only; never exposed to the browser).
   */
  autoScaling: {
    /** HTTP webhook URL for scale-up/scale-down events (empty = disabled). */
    webhookUrl:          getEnvVar('SCALE_WEBHOOK_URL', ''),
    /** Active game count at or above which scale-up fires (default 5). */
    scaleUpGames:        parseInt(getEnvVar('SCALE_UP_GAMES', '5'), 10),
    /** Connection count at or above which scale-up fires (default 20). */
    scaleUpConnections:  parseInt(getEnvVar('SCALE_UP_CONNECTIONS', '20'), 10),
    /** Active game count at or below which scale-down fires (default 0). */
    scaleDownGames:      parseInt(getEnvVar('SCALE_DOWN_GAMES', '0'), 10),
    /** Connection count at or below which scale-down fires (default 0). */
    scaleDownConnections: parseInt(getEnvVar('SCALE_DOWN_CONNECTIONS', '0'), 10),
    /** Minimum ms between consecutive events of the same direction (default 60 s). */
    cooldownMs:          parseInt(getEnvVar('SCALE_COOLDOWN_MS', '60000'), 10),
  },

  /**
   * Alerting configuration (server-side only; never exposed to the browser).
   */
  alerting: {
    /** HTTP webhook URL to POST alert payloads to (empty = disabled). */
    webhookUrl: getEnvVar('ALERT_WEBHOOK_URL', ''),
    /** Fire ERROR_RATE_HIGH when cumulative errors exceed this value. */
    errorThreshold: parseInt(getEnvVar('ALERT_ERROR_THRESHOLD', '10'), 10),
  },

  /**
   * End Game phase duration in milliseconds. When all seekers enter the hiding
   * zone, the End Game timer starts; if no seeker spots the hider before this
   * elapses, the hider wins. Default: 600 000 ms (10 minutes).
   */
  endGameTimeoutMs: number('END_GAME_TIMEOUT_MS', 600_000),

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
