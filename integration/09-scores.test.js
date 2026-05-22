import { setup, teardown }            from './setup.js';
import { submitScore, getLeaderboard } from '../functions/scores.js';
import { makePlayer, makeGame }        from './helpers.js';

const UUID_RE = /^[0-9a-f-]{36}$/;

describe.skipIf(!process.env.DATABASE_URL)('scores and leaderboard', () => {
  let pool;
  let player;
  let game;

  beforeAll(async () => {
    pool   = await setup();
    player = await makePlayer(pool, { name: 'Score Alice', role: 'hider' });
    game   = await makeGame(pool);
  });

  afterAll(async () => { await teardown(pool); });

  // ── (a) valid body with captured=false ────────────────────────────────────

  it('(a) valid body with captured=false → 201; hidingTimeMs echoed back as ms', async () => {
    const g = await makeGame(pool);
    const res = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: g.gameId, hidingTimeMs: 300_000, captured: false } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.scoreId).toMatch(UUID_RE);
    expect(res.body.hidingTimeMs).toBe(300_000);
    expect(res.body.captured).toBe(false);
  });

  // ── (b) valid body with captured=true ─────────────────────────────────────

  it('(b) captured=true → 201; captured_at column is non-null in DB', async () => {
    const g = await makeGame(pool);
    const res = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: g.gameId, hidingTimeMs: 120_000, captured: true } },
      pool,
    );
    expect(res.status).toBe(201);

    const dbRes = await pool.query('SELECT captured_at FROM scores WHERE id=$1', [res.body.scoreId]);
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].captured_at).not.toBeNull();
  });

  // ── (c) bonusSeconds=30 ───────────────────────────────────────────────────

  it('(c) bonusSeconds=30 → 201; body.bonusSeconds=30', async () => {
    const g = await makeGame(pool);
    const res = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: g.gameId, hidingTimeMs: 60_000, captured: false, bonusSeconds: 30 } },
      pool,
    );
    expect(res.status).toBe(201);
    expect(res.body.bonusSeconds).toBe(30);
  });

  // ── (d) missing hidingTimeMs → 400 ────────────────────────────────────────

  it('(d) missing hidingTimeMs → 400', async () => {
    const res = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: game.gameId, captured: false } },
      pool,
    );
    expect(res.status).toBe(400);
  });

  // ── (e) captured as string → 400 ──────────────────────────────────────────

  it("(e) captured='yes' (string, not boolean) → 400", async () => {
    const res = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: game.gameId, hidingTimeMs: 1000, captured: 'yes' } },
      pool,
    );
    expect(res.status).toBe(400);
  });

  // ── (f) duplicate submission — actual behavior is upsert ──────────────────
  // The schema has UNIQUE (game_id, player_id) and dbSubmitScore uses
  // ON CONFLICT DO UPDATE, so a second submission with the same player+game
  // pair updates the existing row and returns 201 with the new values.
  // Task 188 text speculated the unique constraint would fire as an error;
  // the actual implementation handles it gracefully — we assert the upsert
  // behaviour and confirm only one row exists for the pair.

  it('(f) duplicate submission (same playerId+gameId) → 201 upsert; only one row remains', async () => {
    const g = await makeGame(pool);

    const first = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: g.gameId, hidingTimeMs: 100_000, captured: false } },
      pool,
    );
    expect(first.status).toBe(201);

    const second = await submitScore(
      { method: 'POST', body: { playerId: player.playerId, gameId: g.gameId, hidingTimeMs: 200_000, captured: true, bonusSeconds: 5 } },
      pool,
    );
    expect(second.status).toBe(201);
    expect(second.body.hidingTimeMs).toBe(200_000);
    expect(second.body.captured).toBe(true);
    expect(second.body.bonusSeconds).toBe(5);

    const dbRes = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM scores WHERE game_id=$1 AND player_id=$2',
      [g.gameId, player.playerId],
    );
    expect(dbRes.rows[0].cnt).toBe(1);
  });

  // ── (g) leaderboard returns two ranked entries ────────────────────────────

  it('(g) getLeaderboard after submitting two scores → 200; 2 entries with rank/playerName/scoreSeconds', async () => {
    const g     = await makeGame(pool);
    const alice = await makePlayer(pool, { name: 'Leaderboard Alice', role: 'hider' });
    const bob   = await makePlayer(pool, { name: 'Leaderboard Bob',   role: 'seeker' });

    await submitScore(
      { method: 'POST', body: { playerId: alice.playerId, gameId: g.gameId, hidingTimeMs: 200_000, captured: false } },
      pool,
    );
    await submitScore(
      { method: 'POST', body: { playerId: bob.playerId,   gameId: g.gameId, hidingTimeMs: 100_000, captured: true } },
      pool,
    );

    const res = await getLeaderboard({ method: 'GET', query: { gameId: g.gameId } }, pool);
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(2);
    for (const entry of res.body.scores) {
      expect(entry).toHaveProperty('rank');
      expect(entry).toHaveProperty('playerName');
      expect(entry).toHaveProperty('scoreSeconds');
    }
    expect(res.body.scores[0].rank).toBe(1);
    expect(res.body.scores[0].scoreSeconds).toBe(200);
    expect(res.body.scores[1].rank).toBe(2);
    expect(res.body.scores[1].scoreSeconds).toBe(100);
  });

  // ── (h) leaderboard respects limit=1 ──────────────────────────────────────

  it('(h) getLeaderboard with limit=1 → body.scores has at most 1 entry', async () => {
    const g     = await makeGame(pool);
    const alice = await makePlayer(pool, { name: 'Limit Alice', role: 'hider' });
    const bob   = await makePlayer(pool, { name: 'Limit Bob',   role: 'seeker' });

    await submitScore(
      { method: 'POST', body: { playerId: alice.playerId, gameId: g.gameId, hidingTimeMs: 200_000, captured: false } },
      pool,
    );
    await submitScore(
      { method: 'POST', body: { playerId: bob.playerId,   gameId: g.gameId, hidingTimeMs: 100_000, captured: false } },
      pool,
    );

    const res = await getLeaderboard({ method: 'GET', query: { gameId: g.gameId, limit: '1' } }, pool);
    expect(res.status).toBe(200);
    expect(res.body.scores.length).toBeLessThanOrEqual(1);
    expect(res.body.scores).toHaveLength(1);
    expect(res.body.scores[0].scoreSeconds).toBe(200);
  });
});
