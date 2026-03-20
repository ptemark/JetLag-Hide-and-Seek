import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCards,
  playCard,
  drawCardInProcess,
  CARD_TYPES,
  cardEffect,
  randomCardDescriptor,
  _getCardStore,
  _getCurseStore,
  _clearCards,
} from './cards.js';
import { HAND_LIMIT } from '../db/gameStore.js';
import { CARD_DRAW_WEIGHTS } from '../config/gameRules.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetReq(query = {}) {
  return { method: 'GET', query };
}

function makePostReq(params = {}, body = {}) {
  return { method: 'POST', params, body };
}

// ---------------------------------------------------------------------------
// cardEffect
// ---------------------------------------------------------------------------

describe('cardEffect', () => {
  it('returns minutesAdded for time_bonus', () => {
    expect(cardEffect('time_bonus')).toEqual({ minutesAdded: 10 });
  });

  it('returns false_zone action for powerup', () => {
    expect(cardEffect('powerup')).toEqual({ action: 'false_zone' });
  });

  it('returns block_questions action for curse', () => {
    const e = cardEffect('curse');
    expect(e.action).toBe('block_questions');
    expect(typeof e.durationMs).toBe('number');
  });

  it('returns empty object for unknown type', () => {
    expect(cardEffect('unknown')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// randomCardDescriptor
// ---------------------------------------------------------------------------

describe('randomCardDescriptor', () => {
  it('returns a card with a valid type', () => {
    const card = randomCardDescriptor();
    expect(CARD_TYPES).toContain(card.type);
  });

  it('includes an effect object', () => {
    const card = randomCardDescriptor();
    expect(typeof card.effect).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// getCards — in-process
// ---------------------------------------------------------------------------

describe('getCards (in-process)', () => {
  beforeEach(() => _clearCards());

  it('returns 405 for non-GET method', () => {
    const res = getCards({ method: 'POST', query: {} });
    expect(res.status).toBe(405);
  });

  it('returns 400 when gameId is missing', () => {
    const res = getCards(makeGetReq({ playerId: 'p1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gameId/);
  });

  it('returns 400 when playerId is missing', () => {
    const res = getCards(makeGetReq({ gameId: 'g1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerId/);
  });

  it('returns 200 with empty hand when no cards drawn', () => {
    const res = getCards(makeGetReq({ gameId: 'g1', playerId: 'p1' }));
    expect(res.status).toBe(200);
    expect(res.body.hand).toEqual([]);
  });

  it('returns only in_hand cards for the correct player/game', () => {
    drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    drawCardInProcess({ gameId: 'g1', playerId: 'p2' }); // different player
    drawCardInProcess({ gameId: 'g2', playerId: 'p1' }); // different game

    const res = getCards(makeGetReq({ gameId: 'g1', playerId: 'p1' }));
    expect(res.status).toBe(200);
    expect(res.body.hand).toHaveLength(1);
    expect(res.body.hand[0].playerId).toBe('p1');
    expect(res.body.hand[0].gameId).toBe('g1');
  });

  it('excludes played cards from the hand', () => {
    const card = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    playCard({ method: 'POST', params: { cardId: card.cardId }, body: { playerId: 'p1' } });

    const res = getCards(makeGetReq({ gameId: 'g1', playerId: 'p1' }));
    expect(res.body.hand).toHaveLength(0);
  });

  it('returns hand with cardId, type, effect, status, drawnAt fields', () => {
    drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    const res = getCards(makeGetReq({ gameId: 'g1', playerId: 'p1' }));
    const card = res.body.hand[0];
    expect(card).toHaveProperty('cardId');
    expect(card).toHaveProperty('type');
    expect(card).toHaveProperty('effect');
    expect(card.status).toBe('in_hand');
    expect(card).toHaveProperty('drawnAt');
  });
});

// ---------------------------------------------------------------------------
// playCard — in-process
// ---------------------------------------------------------------------------

describe('playCard (in-process)', () => {
  beforeEach(() => _clearCards());

  it('returns 405 for non-POST method', async () => {
    const res = await playCard({ method: 'GET', params: { cardId: 'x' }, body: { playerId: 'p1' } });
    expect(res.status).toBe(405);
  });

  it('returns 400 when cardId param is missing', async () => {
    const res = await playCard(makePostReq({}, { playerId: 'p1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cardId/);
  });

  it('returns 400 when playerId is missing from body', async () => {
    const res = await playCard(makePostReq({ cardId: 'c1' }, {}));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerId/);
  });

  it('returns 404 for unknown cardId', async () => {
    const res = await playCard(makePostReq({ cardId: 'nonexistent' }, { playerId: 'p1' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when playerId does not own the card', async () => {
    const card = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    const res = await playCard(makePostReq({ cardId: card.cardId }, { playerId: 'other' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 and the played card on success', async () => {
    const drawn = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    const res = await playCard(makePostReq({ cardId: drawn.cardId }, { playerId: 'p1' }));
    expect(res.status).toBe(200);
    expect(res.body.cardId).toBe(drawn.cardId);
    expect(res.body.status).toBe('played');
    expect(res.body).toHaveProperty('playedAt');
  });

  it('returns 404 when card is played a second time', async () => {
    const drawn = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    await playCard(makePostReq({ cardId: drawn.cardId }, { playerId: 'p1' }));
    const res = await playCard(makePostReq({ cardId: drawn.cardId }, { playerId: 'p1' }));
    expect(res.status).toBe(404);
  });

  it('preserves card effect in the played response', async () => {
    const drawn = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    const res = await playCard(makePostReq({ cardId: drawn.cardId }, { playerId: 'p1' }));
    expect(res.body.effect).toEqual(drawn.effect);
  });
});

// ---------------------------------------------------------------------------
// drawCardInProcess
// ---------------------------------------------------------------------------

describe('drawCardInProcess', () => {
  beforeEach(() => _clearCards());

  it('returns a card with expected fields', () => {
    const card = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    expect(card).not.toBeNull();
    expect(card).toHaveProperty('cardId');
    expect(CARD_TYPES).toContain(card.type);
    expect(card.status).toBe('in_hand');
  });

  it('returns null when hand is already full', () => {
    for (let i = 0; i < HAND_LIMIT; i++) {
      drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    }
    const extra = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    expect(extra).toBeNull();
  });

  it('hand limit is per-game-player, not global', () => {
    for (let i = 0; i < HAND_LIMIT; i++) {
      drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    }
    // Different player — should still be allowed
    const card = drawCardInProcess({ gameId: 'g1', playerId: 'p2' });
    expect(card).not.toBeNull();
  });

  it('adds card to the in-process store', () => {
    drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    expect(_getCardStore().size).toBe(1);
  });

  it('played cards do not count toward hand limit', async () => {
    for (let i = 0; i < HAND_LIMIT; i++) {
      drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    }
    // Play one card to free a slot
    const hand = getCards(makeGetReq({ gameId: 'g1', playerId: 'p1' })).body.hand;
    await playCard(makePostReq({ cardId: hand[0].cardId }, { playerId: 'p1' }));

    const newCard = drawCardInProcess({ gameId: 'g1', playerId: 'p1' });
    expect(newCard).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCards — with mock DB pool
// ---------------------------------------------------------------------------

describe('getCards (with pool)', () => {
  it('calls dbGetPlayerHand and returns 200', async () => {
    const fakeHand = [
      { cardId: 'c1', gameId: 'g1', playerId: 'p1', type: 'curse', effect: {}, status: 'in_hand', drawnAt: new Date().toISOString() },
    ];
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: fakeHand.map(c => ({
        id: c.cardId, game_id: c.gameId, player_id: c.playerId,
        type: c.type, effect: c.effect, status: c.status, drawn_at: c.drawnAt,
      })) }),
    };

    const res = await getCards(makeGetReq({ gameId: 'g1', playerId: 'p1' }), pool);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hand)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// playCard — with mock DB pool
// ---------------------------------------------------------------------------

describe('playCard (with pool)', () => {
  it('returns 404 when dbPlayCard returns null', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const res = await playCard(makePostReq({ cardId: 'c1' }, { playerId: 'p1' }), pool);
    expect(res.status).toBe(404);
  });

  it('returns 200 with played card when dbPlayCard succeeds', async () => {
    const fakeRow = {
      id: 'c1', game_id: 'g1', player_id: 'p1', type: 'powerup',
      effect: { action: 'false_zone' }, status: 'played',
      drawn_at: new Date().toISOString(), played_at: new Date().toISOString(),
    };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [fakeRow] }) };
    const res = await playCard(makePostReq({ cardId: 'c1' }, { playerId: 'p1' }), pool);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('powerup');
    expect(res.body.status).toBe('played');
  });

  it('calls dbSetCurse and notifies server when curse card is played (with pool)', async () => {
    const curseRow = {
      id: 'c-curse', game_id: 'g1', player_id: 'p1', type: 'curse',
      effect: { action: 'block_questions', durationMs: 120_000 }, status: 'played',
      drawn_at: new Date().toISOString(), played_at: new Date().toISOString(),
    };
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [curseRow] })  // dbPlayCard
        .mockResolvedValueOnce({ rows: [] }),           // dbSetCurse (UPDATE games)
    };
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await playCard(
      makePostReq({ cardId: 'c-curse' }, { playerId: 'p1' }),
      pool,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('curse');
    // dbSetCurse was called (second query call)
    expect(pool.query).toHaveBeenCalledTimes(2);
    // notify was fired
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/notify');
    const payload = JSON.parse(opts.body);
    expect(payload.type).toBe('curse_active');
    expect(payload.gameId).toBe('g1');
    expect(payload.curseEndsAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Curse card (in-process)
// ---------------------------------------------------------------------------

describe('curse card (in-process)', () => {
  beforeEach(() => _clearCards());

  it('populates _curses map when a curse card is played', async () => {
    // Math.floor(0.9 * 3) = 2 → CARD_TYPES[2] = 'curse'
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const card = drawCardInProcess({ gameId: 'g-curse', playerId: 'p1' });
    vi.restoreAllMocks();
    expect(card.type).toBe('curse');

    await playCard(makePostReq({ cardId: card.cardId }, { playerId: 'p1' }));
    const curses = _getCurseStore();
    expect(curses.has('g-curse')).toBe(true);
    expect(new Date(curses.get('g-curse')).getTime()).toBeGreaterThan(Date.now());
  });

  it('fires notify to game server when curse card is played', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const card = drawCardInProcess({ gameId: 'g-notify', playerId: 'p1' });
    vi.restoreAllMocks();

    const mockFetch = vi.fn().mockResolvedValue({});
    await playCard(
      makePostReq({ cardId: card.cardId }, { playerId: 'p1' }),
      null,
      'http://game-server',
      mockFetch,
    );
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.type).toBe('curse_active');
    expect(payload.gameId).toBe('g-notify');
    expect(payload.curseEndsAt).toBeTruthy();
  });

  it('does not populate _curses when a non-curse card is played', async () => {
    // Math.floor(0 * 3) = 0 → CARD_TYPES[0] = 'time_bonus'
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const card = drawCardInProcess({ gameId: 'g-nc', playerId: 'p1' });
    vi.restoreAllMocks();
    expect(card.type).toBe('time_bonus');

    await playCard(makePostReq({ cardId: card.cardId }, { playerId: 'p1' }));
    expect(_getCurseStore().has('g-nc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Time bonus card (in-process)
// ---------------------------------------------------------------------------

describe('time_bonus card (in-process)', () => {
  beforeEach(() => _clearCards());

  it('fires notify to game server when time_bonus card is played (in-process)', async () => {
    // Math.floor(0 * 3) = 0 → CARD_TYPES[0] = 'time_bonus'
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const card = drawCardInProcess({ gameId: 'g-tb', playerId: 'p1' });
    vi.restoreAllMocks();
    expect(card.type).toBe('time_bonus');

    const mockFetch = vi.fn().mockResolvedValue({});
    await playCard(
      makePostReq({ cardId: card.cardId }, { playerId: 'p1' }),
      null,
      'http://game-server',
      mockFetch,
    );
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/notify');
    const payload = JSON.parse(opts.body);
    expect(payload.type).toBe('time_bonus');
    expect(payload.gameId).toBe('g-tb');
    expect(payload.minutesAdded).toBe(10);
  });

  it('does not fire notify when no game server URL is configured', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const card = drawCardInProcess({ gameId: 'g-tb-nofetch', playerId: 'p1' });
    vi.restoreAllMocks();

    const mockFetch = vi.fn().mockResolvedValue({});
    // No gameServerUrl argument, GAME_SERVER_URL env not set
    await playCard(makePostReq({ cardId: card.cardId }, { playerId: 'p1' }), null, undefined, mockFetch);
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Powerup card (in-process)
// ---------------------------------------------------------------------------

describe('powerup card (in-process)', () => {
  beforeEach(() => _clearCards());

  it('fires false_zone notify to game server when powerup card is played', async () => {
    // Math.floor(0.4 * 3) = 1 → CARD_TYPES[1] = 'powerup'
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const card = drawCardInProcess({ gameId: 'g-pu', playerId: 'p1' });
    vi.restoreAllMocks();
    expect(card.type).toBe('powerup');

    const mockFetch = vi.fn().mockResolvedValue({});
    await playCard(
      makePostReq({ cardId: card.cardId }, { playerId: 'p1' }),
      null,
      'http://game-server',
      mockFetch,
    );
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/notify');
    const payload = JSON.parse(opts.body);
    expect(payload.type).toBe('false_zone');
    expect(payload.gameId).toBe('g-pu');
  });

  it('does not fire notify for powerup when no game server URL is configured', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const card = drawCardInProcess({ gameId: 'g-pu-nourl', playerId: 'p1' });
    vi.restoreAllMocks();

    const mockFetch = vi.fn().mockResolvedValue({});
    await playCard(makePostReq({ cardId: card.cardId }, { playerId: 'p1' }), null, undefined, mockFetch);
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Powerup card (with mock DB pool)
// ---------------------------------------------------------------------------

describe('powerup card (with pool)', () => {
  it('fires false_zone notify for powerup card when pool is provided', async () => {
    const powerupRow = {
      id: 'c-pu', game_id: 'g1', player_id: 'p1', type: 'powerup',
      effect: { action: 'false_zone' }, status: 'played',
      drawn_at: new Date().toISOString(), played_at: new Date().toISOString(),
    };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [powerupRow] }) };
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await playCard(
      makePostReq({ cardId: 'c-pu' }, { playerId: 'p1' }),
      pool,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('powerup');
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/notify');
    const payload = JSON.parse(opts.body);
    expect(payload.type).toBe('false_zone');
    expect(payload.gameId).toBe('g1');
  });
});

// ---------------------------------------------------------------------------
// Time bonus card (with mock DB pool)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Weighted card draw — randomCardDescriptor / drawCardInProcess
// ---------------------------------------------------------------------------

describe('randomCardDescriptor — weighted draw', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses photo weights: time_bonus drawn at higher rate than equal probability', () => {
    // photo weights: time_bonus=0.55, powerup=0.30, curse=0.15
    // Over 1000 samples, time_bonus count should exceed 1/3 * 1000 = 333 by a meaningful margin.
    // Tolerance: expect ≥ 420 (well below 550 expected - 3*sqrt(550*0.45) ≈ 106)
    const SAMPLES = 1000;
    let timeBonusCount = 0;
    for (let i = 0; i < SAMPLES; i++) {
      if (randomCardDescriptor('photo').type === 'time_bonus') timeBonusCount++;
    }
    expect(timeBonusCount).toBeGreaterThan(420);
    expect(timeBonusCount).toBeLessThan(680); // sanity upper bound
  });

  it('uses tentacle weights: curse drawn at higher rate than equal probability', () => {
    // tentacle weights: time_bonus=0.25, powerup=0.30, curse=0.45
    const SAMPLES = 1000;
    let curseCount = 0;
    for (let i = 0; i < SAMPLES; i++) {
      if (randomCardDescriptor('tentacle').type === 'curse') curseCount++;
    }
    expect(curseCount).toBeGreaterThan(330); // above equal-probability floor
    expect(curseCount).toBeLessThan(570); // sanity upper bound
  });

  it('falls back to equal weights for unknown category', () => {
    const SAMPLES = 3000;
    const counts = { time_bonus: 0, powerup: 0, curse: 0 };
    for (let i = 0; i < SAMPLES; i++) {
      counts[randomCardDescriptor('unknown_category').type]++;
    }
    // Each type should be roughly 1000 ± 200 (very conservative tolerance)
    for (const type of Object.keys(counts)) {
      expect(counts[type]).toBeGreaterThan(800);
      expect(counts[type]).toBeLessThan(1200);
    }
  });

  it('falls back to equal weights when no category is provided', () => {
    const SAMPLES = 3000;
    const counts = { time_bonus: 0, powerup: 0, curse: 0 };
    for (let i = 0; i < SAMPLES; i++) {
      counts[randomCardDescriptor().type]++;
    }
    for (const type of Object.keys(counts)) {
      expect(counts[type]).toBeGreaterThan(800);
      expect(counts[type]).toBeLessThan(1200);
    }
  });

  it('produces a valid card type for every configured category', () => {
    for (const category of Object.keys(CARD_DRAW_WEIGHTS)) {
      const card = randomCardDescriptor(category);
      expect(CARD_TYPES).toContain(card.type);
      expect(typeof card.effect).toBe('object');
    }
  });
});

describe('drawCardInProcess — weighted draw by questionCategory', () => {
  beforeEach(() => _clearCards());
  afterEach(() => vi.restoreAllMocks());

  it('photo category: draws time_bonus cards at configured higher rate over 1000 iterations', () => {
    const SAMPLES = 1000;
    let timeBonusCount = 0;
    for (let i = 0; i < SAMPLES; i++) {
      _clearCards();
      const card = drawCardInProcess({ gameId: 'g1', playerId: 'p1', questionCategory: 'photo' });
      if (card && card.type === 'time_bonus') timeBonusCount++;
    }
    // photo time_bonus weight is 0.55 → expect well above equal-probability floor of 333
    expect(timeBonusCount).toBeGreaterThan(420);
  });

  it('unknown category falls back to equal weights', () => {
    const SAMPLES = 3000;
    const counts = { time_bonus: 0, powerup: 0, curse: 0 };
    for (let i = 0; i < SAMPLES; i++) {
      _clearCards();
      const card = drawCardInProcess({ gameId: 'g1', playerId: 'p1', questionCategory: 'unknown' });
      if (card) counts[card.type]++;
    }
    for (const type of Object.keys(counts)) {
      expect(counts[type]).toBeGreaterThan(800);
      expect(counts[type]).toBeLessThan(1200);
    }
  });

  it('each configured category produces a valid card type', () => {
    for (const category of Object.keys(CARD_DRAW_WEIGHTS)) {
      _clearCards();
      const card = drawCardInProcess({ gameId: 'g1', playerId: 'p1', questionCategory: category });
      expect(card).not.toBeNull();
      expect(CARD_TYPES).toContain(card.type);
    }
  });
});

describe('time_bonus card (with pool)', () => {
  it('fires notify for time_bonus card when pool is provided', async () => {
    const timeBonusRow = {
      id: 'c-tb', game_id: 'g1', player_id: 'p1', type: 'time_bonus',
      effect: { minutesAdded: 10 }, status: 'played',
      drawn_at: new Date().toISOString(), played_at: new Date().toISOString(),
    };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [timeBonusRow] }) };
    const mockFetch = vi.fn().mockResolvedValue({});
    const res = await playCard(
      makePostReq({ cardId: 'c-tb' }, { playerId: 'p1' }),
      pool,
      'http://game-server',
      mockFetch,
    );
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('time_bonus');
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://game-server/internal/notify');
    const payload = JSON.parse(opts.body);
    expect(payload.type).toBe('time_bonus');
    expect(payload.gameId).toBe('g1');
    expect(payload.minutesAdded).toBe(10);
  });
});
