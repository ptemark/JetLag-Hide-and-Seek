/**
 * cards.js — Serverless handlers for the challenge card system.
 *
 * The Hider Deck contains three card types:
 *   time_bonus  — adds extra minutes to the hiding-phase timer
 *   powerup     — positive effect for the hider (creates a decoy zone)
 *   curse       — negative effect on seekers (blocks questions temporarily)
 *
 * Routes:
 *   GET  /cards?gameId=&playerId=  — return current hand (max 6 cards)
 *   POST /cards/:cardId/play       — play a card; apply its effect
 *
 * All handlers accept an optional pg Pool as a second argument.
 * When omitted they fall back to an in-process Map (tests / local dev).
 */

import { randomUUID } from 'node:crypto';
import {
  dbDrawCard,
  dbGetPlayerHand,
  dbPlayCard,
  dbSetCurse,
  HAND_LIMIT,
} from '../db/gameStore.js';

// ── Card catalogue ────────────────────────────────────────────────────────────

export const CARD_TYPES = ['time_bonus', 'powerup', 'curse'];

/**
 * Return the canonical effect payload for a given card type.
 *
 * @param {string} type
 * @returns {object}
 */
export function cardEffect(type) {
  switch (type) {
    case 'time_bonus': return { minutesAdded: 10 };
    case 'powerup':    return { action: 'false_zone' };
    case 'curse':      return { action: 'block_questions', durationMs: 120_000 };
    default:           return {};
  }
}

/**
 * Pick a random card type and build a card descriptor.
 * Exported for use by the questions handler (card-draw trigger).
 *
 * @returns {{ type: string, effect: object }}
 */
export function randomCardDescriptor() {
  const type = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
  return { type, effect: cardEffect(type) };
}

// ── In-process stores (no DB pool) ───────────────────────────────────────────

/** @type {Map<string, object>} cardId → card */
const _cards = new Map();

/**
 * In-process curse store: gameId → curseEndsAt (ISO string).
 * Shared with questions.js so the submitQuestion handler can enforce the curse
 * without a DB pool.  Exported for import by questions.js and for test inspection.
 * @type {Map<string, string>}
 */
export const _curses = new Map();

/** Return a copy of the in-process card store (for testing). */
export function _getCardStore() { return new Map(_cards); }

/** Return a copy of the in-process curse store (for testing). */
export function _getCurseStore() { return new Map(_curses); }

/** Clear in-process card and curse stores (for test isolation). */
export function _clearCards() { _cards.clear(); _curses.clear(); }

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /cards?gameId=&playerId=
 *
 * Returns the player's current hand of in-hand cards (max HAND_LIMIT).
 *
 * @param {{ method: string, query?: Record<string, string> }} req
 * @param {import('pg').Pool|null} [pool]
 * @returns {{ status: number, body: object } | Promise<{ status: number, body: object }>}
 */
export function getCards(req, pool = null) {
  if (req.method !== 'GET') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { gameId, playerId } = req.query ?? {};
  if (!gameId   || typeof gameId   !== 'string') return { status: 400, body: { error: 'gameId query parameter is required' } };
  if (!playerId || typeof playerId !== 'string') return { status: 400, body: { error: 'playerId query parameter is required' } };

  if (pool) {
    return dbGetPlayerHand(pool, { gameId, playerId }).then(hand => ({
      status: 200,
      body: { gameId, playerId, hand },
    }));
  }

  const hand = [..._cards.values()]
    .filter(c => c.gameId === gameId && c.playerId === playerId && c.status === 'in_hand')
    .sort((a, b) => (a.drawnAt < b.drawnAt ? -1 : 1));
  return { status: 200, body: { gameId, playerId, hand } };
}

/**
 * Activate a curse for a game: persist to DB (if pool) or in-process map,
 * then fire-and-forget notify the managed server so it can broadcast
 * `curse_active` to all connected players.
 *
 * @param {{ gameId: string, durationMs: number }} options
 * @param {import('pg').Pool|null} pool
 * @param {string|undefined} gameServerUrl
 * @param {typeof fetch} fetchFn
 * @returns {string} curseEndsAt ISO string
 */
async function activateCurse({ gameId, durationMs }, pool, gameServerUrl, fetchFn) {
  const curseEndsAt = new Date(Date.now() + durationMs).toISOString();

  if (pool) {
    await dbSetCurse(pool, gameId, curseEndsAt);
  } else {
    _curses.set(gameId, curseEndsAt);
  }

  const serverUrl = gameServerUrl ?? process.env.GAME_SERVER_URL;
  if (serverUrl && fetchFn) {
    Promise.resolve(fetchFn(`${serverUrl}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'curse_active', gameId, curseEndsAt }),
    })).catch(() => { /* intentionally silent */ });
  }

  return curseEndsAt;
}

/**
 * POST /cards/:cardId/play
 * Body: { playerId }
 *
 * Marks the card as played and returns it with its effect payload so the
 * caller can apply the game-mechanic change.  If the card is a curse, the
 * question-blocking effect is activated server-side and broadcast to all
 * players via the managed server's /internal/notify endpoint.
 *
 * @param {{ method: string, params: { cardId: string }, body: unknown }} req
 * @param {import('pg').Pool|null} [pool]
 * @param {string} [gameServerUrl]  Override for GAME_SERVER_URL env var.
 * @param {typeof fetch} [fetchFn]  Injectable fetch (tests / local dev).
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function playCard(req, pool = null, gameServerUrl, fetchFn = globalThis.fetch) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { cardId } = req.params ?? {};
  if (!cardId || typeof cardId !== 'string') {
    return { status: 400, body: { error: 'cardId param is required' } };
  }

  const { playerId } = req.body ?? {};
  if (!playerId || typeof playerId !== 'string') {
    return { status: 400, body: { error: 'playerId is required' } };
  }

  if (pool) {
    const card = await dbPlayCard(pool, { cardId, playerId });
    if (!card) return { status: 404, body: { error: 'card not found or already played' } };
    if (card.type === 'curse' && card.effect?.action === 'block_questions' && card.gameId) {
      await activateCurse(
        { gameId: card.gameId, durationMs: card.effect.durationMs ?? 120_000 },
        pool,
        gameServerUrl,
        fetchFn,
      );
    }
    return { status: 200, body: card };
  }

  const card = _cards.get(cardId);
  if (!card) return { status: 404, body: { error: 'card not found or already played' } };
  if (card.playerId !== playerId) return { status: 404, body: { error: 'card not found or already played' } };
  if (card.status !== 'in_hand') return { status: 404, body: { error: 'card not found or already played' } };

  const played = { ...card, status: 'played', playedAt: new Date().toISOString() };
  _cards.set(cardId, played);

  if (card.type === 'curse' && card.effect?.action === 'block_questions' && card.gameId) {
    await activateCurse(
      { gameId: card.gameId, durationMs: card.effect.durationMs ?? 120_000 },
      null,
      gameServerUrl,
      fetchFn,
    );
  }

  return { status: 200, body: played };
}

/**
 * Draw a random card for a player and add it to their in-process hand.
 * Used by the questions handler as a fire-and-forget side effect when
 * no DB pool is available.
 * Returns null if the hand is already full (HAND_LIMIT).
 *
 * @param {{ gameId: string, playerId: string }} options
 * @returns {{ cardId: string, gameId: string, playerId: string, type: string, effect: object, status: string, drawnAt: string } | null}
 */
export function drawCardInProcess({ gameId, playerId }) {
  const handSize = [..._cards.values()]
    .filter(c => c.gameId === gameId && c.playerId === playerId && c.status === 'in_hand')
    .length;
  if (handSize >= HAND_LIMIT) return null;

  const { type, effect } = randomCardDescriptor();
  const card = {
    cardId: randomUUID(),
    gameId,
    playerId,
    type,
    effect,
    status: 'in_hand',
    drawnAt: new Date().toISOString(),
  };
  _cards.set(card.cardId, card);
  return card;
}
