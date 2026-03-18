import { describe, it, expect } from 'vitest';
import { haversineDistance, checkCapture, checkSpot, calculateThermometer, calculateTentacle, calculateMeasuring } from './captureDetector.js';

// ---------------------------------------------------------------------------
// haversineDistance
// ---------------------------------------------------------------------------

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it('returns approximately 111 km per degree of latitude', () => {
    const dist = haversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });

  it('returns correct distance between two known points (London ↔ Paris ~340 km)', () => {
    // London: 51.5074, -0.1278 | Paris: 48.8566, 2.3522
    const dist = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(330_000);
    expect(dist).toBeLessThan(350_000);
  });

  it('is symmetric', () => {
    const a = haversineDistance(51, 0, 52, 1);
    const b = haversineDistance(52, 1, 51, 0);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });

  it('returns small values for nearby points (< 500 m)', () => {
    // ~44 m apart
    const dist = haversineDistance(51.5, 0, 51.5004, 0);
    expect(dist).toBeLessThan(500);
    expect(dist).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkCapture helpers
// ---------------------------------------------------------------------------

/** Build a minimal gameState snapshot. */
function makeGameState(players) {
  return { gameId: 'g1', status: 'seeking', players };
}

/** Build a zone centred at (lat, lon) with given radius. */
function makeZone(lat, lon, radiusM = 500) {
  return { stationId: 's1', name: 'Test Station', lat, lon, radiusM };
}

// ---------------------------------------------------------------------------
// checkCapture
// ---------------------------------------------------------------------------

describe('checkCapture', () => {
  it('returns not-captured when gameState is null', () => {
    const result = checkCapture(null, [makeZone(51.5, 0)]);
    expect(result.captured).toBe(false);
    expect(result.hiderZone).toBeNull();
    expect(result.seekersInZone).toEqual([]);
  });

  it('returns not-captured when zones array is empty', () => {
    const state = makeGameState({ h1: { lat: 51.5, lon: 0, role: 'hider' } });
    expect(checkCapture(state, []).captured).toBe(false);
  });

  it('returns not-captured when zones is null', () => {
    const state = makeGameState({ h1: { lat: 51.5, lon: 0, role: 'hider' } });
    expect(checkCapture(state, null).captured).toBe(false);
  });

  it('returns not-captured when there are no hiders', () => {
    const state = makeGameState({
      s1: { lat: 51.5, lon: 0, role: 'seeker' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0)]).captured).toBe(false);
  });

  it('returns not-captured when there are no seekers', () => {
    const state = makeGameState({
      h1: { lat: 51.5, lon: 0, role: 'hider' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0)]).captured).toBe(false);
  });

  it('returns not-captured when hider location is unknown', () => {
    const state = makeGameState({
      h1: { lat: null, lon: null, role: 'hider' },
      s1: { lat: 51.5, lon: 0,   role: 'seeker' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0)]).captured).toBe(false);
  });

  it('returns not-captured when seeker location is unknown', () => {
    const state = makeGameState({
      h1: { lat: 51.5, lon: 0,   role: 'hider' },
      s1: { lat: null, lon: null, role: 'seeker' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0)]).captured).toBe(false);
  });

  it('returns not-captured when hider is outside all zones', () => {
    // Zone at (51.5, 0); hider is ~5 km away
    const state = makeGameState({
      h1: { lat: 51.55, lon: 0, role: 'hider' },
      s1: { lat: 51.5,  lon: 0, role: 'seeker' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0, 500)]).captured).toBe(false);
  });

  it('returns not-captured when seeker is outside hider zone', () => {
    // Hider and zone at (51.5, 0, 500 m radius); seeker ~5 km away
    const state = makeGameState({
      h1: { lat: 51.5,  lon: 0, role: 'hider' },
      s1: { lat: 51.55, lon: 0, role: 'seeker' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0, 500)]).captured).toBe(false);
  });

  it('captures when hider and all seekers are within zone radius', () => {
    // All three at ~(51.5, 0) within 500 m zone
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0.0001, role: 'hider' },
      s1: { lat: 51.5002, lon: 0.0002, role: 'seeker' },
    });
    const result = checkCapture(state, [makeZone(51.5, 0, 500)]);
    expect(result.captured).toBe(true);
    expect(result.seekersInZone).toContain('s1');
    expect(result.hiderZone).not.toBeNull();
  });

  it('returns not-captured when only some seekers are in zone', () => {
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0,    role: 'hider' },
      s1: { lat: 51.5002, lon: 0,    role: 'seeker' },  // inside
      s2: { lat: 51.56,   lon: 0,    role: 'seeker' },  // far away
    });
    const result = checkCapture(state, [makeZone(51.5, 0, 500)]);
    expect(result.captured).toBe(false);
    expect(result.seekersInZone).toContain('s1');
    expect(result.seekersInZone).not.toContain('s2');
  });

  it('captures with multiple seekers all in zone', () => {
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0,      role: 'hider' },
      s1: { lat: 51.5002, lon: 0,      role: 'seeker' },
      s2: { lat: 51.4999, lon: 0.0001, role: 'seeker' },
    });
    const result = checkCapture(state, [makeZone(51.5, 0, 500)]);
    expect(result.captured).toBe(true);
    expect(result.seekersInZone).toHaveLength(2);
  });

  it('uses the zone that contains the hider when multiple zones exist', () => {
    const zoneA = makeZone(51.5,  0,   500);   // hider is here
    const zoneB = makeZone(52.0,  1.0, 500);   // far zone
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0,      role: 'hider' },
      s1: { lat: 51.5002, lon: 0.0001, role: 'seeker' },
    });
    const result = checkCapture(state, [zoneA, zoneB]);
    expect(result.captured).toBe(true);
    expect(result.hiderZone?.stationId).toBe(zoneA.stationId);
  });

  it('respects 1 km radius for large-scale games', () => {
    // Hider and seeker ~800 m from zone centre — inside 1 km, outside 500 m
    const zone = makeZone(51.5, 0, 1000);
    const state = makeGameState({
      h1: { lat: 51.507, lon: 0, role: 'hider'  },   // ~780 m north
      s1: { lat: 51.506, lon: 0, role: 'seeker' },   // ~670 m north
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
  });

  it('excludes seekers whose location is unknown from capture count', () => {
    // s2 has no location — only s1 is evaluated; capture proceeds
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0,   role: 'hider' },
      s1: { lat: 51.5002, lon: 0,   role: 'seeker' },
      s2: { lat: null,    lon: null, role: 'seeker' },
    });
    // Only s1 is counted; it is in zone → captured
    const result = checkCapture(state, [makeZone(51.5, 0, 500)]);
    expect(result.captured).toBe(true);
    expect(result.seekersInZone).toEqual(['s1']);
  });

  it('returns captureTeam null in single-team mode', () => {
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0, role: 'hider' },
      s1: { lat: 51.5002, lon: 0, role: 'seeker' },
    });
    expect(checkCapture(state, [makeZone(51.5, 0, 500)]).captureTeam).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two-team capture mode
// ---------------------------------------------------------------------------

describe('checkCapture — two-team mode', () => {
  function makeTeamState(players) {
    return { gameId: 'g1', status: 'seeking', seekerTeams: 2, players };
  }

  const zone = { stationId: 's1', name: 'Test', lat: 51.5, lon: 0, radiusM: 500 };

  it('does not capture when no team has all members in zone', () => {
    // Both teams have at least one member outside the zone.
    const state = makeTeamState({
      h1: { lat: 51.5001, lon: 0,   role: 'hider',  team: null },
      a1: { lat: 51.5002, lon: 0,   role: 'seeker', team: 'A' },  // A: in zone
      a2: { lat: 51.56,   lon: 0,   role: 'seeker', team: 'A' },  // A: far away
      b1: { lat: 51.56,   lon: 0.1, role: 'seeker', team: 'B' },  // B: far away
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(false);
    expect(result.captureTeam).toBeNull();
  });

  it('captures when Team A is all in zone (Team B is not)', () => {
    const state = makeTeamState({
      h1: { lat: 51.5001, lon: 0, role: 'hider',  team: null },
      a1: { lat: 51.5002, lon: 0, role: 'seeker', team: 'A' },  // A in zone
      a2: { lat: 51.4999, lon: 0, role: 'seeker', team: 'A' },  // A in zone
      b1: { lat: 51.56,   lon: 0, role: 'seeker', team: 'B' },  // B far away
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
    expect(result.captureTeam).toBe('A');
    expect(result.seekersInZone).toContain('a1');
    expect(result.seekersInZone).toContain('a2');
    expect(result.seekersInZone).not.toContain('b1');
  });

  it('captures when Team B is all in zone (Team A is not)', () => {
    const state = makeTeamState({
      h1: { lat: 51.5001, lon: 0,   role: 'hider',  team: null },
      a1: { lat: 51.56,   lon: 0,   role: 'seeker', team: 'A' },  // A far away
      b1: { lat: 51.5002, lon: 0,   role: 'seeker', team: 'B' },  // B in zone
      b2: { lat: 51.5003, lon: 0.0001, role: 'seeker', team: 'B' }, // B in zone
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
    expect(result.captureTeam).toBe('B');
    expect(result.seekersInZone).toContain('b1');
    expect(result.seekersInZone).toContain('b2');
  });

  it('returns not-captured when teams have partial zone coverage', () => {
    const state = makeTeamState({
      h1: { lat: 51.5001, lon: 0,   role: 'hider',  team: null },
      a1: { lat: 51.5002, lon: 0,   role: 'seeker', team: 'A' },  // in zone
      a2: { lat: 51.56,   lon: 0,   role: 'seeker', team: 'A' },  // outside
      b1: { lat: 51.5003, lon: 0,   role: 'seeker', team: 'B' },  // in zone
      b2: { lat: 51.56,   lon: 0.1, role: 'seeker', team: 'B' },  // outside
    });
    expect(checkCapture(state, [zone]).captured).toBe(false);
  });

  it('treats seekers with unknown location as absent (team can still capture)', () => {
    const state = makeTeamState({
      h1: { lat: 51.5001, lon: 0,   role: 'hider',  team: null },
      a1: { lat: 51.5002, lon: 0,   role: 'seeker', team: 'A' },  // in zone
      a2: { lat: null,    lon: null, role: 'seeker', team: 'A' },  // no location — ignored
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
    expect(result.captureTeam).toBe('A');
    expect(result.seekersInZone).toEqual(['a1']);
  });

  it('ignores seekerTeams when value is 0 (single-team mode)', () => {
    const state = { gameId: 'g1', status: 'seeking', seekerTeams: 0, players: {
      h1: { lat: 51.5001, lon: 0, role: 'hider',  team: null },
      s1: { lat: 51.5002, lon: 0, role: 'seeker', team: null },
    }};
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
    expect(result.captureTeam).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transit mode — onTransit exclusion
// ---------------------------------------------------------------------------

describe('checkCapture — onTransit exclusion', () => {
  const zone = { stationId: 's1', name: 'Test', lat: 51.5, lon: 0, radiusM: 500 };

  it('excludes a seeker with onTransit=true from the capture check', () => {
    // s1 is in zone but on transit — no capture because the only eligible seeker is on transit
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0, role: 'hider',  onTransit: false },
      s1: { lat: 51.5002, lon: 0, role: 'seeker', onTransit: true },
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(false);
    expect(result.seekersInZone).toEqual([]);
  });

  it('captures when a seeker with onTransit=false is in zone (other seeker on transit)', () => {
    // s1 on transit (excluded), s2 off transit and in zone → only s2 counts → captured
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0,   role: 'hider',  onTransit: false },
      s1: { lat: 51.5002, lon: 0,   role: 'seeker', onTransit: true  }, // excluded
      s2: { lat: 51.4999, lon: 0,   role: 'seeker', onTransit: false }, // included and in zone
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
    expect(result.seekersInZone).toEqual(['s2']);
  });

  it('does not capture when seeker with onTransit=false is outside zone', () => {
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0,  role: 'hider',  onTransit: false },
      s1: { lat: 51.56,   lon: 0,  role: 'seeker', onTransit: false }, // off transit but far away
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(false);
  });

  it('treats onTransit=false the same as onTransit absent (normal seek behaviour)', () => {
    const state = makeGameState({
      h1: { lat: 51.5001, lon: 0, role: 'hider'  },
      s1: { lat: 51.5002, lon: 0, role: 'seeker', onTransit: false },
    });
    const result = checkCapture(state, [zone]);
    expect(result.captured).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSpot — two-phase End Game spotting
// ---------------------------------------------------------------------------

describe('checkSpot', () => {
  const SPOT_RADIUS_M = 30;

  function makeSpotState(players) {
    return { gameId: 'g1', status: 'seeking', players };
  }

  it('returns not-spotted when gameState is null', () => {
    const result = checkSpot(null, 's1', SPOT_RADIUS_M);
    expect(result.spotted).toBe(false);
    expect(result.distance).toBeNull();
  });

  it('returns not-spotted when spotterId is null', () => {
    const state = makeSpotState({
      h1: { lat: 51.5, lon: 0, role: 'hider' },
      s1: { lat: 51.5, lon: 0, role: 'seeker' },
    });
    expect(checkSpot(state, null, SPOT_RADIUS_M).spotted).toBe(false);
  });

  it('returns not-spotted when spotRadiusM is null', () => {
    const state = makeSpotState({
      h1: { lat: 51.5, lon: 0, role: 'hider' },
      s1: { lat: 51.5, lon: 0, role: 'seeker' },
    });
    expect(checkSpot(state, 's1', null).spotted).toBe(false);
  });

  it('returns not-spotted when there are no hiders', () => {
    const state = makeSpotState({
      s1: { lat: 51.5, lon: 0, role: 'seeker' },
    });
    expect(checkSpot(state, 's1', SPOT_RADIUS_M).spotted).toBe(false);
  });

  it('returns not-spotted when hider location is unknown', () => {
    const state = makeSpotState({
      h1: { lat: null, lon: null, role: 'hider' },
      s1: { lat: 51.5, lon: 0, role: 'seeker' },
    });
    expect(checkSpot(state, 's1', SPOT_RADIUS_M).spotted).toBe(false);
  });

  it('returns not-spotted when spotter location is unknown', () => {
    const state = makeSpotState({
      h1: { lat: 51.5, lon: 0, role: 'hider' },
      s1: { lat: null, lon: null, role: 'seeker' },
    });
    expect(checkSpot(state, 's1', SPOT_RADIUS_M).spotted).toBe(false);
  });

  it('returns not-spotted when spotter is not in the game', () => {
    const state = makeSpotState({
      h1: { lat: 51.5, lon: 0, role: 'hider' },
    });
    expect(checkSpot(state, 'unknown', SPOT_RADIUS_M).spotted).toBe(false);
  });

  it('confirms spot when spotter is within spotRadiusM of hider (~10 m)', () => {
    // 10 m north of hider at (51.5, 0) — both within 30 m
    const state = makeSpotState({
      h1: { lat: 51.5,      lon: 0, role: 'hider'  },
      s1: { lat: 51.50009,  lon: 0, role: 'seeker' },  // ~10 m north
    });
    const result = checkSpot(state, 's1', SPOT_RADIUS_M);
    expect(result.spotted).toBe(true);
    expect(result.distance).toBeGreaterThan(0);
    expect(result.distance).toBeLessThan(SPOT_RADIUS_M);
    expect(result.hiderLat).toBe(51.5);
    expect(result.hiderLon).toBe(0);
  });

  it('rejects spot when spotter is outside spotRadiusM of hider (~50 m)', () => {
    // ~55 m north — outside default 30 m radius
    const state = makeSpotState({
      h1: { lat: 51.5,      lon: 0, role: 'hider'  },
      s1: { lat: 51.5005,   lon: 0, role: 'seeker' },  // ~55 m north
    });
    const result = checkSpot(state, 's1', SPOT_RADIUS_M);
    expect(result.spotted).toBe(false);
    expect(result.distance).toBeGreaterThan(SPOT_RADIUS_M);
  });

  it('uses the custom spotRadiusM when provided', () => {
    // Spotter ~50 m away — confirmed with 100 m radius, rejected with 30 m radius
    const state = makeSpotState({
      h1: { lat: 51.5,    lon: 0, role: 'hider'  },
      s1: { lat: 51.5005, lon: 0, role: 'seeker' },  // ~55 m
    });
    expect(checkSpot(state, 's1', 100).spotted).toBe(true);
    expect(checkSpot(state, 's1', 30).spotted).toBe(false);
  });

  it('returns correct hiderLat/hiderLon in the result', () => {
    const state = makeSpotState({
      h1: { lat: 51.1234, lon: -0.5678, role: 'hider'  },
      s1: { lat: 51.1234, lon: -0.5678, role: 'seeker' },
    });
    const result = checkSpot(state, 's1', SPOT_RADIUS_M);
    expect(result.hiderLat).toBe(51.1234);
    expect(result.hiderLon).toBe(-0.5678);
  });
});

// ---------------------------------------------------------------------------
// calculateThermometer
// ---------------------------------------------------------------------------

describe('calculateThermometer', () => {
  /** Build a minimal gameState with previousLocation on the seeker. */
  function makeThermState(players) {
    return { gameId: 'g1', status: 'seeking', players };
  }

  it('returns unknown when gameState is null', () => {
    expect(calculateThermometer(null, 's1', 51.5, 0)).toEqual({ result: 'unknown' });
  });

  it('returns unknown when seekerId is null', () => {
    const state = makeThermState({ s1: { lat: 51.5, lon: 0, role: 'seeker', previousLocation: { lat: 51.6, lon: 0 } } });
    expect(calculateThermometer(state, null, 51.5, 0)).toEqual({ result: 'unknown' });
  });

  it('returns unknown when hiderLat is null', () => {
    const state = makeThermState({ s1: { lat: 51.5, lon: 0, role: 'seeker', previousLocation: { lat: 51.6, lon: 0 } } });
    expect(calculateThermometer(state, 's1', null, 0)).toEqual({ result: 'unknown' });
  });

  it('returns unknown when hiderLon is null', () => {
    const state = makeThermState({ s1: { lat: 51.5, lon: 0, role: 'seeker', previousLocation: { lat: 51.6, lon: 0 } } });
    expect(calculateThermometer(state, 's1', 51.5, null)).toEqual({ result: 'unknown' });
  });

  it('returns unknown when seeker has no current location', () => {
    const state = makeThermState({ s1: { lat: null, lon: null, role: 'seeker', previousLocation: { lat: 51.6, lon: 0 } } });
    expect(calculateThermometer(state, 's1', 51.5, 0)).toEqual({ result: 'unknown' });
  });

  it('returns unknown when seeker has no previousLocation', () => {
    const state = makeThermState({ s1: { lat: 51.5, lon: 0, role: 'seeker', previousLocation: null } });
    expect(calculateThermometer(state, 's1', 51.52, 0)).toEqual({ result: 'unknown' });
  });

  it('returns unknown when seekerId does not exist in gameState', () => {
    const state = makeThermState({ s1: { lat: 51.5, lon: 0, role: 'seeker', previousLocation: { lat: 51.6, lon: 0 } } });
    expect(calculateThermometer(state, 'no-such-player', 51.5, 0)).toEqual({ result: 'unknown' });
  });

  it('returns warmer when seeker moved closer to hider', () => {
    // Hider at 51.5, 0. Seeker was at 51.6 (~11 km away), now at 51.51 (~1 km away).
    const state = makeThermState({
      s1: { lat: 51.51, lon: 0, role: 'seeker', previousLocation: { lat: 51.6, lon: 0 } },
    });
    const result = calculateThermometer(state, 's1', 51.5, 0);
    expect(result.result).toBe('warmer');
    expect(result.currentDistanceM).toBeLessThan(result.previousDistanceM);
    expect(typeof result.currentDistanceM).toBe('number');
    expect(typeof result.previousDistanceM).toBe('number');
  });

  it('returns colder when seeker moved farther from hider', () => {
    // Hider at 51.5, 0. Seeker was at 51.51 (~1 km), now at 51.6 (~11 km).
    const state = makeThermState({
      s1: { lat: 51.6, lon: 0, role: 'seeker', previousLocation: { lat: 51.51, lon: 0 } },
    });
    const result = calculateThermometer(state, 's1', 51.5, 0);
    expect(result.result).toBe('colder');
    expect(result.currentDistanceM).toBeGreaterThan(result.previousDistanceM);
  });

  it('returns same when seeker stayed at the same distance from hider', () => {
    // Hider at 0, 0. Seeker at (0.01, 0) and was also at (0.01, 0).
    const state = makeThermState({
      s1: { lat: 0.01, lon: 0, role: 'seeker', previousLocation: { lat: 0.01, lon: 0 } },
    });
    const result = calculateThermometer(state, 's1', 0, 0);
    expect(result.result).toBe('same');
    expect(result.currentDistanceM).toBe(result.previousDistanceM);
  });
});

// ---------------------------------------------------------------------------
// calculateTentacle
// ---------------------------------------------------------------------------

describe('calculateTentacle', () => {
  // London: 51.5074° N, 0.1278° W
  // Oxford Circus: 51.5152, -0.1415  (~1.3 km from London)
  const hiderLat = 51.5074;
  const hiderLon = -0.1278;
  const targetLat = 51.5152;
  const targetLon = -0.1415;

  it('returns withinRadius true when hider is inside the radius', () => {
    const result = calculateTentacle(hiderLat, hiderLon, targetLat, targetLon, 2);
    expect(result.withinRadius).toBe(true);
    expect(typeof result.distanceKm).toBe('number');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(2);
  });

  it('returns withinRadius false when hider is outside the radius', () => {
    const result = calculateTentacle(hiderLat, hiderLon, targetLat, targetLon, 0.5);
    expect(result.withinRadius).toBe(false);
    expect(result.distanceKm).toBeGreaterThan(0.5);
  });

  it('returns withinRadius true when hider is exactly on the target (distance 0, radius 0)', () => {
    const result = calculateTentacle(hiderLat, hiderLon, hiderLat, hiderLon, 0);
    expect(result.withinRadius).toBe(true);
    expect(result.distanceKm).toBe(0);
  });

  it('returns nulls when hiderLat is null', () => {
    expect(calculateTentacle(null, hiderLon, targetLat, targetLon, 2))
      .toEqual({ withinRadius: null, distanceKm: null });
  });

  it('returns nulls when hiderLon is null', () => {
    expect(calculateTentacle(hiderLat, null, targetLat, targetLon, 2))
      .toEqual({ withinRadius: null, distanceKm: null });
  });

  it('returns nulls when targetLat is null', () => {
    expect(calculateTentacle(hiderLat, hiderLon, null, targetLon, 2))
      .toEqual({ withinRadius: null, distanceKm: null });
  });

  it('returns nulls when targetLon is null', () => {
    expect(calculateTentacle(hiderLat, hiderLon, targetLat, null, 2))
      .toEqual({ withinRadius: null, distanceKm: null });
  });

  it('returns nulls when radiusKm is null', () => {
    expect(calculateTentacle(hiderLat, hiderLon, targetLat, targetLon, null))
      .toEqual({ withinRadius: null, distanceKm: null });
  });

  it('distanceKm is consistent with haversineDistance / 1000', () => {
    const result = calculateTentacle(hiderLat, hiderLon, targetLat, targetLon, 5);
    const expected = haversineDistance(hiderLat, hiderLon, targetLat, targetLon) / 1000;
    expect(result.distanceKm).toBeCloseTo(expected, 6);
  });
});

// ---------------------------------------------------------------------------
// calculateMeasuring
// ---------------------------------------------------------------------------

describe('calculateMeasuring', () => {
  // London ~51.5074, -0.1278; Birmingham ~52.4862, -1.8904 (~163 km apart).
  // Target: Eiffel Tower ~48.8584, 2.2945
  const hiderLat  = 51.5074;
  const hiderLon  = -0.1278;
  const seekerLat = 52.4862;
  const seekerLon = -1.8904;
  const targetLat = 48.8584;
  const targetLon = 2.2945;

  it('returns hiderIsCloser true when hider is closer to the target', () => {
    // London is closer to Paris than Birmingham is.
    const result = calculateMeasuring(hiderLat, hiderLon, seekerLat, seekerLon, targetLat, targetLon);
    expect(result.hiderIsCloser).toBe(true);
    expect(result.hiderDistanceKm).toBeLessThan(result.seekerDistanceKm);
    expect(typeof result.hiderDistanceKm).toBe('number');
    expect(typeof result.seekerDistanceKm).toBe('number');
  });

  it('returns hiderIsCloser false when seeker is closer to the target', () => {
    // Swap hider and seeker so Birmingham (seeker) becomes closer to Paris.
    const result = calculateMeasuring(seekerLat, seekerLon, hiderLat, hiderLon, targetLat, targetLon);
    expect(result.hiderIsCloser).toBe(false);
    expect(result.hiderDistanceKm).toBeGreaterThan(result.seekerDistanceKm);
  });

  it('returns hiderIsCloser false when distances are equal (not strictly less than)', () => {
    // Both at the same point — equal distance, hiderIsCloser should be false (not <).
    const result = calculateMeasuring(51.5, 0, 51.5, 0, targetLat, targetLon);
    expect(result.hiderIsCloser).toBe(false);
    expect(result.hiderDistanceKm).toBeCloseTo(result.seekerDistanceKm, 6);
  });

  it('returns nulls when hiderLat is null', () => {
    expect(calculateMeasuring(null, hiderLon, seekerLat, seekerLon, targetLat, targetLon))
      .toEqual({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });
  });

  it('returns nulls when hiderLon is null', () => {
    expect(calculateMeasuring(hiderLat, null, seekerLat, seekerLon, targetLat, targetLon))
      .toEqual({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });
  });

  it('returns nulls when seekerLat is null', () => {
    expect(calculateMeasuring(hiderLat, hiderLon, null, seekerLon, targetLat, targetLon))
      .toEqual({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });
  });

  it('returns nulls when seekerLon is null', () => {
    expect(calculateMeasuring(hiderLat, hiderLon, seekerLat, null, targetLat, targetLon))
      .toEqual({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });
  });

  it('returns nulls when targetLat is null', () => {
    expect(calculateMeasuring(hiderLat, hiderLon, seekerLat, seekerLon, null, targetLon))
      .toEqual({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });
  });

  it('returns nulls when targetLon is null', () => {
    expect(calculateMeasuring(hiderLat, hiderLon, seekerLat, seekerLon, targetLat, null))
      .toEqual({ hiderDistanceKm: null, seekerDistanceKm: null, hiderIsCloser: null });
  });

  it('distances are consistent with haversineDistance / 1000', () => {
    const result = calculateMeasuring(hiderLat, hiderLon, seekerLat, seekerLon, targetLat, targetLon);
    const expectedHider  = haversineDistance(hiderLat,  hiderLon,  targetLat, targetLon) / 1000;
    const expectedSeeker = haversineDistance(seekerLat, seekerLon, targetLat, targetLon) / 1000;
    expect(result.hiderDistanceKm).toBeCloseTo(expectedHider, 6);
    expect(result.seekerDistanceKm).toBeCloseTo(expectedSeeker, 6);
  });
});
