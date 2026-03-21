import { describe, it, expect } from 'vitest';
import { haversineKm, centerRadiusToBounds } from './gameUtils.js';

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
