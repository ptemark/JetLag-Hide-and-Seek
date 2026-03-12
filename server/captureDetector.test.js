import { describe, it, expect } from 'vitest';
import { haversineDistance, checkCapture } from './captureDetector.js';

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
