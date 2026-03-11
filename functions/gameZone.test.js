import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lockHiderZone, _getZoneStore, _clearZoneStore } from './gameZone.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(params = {}, body = {}) {
  return { method: 'POST', params, body };
}

// ---------------------------------------------------------------------------
// In-process (no pool) — validation and happy path
// ---------------------------------------------------------------------------

describe('lockHiderZone (in-process)', () => {
  beforeEach(() => { _clearZoneStore(); });

  it('returns 405 for non-POST methods', async () => {
    const res = await lockHiderZone({ method: 'GET', params: { gameId: 'g1' }, body: {} });
    expect(res.status).toBe(405);
  });

  it('returns 400 when gameId is missing', async () => {
    const res = await lockHiderZone(makeReq({}, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/);
  });

  it('returns 400 when stationId is missing', async () => {
    const res = await lockHiderZone(makeReq({ gameId: 'g1' }, { lat: 51.0, lon: -0.1, radiusM: 500 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stationId/);
  });

  it('returns 400 when lat is not a number', async () => {
    const res = await lockHiderZone(makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 'x', lon: -0.1, radiusM: 500 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/);
  });

  it('returns 400 when lon is not a number', async () => {
    const res = await lockHiderZone(makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: null, radiusM: 500 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/);
  });

  it('returns 400 when radiusM is not a positive number', async () => {
    const res = await lockHiderZone(makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: -10 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/radiusM/);
  });

  it('returns 400 when radiusM is zero', async () => {
    const res = await lockHiderZone(makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 0 }));
    expect(res.status).toBe(400);
  });

  it('returns 201 and zone object on success', async () => {
    const res = await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500, playerId: 'p1' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.gameId).toBe('g1');
    expect(res.body.stationId).toBe('s1');
    expect(res.body.lat).toBe(51.0);
    expect(res.body.lon).toBe(-0.1);
    expect(res.body.radiusM).toBe(500);
    expect(res.body.lockedAt).toBeTruthy();
  });

  it('stores zone in in-process store', async () => {
    await lockHiderZone(
      makeReq({ gameId: 'g2' }, { stationId: 's2', lat: 52.0, lon: 0.1, radiusM: 1000 }),
    );
    const store = _getZoneStore();
    expect(store.has('g2')).toBe(true);
    expect(store.get('g2').stationId).toBe('s2');
  });
});

// ---------------------------------------------------------------------------
// Fire-and-forget notify (in-process, no pool)
// ---------------------------------------------------------------------------

describe('lockHiderZone — managed server notification', () => {
  beforeEach(() => { _clearZoneStore(); });

  it('calls internal/games/:gameId/zones and internal/notify when GAME_SERVER_URL provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500, playerId: 'p1' }),
      null,
      'http://server:3001',
      mockFetch,
    );
    // Allow fire-and-forget microtasks to flush
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map(([url]) => url);
    expect(urls.some((u) => u.includes('/internal/games/g1/zones'))).toBe(true);
    expect(urls.some((u) => u.includes('/internal/notify'))).toBe(true);
  });

  it('does not call fetch when gameServerUrl is not provided', async () => {
    const mockFetch = vi.fn();
    await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500 }),
      null,
      null,
      mockFetch,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes zone data in the zones endpoint body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500 }),
      null,
      'http://server:3001',
      mockFetch,
    );
    await Promise.resolve();
    const zonesCall = mockFetch.mock.calls.find(([url]) => url.includes('/zones'));
    const body = JSON.parse(zonesCall[1].body);
    expect(body.zones[0]).toMatchObject({ stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500 });
  });

  it('includes zone_locked event in notify body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500, playerId: 'p1' }),
      null,
      'http://server:3001',
      mockFetch,
    );
    await Promise.resolve();
    const notifyCall = mockFetch.mock.calls.find(([url]) => url.includes('/notify'));
    const body = JSON.parse(notifyCall[1].body);
    expect(body.type).toBe('zone_locked');
    expect(body.gameId).toBe('g1');
    expect(body.lockedBy).toBe('p1');
    expect(body.zone.stationId).toBe('s1');
  });

  it('silently ignores fetch errors (fire-and-forget)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    const res = await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500 }),
      null,
      'http://server:3001',
      mockFetch,
    );
    // Response should succeed despite fetch failure
    await Promise.resolve();
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// DB pool path
// ---------------------------------------------------------------------------

describe('lockHiderZone (with pool)', () => {
  it('calls dbSetGameZone and returns DB result', async () => {
    const dbRow = {
      zoneId: 'z1', gameId: 'g1', stationId: 's1',
      lat: 51.0, lon: -0.1, radiusM: 500,
      lockedAt: '2026-03-11T00:00:00Z',
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{
        id: 'z1', game_id: 'g1', station_id: 's1',
        lat: 51.0, lon: -0.1, radius_m: 500,
        locked_at: '2026-03-11T00:00:00Z',
      }] }),
    };

    const res = await lockHiderZone(
      makeReq({ gameId: 'g1' }, { stationId: 's1', lat: 51.0, lon: -0.1, radiusM: 500, playerId: 'p1' }),
      pool,
      null,
      vi.fn(),
    );
    expect(res.status).toBe(201);
    expect(pool.query).toHaveBeenCalledOnce();
    expect(res.body.stationId).toBe('s1');
  });
});
