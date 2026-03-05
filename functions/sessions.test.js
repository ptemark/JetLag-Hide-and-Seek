import { describe, it, expect, beforeEach } from 'vitest';
import {
  initiateSession,
  terminateSession,
  _getStore,
  _clearStore,
} from './sessions.js';

describe('initiateSession', () => {
  beforeEach(() => _clearStore());

  it('returns 201 and session record for valid request', () => {
    const req = {
      method: 'POST',
      body: { playerId: 'player-1', gameId: 'game-1' },
    };
    const { status, body } = initiateSession(req);

    expect(status).toBe(201);
    expect(body.sessionId).toBeTruthy();
    expect(body.playerId).toBe('player-1');
    expect(body.gameId).toBe('game-1');
    expect(body.status).toBe('active');
    expect(body.createdAt).toBeTruthy();
  });

  it('stores the session in the in-process store', () => {
    const req = {
      method: 'POST',
      body: { playerId: 'p1', gameId: 'g1' },
    };
    const { body } = initiateSession(req);
    const store = _getStore();
    expect(store.has(body.sessionId)).toBe(true);
    expect(store.get(body.sessionId).status).toBe('active');
  });

  it('generates unique sessionIds for separate calls', () => {
    const req = { method: 'POST', body: { playerId: 'p1', gameId: 'g1' } };
    const { body: b1 } = initiateSession(req);
    const { body: b2 } = initiateSession(req);
    expect(b1.sessionId).not.toBe(b2.sessionId);
  });

  it('returns 400 when playerId is missing', () => {
    const req = { method: 'POST', body: { gameId: 'g1' } };
    const { status, body } = initiateSession(req);
    expect(status).toBe(400);
    expect(body.error).toMatch(/playerId/);
  });

  it('returns 400 when gameId is missing', () => {
    const req = { method: 'POST', body: { playerId: 'p1' } };
    const { status, body } = initiateSession(req);
    expect(status).toBe(400);
    expect(body.error).toMatch(/gameId/);
  });

  it('returns 400 when body is null', () => {
    const req = { method: 'POST', body: null };
    const { status } = initiateSession(req);
    expect(status).toBe(400);
  });

  it('returns 405 for non-POST methods', () => {
    const req = { method: 'GET', body: { playerId: 'p1', gameId: 'g1' } };
    const { status, body } = initiateSession(req);
    expect(status).toBe(405);
    expect(body.error).toMatch(/Method Not Allowed/);
  });

  it('uses a provided store instead of the in-process one', () => {
    const store = new Map();
    const req = { method: 'POST', body: { playerId: 'p1', gameId: 'g1' } };
    const { body } = initiateSession(req, store);
    expect(store.has(body.sessionId)).toBe(true);
    expect(_getStore().size).toBe(0); // global store untouched
  });
});

describe('terminateSession', () => {
  beforeEach(() => _clearStore());

  it('returns 200 and marks the session terminated', () => {
    const { body: session } = initiateSession({
      method: 'POST',
      body: { playerId: 'p1', gameId: 'g1' },
    });

    const { status, body } = terminateSession({
      method: 'DELETE',
      params: { sessionId: session.sessionId },
    });

    expect(status).toBe(200);
    expect(body.sessionId).toBe(session.sessionId);
    expect(body.status).toBe('terminated');
    expect(body.terminatedAt).toBeTruthy();
  });

  it('persists terminated status in the store', () => {
    const { body: session } = initiateSession({
      method: 'POST',
      body: { playerId: 'p1', gameId: 'g1' },
    });

    terminateSession({
      method: 'DELETE',
      params: { sessionId: session.sessionId },
    });

    const store = _getStore();
    expect(store.get(session.sessionId).status).toBe('terminated');
  });

  it('returns 404 for unknown sessionId', () => {
    const { status, body } = terminateSession({
      method: 'DELETE',
      params: { sessionId: 'nonexistent-id' },
    });
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 when sessionId param is missing', () => {
    const { status, body } = terminateSession({
      method: 'DELETE',
      params: {},
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/sessionId/);
  });

  it('returns 405 for non-DELETE methods', () => {
    const { status, body } = terminateSession({
      method: 'POST',
      params: { sessionId: 'any' },
    });
    expect(status).toBe(405);
    expect(body.error).toMatch(/Method Not Allowed/);
  });

  it('uses a provided store instead of the in-process one', () => {
    const store = new Map();
    const { body: session } = initiateSession(
      { method: 'POST', body: { playerId: 'p1', gameId: 'g1' } },
      store,
    );

    const { status } = terminateSession(
      { method: 'DELETE', params: { sessionId: session.sessionId } },
      store,
    );

    expect(status).toBe(200);
    expect(store.get(session.sessionId).status).toBe('terminated');
  });
});
