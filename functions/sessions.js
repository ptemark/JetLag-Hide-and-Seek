/**
 * sessions.js — Serverless handlers for WebSocket session lifecycle.
 *
 * POST /sessions { playerId, gameId } → create a session token and return
 *   connection info the client uses to open a WebSocket connection.
 *
 * DELETE /sessions/:sessionId → mark a session terminated; the WS server
 *   uses session tokens to validate connections and will reject terminated
 *   ones on the next heartbeat / reconnect attempt.
 *
 * Sessions are short-lived records: they carry no heavy state.  The
 * in-process Map is used in tests / local dev; pass a store object (with
 * get/set/delete/has) to swap in any backend.
 */

import { randomUUID } from 'node:crypto';

// In-process session store — used when no external store is provided.
const _sessions = new Map();

/**
 * Initiate a new WebSocket session.
 *
 * @param {{ method: string, body: { playerId?: string, gameId?: string } }} req
 * @param {Map|null} [store]
 * @returns {{ status: number, body: object }}
 */
export function initiateSession(req, store = null) {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { playerId, gameId } = req.body ?? {};

  if (!playerId) {
    return { status: 400, body: { error: 'playerId is required' } };
  }
  if (!gameId) {
    return { status: 400, body: { error: 'gameId is required' } };
  }

  const sessionId = randomUUID();
  const session = {
    sessionId,
    playerId,
    gameId,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  const s = store ?? _sessions;
  s.set(sessionId, session);

  return {
    status: 201,
    body: {
      sessionId: session.sessionId,
      playerId: session.playerId,
      gameId: session.gameId,
      status: session.status,
      createdAt: session.createdAt,
    },
  };
}

/**
 * Terminate an existing WebSocket session.
 *
 * @param {{ method: string, params: { sessionId?: string } }} req
 * @param {Map|null} [store]
 * @returns {{ status: number, body: object }}
 */
export function terminateSession(req, store = null) {
  if (req.method !== 'DELETE') {
    return { status: 405, body: { error: 'Method Not Allowed' } };
  }

  const { sessionId } = req.params ?? {};
  if (!sessionId) {
    return { status: 400, body: { error: 'sessionId is required' } };
  }

  const s = store ?? _sessions;
  if (!s.has(sessionId)) {
    return { status: 404, body: { error: 'session not found' } };
  }

  const session = s.get(sessionId);
  session.status = 'terminated';
  session.terminatedAt = new Date().toISOString();

  return {
    status: 200,
    body: {
      sessionId: session.sessionId,
      status: session.status,
      terminatedAt: session.terminatedAt,
    },
  };
}

/** Return a copy of the in-process session store (for testing). */
export function _getStore() {
  return new Map(_sessions);
}

/** Clear the in-process store (for test isolation). */
export function _clearStore() {
  _sessions.clear();
}
