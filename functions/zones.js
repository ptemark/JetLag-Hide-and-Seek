/**
 * zones.js — Serverless handler for hiding zone calculation.
 *
 * GET /zones?bounds=lat_min,lon_min,lat_max,lon_max&scale=small|medium|large
 *
 * Fetches transit stations from the OSM Overpass API within the given bounding
 * box and returns computed hiding zones (circles) around each station.
 *
 * Hiding zone radius by game scale (per RULES.md):
 *   small / medium → 500 m
 *   large          → 1 000 m
 *
 * The optional `fetchFn` parameter accepts any function with the same
 * signature as the global `fetch` — used for test injection to avoid real
 * network calls.
 */

/** Hiding zone radius in metres, keyed by game scale. */
export const ZONE_RADIUS_M = Object.freeze({
  small:  500,
  medium: 500,
  large:  1000,
});

const VALID_SCALES = Object.keys(ZONE_RADIUS_M);

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Build an Overpass QL query that returns all public-transit stop nodes
 * within a bounding box specified as south,west,north,east.
 *
 * @param {number} south
 * @param {number} west
 * @param {number} north
 * @param {number} east
 * @returns {string}
 */
function buildOverpassQuery(south, west, north, east) {
  const bbox = `${south},${west},${north},${east}`;
  return (
    `[out:json][timeout:25];` +
    `(` +
    `node["public_transport"="stop_position"](${bbox});` +
    `node["railway"="station"](${bbox});` +
    `node["railway"="halt"](${bbox});` +
    `node["amenity"="bus_station"](${bbox});` +
    `);` +
    `out body;`
  );
}

/**
 * Map a raw OSM node element to a hiding zone object.
 *
 * @param {{ id: number, lat: number, lon: number, tags?: Record<string,string> }} node
 * @param {number} radiusM  Hiding zone radius in metres.
 * @returns {{ stationId: string, name: string, lat: number, lon: number, radiusM: number }}
 */
function nodeToZone(node, radiusM) {
  return {
    stationId: String(node.id),
    name: node.tags?.name ?? node.tags?.['name:en'] ?? 'Unknown Station',
    lat: node.lat,
    lon: node.lon,
    radiusM,
  };
}

/**
 * Parse and validate the `bounds` query-string value.
 * Expected format: `lat_min,lon_min,lat_max,lon_max`
 *
 * Returns null if the input is missing, malformed, or has an invalid range.
 *
 * @param {string|null|undefined} raw
 * @returns {{ south: number, west: number, north: number, east: number } | null}
 */
export function parseBounds(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [south, west, north, east] = parts;
  if (south >= north) return null;
  if (west >= east) return null;
  return { south, west, north, east };
}

/**
 * Fetch transit stations from the OSM Overpass API and compute hiding zones.
 *
 * @param {{ method: string, query?: Record<string, string> }} req
 * @param {typeof fetch} [fetchFn]  Injectable fetch function; defaults to globalThis.fetch.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function getZones(req, fetchFn = globalThis.fetch) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { bounds: boundsRaw, scale } = req.query ?? {};

  if (!boundsRaw) {
    return {
      status: 400,
      body: { error: 'bounds query parameter is required (lat_min,lon_min,lat_max,lon_max)' },
    };
  }

  if (!scale || !VALID_SCALES.includes(scale)) {
    return {
      status: 400,
      body: { error: `scale query parameter is required: one of ${VALID_SCALES.join(', ')}` },
    };
  }

  const bbox = parseBounds(boundsRaw);
  if (!bbox) {
    return {
      status: 400,
      body: {
        error:
          'bounds must be four comma-separated numbers: lat_min,lon_min,lat_max,lon_max ' +
          'with lat_min < lat_max and lon_min < lon_max',
      },
    };
  }

  const radiusM = ZONE_RADIUS_M[scale];
  const query = buildOverpassQuery(bbox.south, bbox.west, bbox.north, bbox.east);

  let data;
  try {
    const response = await fetchFn(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) {
      return {
        status: 502,
        body: { error: 'Overpass API request failed', upstreamStatus: response.status },
      };
    }
    data = await response.json();
  } catch (err) {
    return { status: 502, body: { error: 'Failed to reach Overpass API', details: err.message } };
  }

  const nodes = (data?.elements ?? []).filter((el) => el.type === 'node');
  const zones = nodes.map((node) => nodeToZone(node, radiusM));

  return {
    status: 200,
    body: {
      scale,
      bounds: bbox,
      radiusM,
      count: zones.length,
      zones,
    },
  };
}
