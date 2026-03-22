import { describe, it, expect } from 'vitest';
import { haversineKm, haversineDistanceM, centerRadiusToBounds, formatDuration } from './gameUtils.js';

describe('haversineKm', () => {
  // (a) Identical points have zero distance.
  it('returns ~0 for identical points', () => {
    expect(haversineKm({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBeCloseTo(0, 5);
  });

  // (b) 1° latitude at the equator ≈ 111.195 km (Earth's mean meridional arc).
  it('returns ~111 km for 1° latitude difference at the equator', () => {
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    // Accept anything in the range 111.0–111.4 km (correct for all reasonable Earth radii).
    expect(d).toBeGreaterThan(111.0);
    expect(d).toBeLessThan(111.4);
  });
});

describe('haversineDistanceM', () => {
  // (a) Identical points → < 1 m (floating point epsilon only).
  it('returns < 1 m for identical points', () => {
    expect(haversineDistanceM({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBeLessThan(1);
  });

  // (b) A point 500 m north (lat delta ≈ 0.004504°) should return within 1% of 500 m.
  it('returns ~500 m for a point 500 m north', () => {
    const base = { lat: 51.5, lon: -0.1 };
    const north = { lat: 51.5 + 500 / 111_000, lon: -0.1 };
    const d = haversineDistanceM(base, north);
    expect(Math.abs(d - 500) / 500).toBeLessThan(0.01);
  });

  // (c) 1° latitude separation ≈ 111 000 m (within 1%).
  it('returns ~111 000 m for 1° latitude difference', () => {
    const d = haversineDistanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(Math.abs(d - 111_000) / 111_000).toBeLessThan(0.01);
  });
});

describe('centerRadiusToBounds', () => {
  // (c) Round-trip: distance from centre to lat_max edge ≈ radiusKm (within 1 %).
  it('round-trips: haversineKm(center, { lat: bounds.lat_max, lon: center.lon }) ≈ radiusKm', () => {
    const center = { lat: 51.5, lon: -0.1 };
    const radiusKm = 15;
    const bounds = centerRadiusToBounds(center, radiusKm);
    const dist = haversineKm(center, { lat: bounds.lat_max, lon: center.lon });
    // Must be within 1 % of the requested radius.
    expect(Math.abs(dist - radiusKm) / radiusKm).toBeLessThan(0.01);
  });
});

describe('formatDuration', () => {
  // (a) Zero milliseconds → "0s".
  it('returns "0s" for 0 ms', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  // (b) 59 seconds → "59s" (no minutes component).
  it('returns "59s" for 59 000 ms', () => {
    expect(formatDuration(59_000)).toBe('59s');
  });

  // (c) 90 seconds → "1m 30s".
  it('returns "1m 30s" for 90 000 ms', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  // (d) 1 hour + 1 minute + 1 second → "1h 1m 1s".
  it('returns "1h 1m 1s" for 3 661 000 ms', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
  });
});
