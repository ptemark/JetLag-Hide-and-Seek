import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGame,
  handleCreateGame,
  getGame,
  handleStartGame,
  VALID_SIZES,
  SCALE_DURATION_RANGES,
  _getStore,
  _clearStore,
} from './games.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePostReq(params = {}, body = {}) {
  return { method: 'POST', params, body };
}

function makeGetReq(params = {}) {
  return { method: 'GET', params };
}

// ---------------------------------------------------------------------------
// createGame (in-process)
// ---------------------------------------------------------------------------

describe('createGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('creates a game with default medium size', () => {
    const game = createGame();
    expect(game.size).toBe('medium');
    expect(game.status).toBe('waiting');
    expect(typeof game.gameId).toBe('string');
  });

  it('creates a game with the given size', () => {
    for (const size of VALID_SIZES) {
      const game = createGame({ size });
      expect(game.size).toBe(size);
    }
  });

  it('throws for an invalid size', () => {
    expect(() => createGame({ size: 'huge' })).toThrow(/size/);
  });

  it('throws for an invalid seekerTeams value', () => {
    expect(() => createGame({ seekerTeams: 3 })).toThrow(/seekerTeams/);
  });

  it('stores the game in the in-process map', () => {
    const game = createGame({ size: 'small' });
    expect(_getStore().has(game.gameId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleCreateGame (in-process)
// ---------------------------------------------------------------------------

describe('handleCreateGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('returns 405 for non-POST', () => {
    const res = handleCreateGame({ method: 'GET', body: {} });
    expect(res.status).toBe(405);
  });

  it('returns 201 with a new game on valid POST', () => {
    const res = handleCreateGame(makePostReq({}, { size: 'small' }));
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('small');
    expect(res.body.status).toBe('waiting');
  });

  it('returns 400 for invalid size', () => {
    const res = handleCreateGame(makePostReq({}, { size: 'giant' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/size/);
  });
});

// ---------------------------------------------------------------------------
// getGame (in-process)
// ---------------------------------------------------------------------------

describe('getGame (in-process)', () => {
  beforeEach(() => _clearStore());

  it('returns 405 for non-GET', () => {
    const res = getGame({ method: 'POST', params: { id: 'x' } });
    expect(res.status).toBe(405);
  });

  it('returns 400 when id is missing', () => {
    const res = getGame(makeGetReq({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/game id/i);
  });

  it('returns 404 for unknown game', () => {
    const res = getGame(makeGetReq({ id: 'nonexistent' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 with the game when found', () => {
    const game = createGame({ size: 'large' });
    const res = getGame(makeGetReq({ id: game.gameId }));
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe(game.gameId);
    expect(res.body.size).toBe('large');
  });
});

// ---------------------------------------------------------------------------
// handleStartGame
// ---------------------------------------------------------------------------

describe('handleStartGame', () => {
  it('returns 405 for non-POST', () => {
    const res = handleStartGame({ method: 'GET', params: { gameId: 'g1' }, body: null });
    expect(res.status).toBe(405);
  });

  it('returns 400 when gameId is missing from params', () => {
    const res = handleStartGame(makePostReq({}, { scale: 'medium' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/);
  });

  it('returns 204 without calling fetch when no game server URL is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium' }),
      null,
      undefined,
      mockFetch,
    );
    expect(res.status).toBe(204);
    // Fire-and-forget is enqueued as a microtask; flush the queue.
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 204 and notifies the managed server with gameId and scale', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'large' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/games/g1/start');
    expect(opts.method).toBe('POST');
    const payload = JSON.parse(opts.body);
    expect(payload.scale).toBe('large');
  });

  it('URL-encodes the gameId in the notify request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    handleStartGame(
      makePostReq({ gameId: 'game/with/slashes' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    await new Promise(r => setTimeout(r, 0));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/games/game%2Fwith%2Fslashes/start');
  });

  it('silently swallows notify errors so the 204 response is unaffected', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small' }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    // Should not throw after the rejected promise is handled.
    await expect(new Promise(r => setTimeout(r, 10))).resolves.toBeUndefined();
  });

  // Task 74 — configurable hiding duration
  it('returns 400 when hidingDurationMin is below scale minimum', () => {
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small', hidingDurationMin: 10 }),
      null,
      undefined,
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/out of range/i);
  });

  it('returns 400 when hidingDurationMin exceeds scale maximum', () => {
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'medium', hidingDurationMin: 300 }),
      null,
      undefined,
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/out of range/i);
  });

  it('returns 400 when hidingDurationMin is set but scale is missing', () => {
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { hidingDurationMin: 45 }),
      null,
      undefined,
      vi.fn(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scale required/i);
  });

  it('passes hidingDurationMs to managed server when hidingDurationMin is valid', async () => {
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = handleStartGame(
      makePostReq({ gameId: 'g1' }, { scale: 'small', hidingDurationMin: 45 }),
      null,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(204);
    await new Promise(r => setTimeout(r, 0));
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.hidingDurationMs).toBe(45 * 60_000);
    expect(payload.seekingDurationMs).toBe(45 * 60_000);
  });

  it('SCALE_DURATION_RANGES exports correct bounds for each scale', () => {
    expect(SCALE_DURATION_RANGES.small).toEqual({ min: 30, max: 60 });
    expect(SCALE_DURATION_RANGES.medium).toEqual({ min: 60, max: 180 });
    expect(SCALE_DURATION_RANGES.large).toEqual({ min: 180, max: 360 });
  });
});
