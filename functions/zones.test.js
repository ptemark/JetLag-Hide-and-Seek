import { describe, it, expect } from 'vitest';
import { getZones, parseBounds, ZONE_RADIUS_M } from './zones.js';

// ---------------------------------------------------------------------------
// parseBounds
// ---------------------------------------------------------------------------
describe('parseBounds', () => {
  it('parses a valid bounds string', () => {
    expect(parseBounds('51.4,-0.2,51.6,0.1')).toEqual({
      south: 51.4,
      west: -0.2,
      north: 51.6,
      east: 0.1,
    });
  });

  it('returns null for missing input', () => {
    expect(parseBounds(null)).toBeNull();
    expect(parseBounds(undefined)).toBeNull();
    expect(parseBounds('')).toBeNull();
  });

  it('returns null for wrong number of parts', () => {
    expect(parseBounds('51.4,-0.2,51.6')).toBeNull();
    expect(parseBounds('51.4,-0.2,51.6,0.1,99')).toBeNull();
  });

  it('returns null when a part is not a number', () => {
    expect(parseBounds('a,-0.2,51.6,0.1')).toBeNull();
    expect(parseBounds('51.4,NaN,51.6,0.1')).toBeNull();
  });

  it('returns null when south >= north', () => {
    expect(parseBounds('51.6,-0.2,51.4,0.1')).toBeNull();
    expect(parseBounds('51.5,-0.2,51.5,0.1')).toBeNull();
  });

  it('returns null when west >= east', () => {
    expect(parseBounds('51.4,0.1,51.6,-0.2')).toBeNull();
    expect(parseBounds('51.4,0.0,51.6,0.0')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ZONE_RADIUS_M
// ---------------------------------------------------------------------------
describe('ZONE_RADIUS_M', () => {
  it('has 500 m radius for small and medium', () => {
    expect(ZONE_RADIUS_M.small).toBe(500);
    expect(ZONE_RADIUS_M.medium).toBe(500);
  });

  it('has 1000 m radius for large', () => {
    expect(ZONE_RADIUS_M.large).toBe(1000);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ZONE_RADIUS_M)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper: mock fetch factory
// ---------------------------------------------------------------------------
function makeFetch(nodes = [], { fail = false, httpStatus = 200 } = {}) {
  return async (_url, _opts) => {
    if (fail) throw new Error('network error');
    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus,
      json: async () => ({
        elements: nodes.map((n) => ({ type: 'node', ...n })),
      }),
    };
  };
}

const SAMPLE_NODES = [
  { id: 1001, lat: 51.5, lon: -0.1, tags: { name: 'Victoria' } },
  { id: 1002, lat: 51.51, lon: -0.09, tags: { name: 'St James\'s Park' } },
  { id: 1003, lat: 51.52, lon: -0.08, tags: {} },           // no name tag
  { id: 1004, lat: 51.53, lon: -0.07, tags: { 'name:en': 'Pimlico' } }, // name:en fallback
];

const VALID_BOUNDS = '51.4,-0.2,51.6,0.1';

// ---------------------------------------------------------------------------
// getZones — method validation
// ---------------------------------------------------------------------------
describe('getZones — method validation', () => {
  it('returns 405 for non-GET methods', async () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    for (const method of methods) {
      const result = await getZones({ method, query: {} });
      expect(result.status, `method ${method}`).toBe(405);
      expect(result.body.error).toMatch(/Method Not Allowed/i);
    }
  });
});

// ---------------------------------------------------------------------------
// getZones — query parameter validation
// ---------------------------------------------------------------------------
describe('getZones — query parameter validation', () => {
  it('returns 400 when bounds is missing', async () => {
    const result = await getZones({ method: 'GET', query: { scale: 'small' } });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/bounds/i);
  });

  it('returns 400 when scale is missing', async () => {
    const result = await getZones({ method: 'GET', query: { bounds: VALID_BOUNDS } });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/scale/i);
  });

  it('returns 400 for an invalid scale value', async () => {
    const result = await getZones({ method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'huge' } });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/scale/i);
  });

  it('returns 400 for a malformed bounds string', async () => {
    const result = await getZones({ method: 'GET', query: { bounds: 'bad,data', scale: 'small' } });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/bounds/i);
  });

  it('returns 400 when south >= north', async () => {
    const result = await getZones({
      method: 'GET',
      query: { bounds: '51.6,-0.2,51.4,0.1', scale: 'small' },
    });
    expect(result.status).toBe(400);
  });

  it('returns 400 when west >= east', async () => {
    const result = await getZones({
      method: 'GET',
      query: { bounds: '51.4,0.1,51.6,-0.2', scale: 'small' },
    });
    expect(result.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// getZones — Overpass API failure handling
// ---------------------------------------------------------------------------
describe('getZones — upstream error handling', () => {
  it('returns 502 when fetch throws (network error)', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch([], { fail: true }),
    );
    expect(result.status).toBe(502);
    expect(result.body.error).toMatch(/Overpass/i);
    expect(result.body.details).toBe('network error');
  });

  it('returns 502 when Overpass returns a non-OK status', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch([], { httpStatus: 429 }),
    );
    expect(result.status).toBe(502);
    expect(result.body.upstreamStatus).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// getZones — successful response shape
// ---------------------------------------------------------------------------
describe('getZones — successful response', () => {
  it('returns 200 with correctly structured zones for scale=small', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch(SAMPLE_NODES),
    );
    expect(result.status).toBe(200);
    const { scale, bounds, radiusM, count, zones } = result.body;
    expect(scale).toBe('small');
    expect(bounds).toEqual({ south: 51.4, west: -0.2, north: 51.6, east: 0.1 });
    expect(radiusM).toBe(500);
    expect(count).toBe(SAMPLE_NODES.length);
    expect(zones).toHaveLength(SAMPLE_NODES.length);
  });

  it('uses 500 m radius for medium scale', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'medium' } },
      makeFetch(SAMPLE_NODES),
    );
    expect(result.status).toBe(200);
    expect(result.body.radiusM).toBe(500);
    result.body.zones.forEach((z) => expect(z.radiusM).toBe(500));
  });

  it('uses 1000 m radius for large scale', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'large' } },
      makeFetch(SAMPLE_NODES),
    );
    expect(result.status).toBe(200);
    expect(result.body.radiusM).toBe(1000);
    result.body.zones.forEach((z) => expect(z.radiusM).toBe(1000));
  });

  it('maps station name from tags.name', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch(SAMPLE_NODES),
    );
    const victoria = result.body.zones.find((z) => z.stationId === '1001');
    expect(victoria.name).toBe('Victoria');
  });

  it('falls back to tags["name:en"] when tags.name is absent', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch(SAMPLE_NODES),
    );
    const pimlico = result.body.zones.find((z) => z.stationId === '1004');
    expect(pimlico.name).toBe('Pimlico');
  });

  it('uses "Unknown Station" when no name tag exists', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch(SAMPLE_NODES),
    );
    const unnamed = result.body.zones.find((z) => z.stationId === '1003');
    expect(unnamed.name).toBe('Unknown Station');
  });

  it('includes stationId, lat, lon, and radiusM on every zone', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch(SAMPLE_NODES),
    );
    for (const zone of result.body.zones) {
      expect(typeof zone.stationId).toBe('string');
      expect(typeof zone.lat).toBe('number');
      expect(typeof zone.lon).toBe('number');
      expect(typeof zone.radiusM).toBe('number');
    }
  });

  it('returns count: 0 and empty zones array when Overpass returns no nodes', async () => {
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch([]),
    );
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(0);
    expect(result.body.zones).toEqual([]);
  });

  it('Overpass query includes all six required transit type conditions', async () => {
    let capturedBody = '';
    const capturingFetch = async (_url, opts) => {
      capturedBody = decodeURIComponent(opts.body.replace(/^data=/, ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({ elements: [] }),
      };
    };
    await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      capturingFetch,
    );
    expect(capturedBody).toContain('"public_transport"="stop_position"');
    expect(capturedBody).toContain('"railway"="station"');
    expect(capturedBody).toContain('"railway"="halt"');
    expect(capturedBody).toContain('"amenity"="bus_station"');
    expect(capturedBody).toContain('"amenity"="ferry_terminal"');
    expect(capturedBody).toContain('"railway"="tram_stop"');
  });

  it('includes ferry terminal nodes in the returned zones', async () => {
    const ferryNode = { id: 9001, lat: 51.505, lon: -0.115, tags: { name: 'Waterloo Pier', amenity: 'ferry_terminal' } };
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch([ferryNode]),
    );
    expect(result.status).toBe(200);
    const ferry = result.body.zones.find((z) => z.stationId === '9001');
    expect(ferry).toBeDefined();
    expect(ferry.name).toBe('Waterloo Pier');
  });

  it('includes tram stop nodes in the returned zones', async () => {
    const tramNode = { id: 9002, lat: 51.507, lon: -0.112, tags: { name: 'Aldwych Tram Stop', railway: 'tram_stop' } };
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      makeFetch([tramNode]),
    );
    expect(result.status).toBe(200);
    const tram = result.body.zones.find((z) => z.stationId === '9002');
    expect(tram).toBeDefined();
    expect(tram.name).toBe('Aldwych Tram Stop');
  });

  it('filters out non-node elements returned by Overpass', async () => {
    const fetchWithWay = makeFetch([]);
    const wayFetch = async (url, opts) => {
      const base = await fetchWithWay(url, opts);
      const data = await base.json();
      data.elements = [
        { type: 'way', id: 999, nodes: [1, 2, 3] },
        { type: 'node', id: 2000, lat: 51.5, lon: -0.1, tags: { name: 'Real Station' } },
      ];
      return { ...base, json: async () => data };
    };
    const result = await getZones(
      { method: 'GET', query: { bounds: VALID_BOUNDS, scale: 'small' } },
      wayFetch,
    );
    expect(result.body.count).toBe(1);
    expect(result.body.zones[0].stationId).toBe('2000');
  });
});
