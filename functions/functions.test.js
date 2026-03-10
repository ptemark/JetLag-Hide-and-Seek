import { describe, it, expect, beforeEach } from 'vitest';
import { registerPlayer, VALID_ROLES, _clearStore as clearPlayers, _getStore as getPlayerStore } from './players.js';
import { getGame, createGame, handleCreateGame, VALID_SIZES, _clearStore as clearGames, _getStore as getGameStore } from './games.js';
import { submitScore, _clearStore as clearScores, _getStore as getScoreStore } from './scores.js';

// ---------------------------------------------------------------------------
// players.js
// ---------------------------------------------------------------------------

describe('registerPlayer', () => {
  beforeEach(() => clearPlayers());

  it('returns 405 for non-POST requests', () => {
    const res = registerPlayer({ method: 'GET', body: { name: 'Alice', role: 'hider' } });
    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/Method Not Allowed/i);
  });

  it('returns 400 when name is missing', () => {
    const res = registerPlayer({ method: 'POST', body: { role: 'hider' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when name is blank', () => {
    const res = registerPlayer({ method: 'POST', body: { name: '   ', role: 'hider' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when role is invalid', () => {
    const res = registerPlayer({ method: 'POST', body: { name: 'Alice', role: 'unknown' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it.each(VALID_ROLES)('registers player with role "%s"', (role) => {
    const res = registerPlayer({ method: 'POST', body: { name: 'Alice', role } });
    expect(res.status).toBe(201);
    expect(res.body.playerId).toBeTruthy();
    expect(res.body.name).toBe('Alice');
    expect(res.body.role).toBe(role);
    expect(res.body.createdAt).toBeTruthy();
  });

  it('trims whitespace from name', () => {
    const res = registerPlayer({ method: 'POST', body: { name: '  Bob  ', role: 'seeker' } });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bob');
  });

  it('persists player in store', () => {
    const res = registerPlayer({ method: 'POST', body: { name: 'Carol', role: 'hider' } });
    const store = getPlayerStore();
    expect(store.has(res.body.playerId)).toBe(true);
  });

  it('assigns unique playerIds for distinct registrations', () => {
    const r1 = registerPlayer({ method: 'POST', body: { name: 'A', role: 'hider' } });
    const r2 = registerPlayer({ method: 'POST', body: { name: 'B', role: 'seeker' } });
    expect(r1.body.playerId).not.toBe(r2.body.playerId);
  });
});

// ---------------------------------------------------------------------------
// games.js
// ---------------------------------------------------------------------------

describe('createGame', () => {
  beforeEach(() => clearGames());

  it.each(VALID_SIZES)('creates game with size "%s"', (size) => {
    const game = createGame({ size });
    expect(game.gameId).toBeTruthy();
    expect(game.size).toBe(size);
    expect(game.status).toBe('waiting');
    expect(Array.isArray(game.players)).toBe(true);
  });

  it('defaults to medium size', () => {
    const game = createGame();
    expect(game.size).toBe('medium');
  });

  it('throws for invalid size', () => {
    expect(() => createGame({ size: 'huge' })).toThrow(/size/i);
  });

  it('persists game in store', () => {
    const game = createGame({ size: 'small' });
    const store = getGameStore();
    expect(store.has(game.gameId)).toBe(true);
  });
});

describe('handleCreateGame', () => {
  beforeEach(() => clearGames());

  it('returns 405 for non-POST requests', () => {
    const res = handleCreateGame({ method: 'GET', body: {} });
    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/Method Not Allowed/i);
  });

  it('creates a game with default medium size', () => {
    const res = handleCreateGame({ method: 'POST', body: {} });
    expect(res.status).toBe(201);
    expect(res.body.gameId).toBeTruthy();
    expect(res.body.size).toBe('medium');
    expect(res.body.status).toBe('waiting');
  });

  it('creates a game with specified size', () => {
    const res = handleCreateGame({ method: 'POST', body: { size: 'small' } });
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('small');
  });

  it('returns 400 for invalid size', () => {
    const res = handleCreateGame({ method: 'POST', body: { size: 'huge' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/size/i);
  });

  it('accepts bounds in the request body', () => {
    const bounds = { lat_min: 48, lat_max: 49, lon_min: 2, lon_max: 3 };
    const res = handleCreateGame({ method: 'POST', body: { size: 'large', bounds } });
    expect(res.status).toBe(201);
    expect(res.body.gameId).toBeTruthy();
  });

  it('handles missing body gracefully', () => {
    const res = handleCreateGame({ method: 'POST' });
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('medium');
  });
});

describe('getGame', () => {
  beforeEach(() => clearGames());

  it('returns 405 for non-GET requests', () => {
    const game = createGame();
    const res = getGame({ method: 'POST', params: { id: game.gameId } });
    expect(res.status).toBe(405);
  });

  it('returns 400 when id is missing', () => {
    const res = getGame({ method: 'GET', params: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id/i);
  });

  it('returns 404 for unknown game id', () => {
    const res = getGame({ method: 'GET', params: { id: 'nonexistent' } });
    expect(res.status).toBe(404);
  });

  it('returns 200 with game data for valid id', () => {
    const game = createGame({ size: 'large' });
    const res = getGame({ method: 'GET', params: { id: game.gameId } });
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe(game.gameId);
    expect(res.body.size).toBe('large');
    expect(res.body.status).toBe('waiting');
  });
});

// ---------------------------------------------------------------------------
// scores.js
// ---------------------------------------------------------------------------

describe('submitScore', () => {
  beforeEach(() => clearScores());

  it('returns 405 for non-POST requests', () => {
    const res = submitScore({ method: 'GET', body: {} });
    expect(res.status).toBe(405);
  });

  it('returns 400 when playerId is missing', () => {
    const res = submitScore({ method: 'POST', body: { gameId: 'g1', hidingTimeMs: 1000, captured: true } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerId/i);
  });

  it('returns 400 when gameId is missing', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', hidingTimeMs: 1000, captured: true } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/i);
  });

  it('returns 400 when hidingTimeMs is negative', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: -1, captured: false } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hidingTimeMs/i);
  });

  it('returns 400 when hidingTimeMs is not a number', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 'fast', captured: false } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when captured is not boolean', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 1000, captured: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captured/i);
  });

  it('creates score with captured=true', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 3600000, captured: true } });
    expect(res.status).toBe(201);
    expect(res.body.scoreId).toBeTruthy();
    expect(res.body.playerId).toBe('p1');
    expect(res.body.gameId).toBe('g1');
    expect(res.body.hidingTimeMs).toBe(3600000);
    expect(res.body.captured).toBe(true);
    expect(res.body.submittedAt).toBeTruthy();
  });

  it('creates score with captured=false (hider wins)', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p2', gameId: 'g2', hidingTimeMs: 7200000, captured: false } });
    expect(res.status).toBe(201);
    expect(res.body.captured).toBe(false);
  });

  it('allows hidingTimeMs of zero', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 0, captured: true } });
    expect(res.status).toBe(201);
    expect(res.body.hidingTimeMs).toBe(0);
  });

  it('persists score in store', () => {
    const res = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 500, captured: false } });
    const store = getScoreStore();
    expect(store.has(res.body.scoreId)).toBe(true);
  });

  it('assigns unique scoreIds', () => {
    const r1 = submitScore({ method: 'POST', body: { playerId: 'p1', gameId: 'g1', hidingTimeMs: 100, captured: false } });
    const r2 = submitScore({ method: 'POST', body: { playerId: 'p2', gameId: 'g1', hidingTimeMs: 200, captured: true } });
    expect(r1.body.scoreId).not.toBe(r2.body.scoreId);
  });
});
