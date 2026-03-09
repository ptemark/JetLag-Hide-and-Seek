import { describe, it, expect } from 'vitest';
import { ENV, getEnvVar, parseBool } from './env.js';

describe('parseBool', () => {
  it('returns true for the string "true"', () => {
    expect(parseBool('true')).toBe(true);
  });

  it('returns false for the string "false"', () => {
    expect(parseBool('false')).toBe(false);
  });

  it('returns the provided fallback for unrecognised values', () => {
    expect(parseBool('yes', true)).toBe(true);
    expect(parseBool('1', false)).toBe(false);
  });

  it('defaults fallback to false when not provided', () => {
    expect(parseBool('unknown')).toBe(false);
    expect(parseBool('')).toBe(false);
  });
});

describe('getEnvVar', () => {
  it('returns the default when the key is not set', () => {
    expect(getEnvVar('VITE_DEFINITELY_UNSET_KEY_XYZ', 'mydefault')).toBe('mydefault');
  });

  it('returns empty string as default when no default argument is given', () => {
    expect(getEnvVar('VITE_DEFINITELY_UNSET_KEY_XYZ')).toBe('');
  });
});

describe('ENV shape and defaults', () => {
  it('name is a non-empty string', () => {
    expect(typeof ENV.name).toBe('string');
    expect(ENV.name.length).toBeGreaterThan(0);
  });

  it('name is one of the expected environment values', () => {
    expect(['development', 'staging', 'production']).toContain(ENV.name);
  });

  it('apiBaseUrl is a non-empty string', () => {
    expect(typeof ENV.apiBaseUrl).toBe('string');
    expect(ENV.apiBaseUrl.length).toBeGreaterThan(0);
  });

  it('wsUrl is a non-empty string', () => {
    expect(typeof ENV.wsUrl).toBe('string');
    expect(ENV.wsUrl.length).toBeGreaterThan(0);
  });

  it('mapsProvider defaults to "osm"', () => {
    expect(ENV.mapsProvider).toBe('osm');
  });

  it('googleMapsApiKey is a string', () => {
    expect(typeof ENV.googleMapsApiKey).toBe('string');
  });

  it('all feature flags are booleans', () => {
    expect(typeof ENV.features.twoTeams).toBe('boolean');
    expect(typeof ENV.features.adminDashboard).toBe('boolean');
    expect(typeof ENV.features.gpsTracking).toBe('boolean');
  });

  it('twoTeams defaults to false', () => {
    expect(ENV.features.twoTeams).toBe(false);
  });

  it('adminDashboard defaults to false', () => {
    expect(ENV.features.adminDashboard).toBe(false);
  });

  it('gpsTracking defaults to true', () => {
    expect(ENV.features.gpsTracking).toBe(true);
  });

  it('database.url is a string', () => {
    expect(typeof ENV.database.url).toBe('string');
  });

  it('database.url defaults to empty string when DATABASE_URL is not set', () => {
    expect(ENV.database.url).toBe('');
  });

  it('alerting.webhookUrl is a string', () => {
    expect(typeof ENV.alerting.webhookUrl).toBe('string');
  });

  it('alerting.webhookUrl defaults to empty string', () => {
    expect(ENV.alerting.webhookUrl).toBe('');
  });

  it('alerting.errorThreshold is a number', () => {
    expect(typeof ENV.alerting.errorThreshold).toBe('number');
  });

  it('alerting.errorThreshold defaults to 10', () => {
    expect(ENV.alerting.errorThreshold).toBe(10);
  });
});
