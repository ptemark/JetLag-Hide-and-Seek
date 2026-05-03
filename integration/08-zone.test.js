import { setup, teardown }   from './setup.js';
import { lockHiderZone }      from '../functions/gameZone.js';
import { makeGame }           from './helpers.js';

describe.skipIf(!process.env.DATABASE_URL)('zone locking', () => {
  let pool;
  let game;

  beforeAll(async () => {
    pool = await setup();
    game = await makeGame(pool);
  });

  afterAll(async () => { await teardown(pool); });

  // ── (a) valid zone creation ────────────────────────────────────────────────

  it('(a) valid body → 201 with correct zone values', async () => {
    const res = await lockHiderZone(
      { method: 'POST', params: { gameId: game.gameId }, body: { stationId: 'st-1', lat: 51.5, lon: -0.1, radiusM: 200 } },
      pool, '', null,
    );
    expect(res.status).toBe(201);
    expect(res.body.gameId).toBe(game.gameId);
    expect(res.body.stationId).toBe('st-1');
    expect(res.body.lat).toBe(51.5);
    expect(res.body.lon).toBe(-0.1);
    expect(res.body.radiusM).toBe(200);
  });

  // ── (b) missing stationId → 400 ───────────────────────────────────────────

  it('(b) missing stationId → 400', async () => {
    const res = await lockHiderZone(
      { method: 'POST', params: { gameId: game.gameId }, body: { lat: 51.5, lon: -0.1, radiusM: 200 } },
      pool, '', null,
    );
    expect(res.status).toBe(400);
  });

  // ── (c) lat as string → 400 ───────────────────────────────────────────────

  it('(c) lat as string instead of number → 400', async () => {
    const res = await lockHiderZone(
      { method: 'POST', params: { gameId: game.gameId }, body: { stationId: 'st-1', lat: '51.5', lon: -0.1, radiusM: 200 } },
      pool, '', null,
    );
    expect(res.status).toBe(400);
  });

  // ── (d) radiusM=0 → 400 ───────────────────────────────────────────────────

  it('(d) radiusM=0 → 400 (must be positive)', async () => {
    const res = await lockHiderZone(
      { method: 'POST', params: { gameId: game.gameId }, body: { stationId: 'st-1', lat: 51.5, lon: -0.1, radiusM: 0 } },
      pool, '', null,
    );
    expect(res.status).toBe(400);
  });

  // ── (e) radiusM=-50 → 400 ─────────────────────────────────────────────────

  it('(e) radiusM=-50 → 400 (negative)', async () => {
    const res = await lockHiderZone(
      { method: 'POST', params: { gameId: game.gameId }, body: { stationId: 'st-1', lat: 51.5, lon: -0.1, radiusM: -50 } },
      pool, '', null,
    );
    expect(res.status).toBe(400);
  });

  // ── (f) second lock for same gameId → 201 with new values ─────────────────

  it('(f) second lockHiderZone for same gameId → 201 with updated zone values', async () => {
    const g = await makeGame(pool);

    const first = await lockHiderZone(
      { method: 'POST', params: { gameId: g.gameId }, body: { stationId: 'st-original', lat: 48.0, lon: 2.0, radiusM: 300 } },
      pool, '', null,
    );
    expect(first.status).toBe(201);

    const second = await lockHiderZone(
      { method: 'POST', params: { gameId: g.gameId }, body: { stationId: 'st-updated', lat: 51.5, lon: -0.1, radiusM: 500 } },
      pool, '', null,
    );
    expect(second.status).toBe(201);
    expect(second.body.gameId).toBe(g.gameId);
    expect(second.body.stationId).toBe('st-updated');
    expect(second.body.lat).toBe(51.5);
    expect(second.body.lon).toBe(-0.1);
    expect(second.body.radiusM).toBe(500);
  });
});
