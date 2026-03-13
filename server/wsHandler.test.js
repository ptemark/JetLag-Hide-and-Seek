// @vitest-environment node
/**
 * Task 27 — Dedicated unit tests for WsHandler.
 *
 * Tests each method and message handler in isolation using lightweight mock
 * WebSocket objects.  Integration / reliability scenarios (reconnection,
 * heartbeat integration, multi-game cleanup) live in connection.test.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsHandler } from './wsHandler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock WebSocket. readyState=1 means OPEN. */
function mockWs(readyState = 1) {
  const listeners = {};
  return {
    readyState,
    send: vi.fn(),
    on(event, handler) {
      listeners[event] = handler;
    },
    /** Simulate an incoming event (message, close, error). */
    emit(event, ...args) {
      listeners[event]?.(...args);
    },
  };
}

/** Parse all JSON payloads sent through a mock ws.send. */
function sentMessages(ws) {
  return ws.send.mock.calls.map(([payload]) => JSON.parse(payload));
}

/** Minimal GameLoop stub. */
function makeLoop() {
  return { addPlayer: vi.fn(), removePlayer: vi.fn() };
}

/** Minimal GameStateManager stub. */
function makeGsm() {
  return {
    addPlayerToGame: vi.fn(),
    removePlayerFromGame: vi.fn(),
    updatePlayerLocation: vi.fn(),
    getGameState: vi.fn().mockReturnValue({ status: 'waiting', seekerTeams: 0, players: {} }),
    getSeekerTeams: vi.fn().mockReturnValue(0),
    isEndGameActive: vi.fn().mockReturnValue(false),
    getPlayerRole: vi.fn().mockReturnValue(null),
    setPlayerTransit: vi.fn().mockReturnValue(true),
    getGameStatus: vi.fn().mockReturnValue(null),
    getGameZones: vi.fn().mockReturnValue([]),
  };
}

// ---------------------------------------------------------------------------
// handleConnection
// ---------------------------------------------------------------------------

describe('WsHandler — handleConnection', () => {
  let handler, loop, ws;

  beforeEach(() => {
    loop = makeLoop();
    handler = new WsHandler(loop);
    ws = mockWs();
  });

  it('registers the client in the clients map', () => {
    handler.handleConnection(ws, 'p1');
    expect(handler.clients.get('p1')).toBe(ws);
  });

  it('calls gameLoop.addPlayer with the playerId', () => {
    handler.handleConnection(ws, 'p1');
    expect(loop.addPlayer).toHaveBeenCalledWith('p1');
  });

  it('sends a connected message to the new client', () => {
    handler.handleConnection(ws, 'p1');
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'connected', playerId: 'p1' });
  });

  it('increments getConnectedCount', () => {
    expect(handler.getConnectedCount()).toBe(0);
    handler.handleConnection(ws, 'p1');
    expect(handler.getConnectedCount()).toBe(1);
  });

  it('does not send to a closed client on connection (readyState != OPEN)', () => {
    const closedWs = mockWs(3); // CLOSED
    handler.handleConnection(closedWs, 'p1');
    expect(closedWs.send).not.toHaveBeenCalled();
  });

  it('registers message, close, and error handlers via ws.on', () => {
    const registeredEvents = [];
    ws.on = (event) => registeredEvents.push(event);
    handler.handleConnection(ws, 'p1');
    expect(registeredEvents).toContain('message');
    expect(registeredEvents).toContain('close');
    expect(registeredEvents).toContain('error');
  });
});

// ---------------------------------------------------------------------------
// broadcast
// ---------------------------------------------------------------------------

describe('WsHandler — broadcast', () => {
  let handler, loop;

  beforeEach(() => {
    loop = makeLoop();
    handler = new WsHandler(loop);
  });

  it('sends to all connected open clients', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.send.mockClear();
    ws2.send.mockClear();

    handler.broadcast({ type: 'ping' });
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws1.send.mock.calls[0][0])).toEqual({ type: 'ping' });
  });

  it('skips clients with readyState !== OPEN', () => {
    const openWs = mockWs(1);
    const closedWs = mockWs(3);
    handler.clients.set('p1', openWs);
    handler.clients.set('p2', closedWs);

    handler.broadcast({ type: 'ping' });
    expect(openWs.send).toHaveBeenCalledTimes(1);
    expect(closedWs.send).not.toHaveBeenCalled();
  });

  it('is a no-op when there are no clients', () => {
    expect(() => handler.broadcast({ type: 'ping' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// broadcastToGame
// ---------------------------------------------------------------------------

describe('WsHandler — broadcastToGame', () => {
  let handler, loop;

  beforeEach(() => {
    loop = makeLoop();
    handler = new WsHandler(loop);
  });

  it('sends only to players in the target game', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    const ws3 = mockWs(); // different game
    handler.gameClients.set('g1', new Map([['p1', ws1], ['p2', ws2]]));
    handler.gameClients.set('g2', new Map([['p3', ws3]]));

    handler.broadcastToGame('g1', { type: 'update' });
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(ws3.send).not.toHaveBeenCalled();
  });

  it('is a no-op when the game has no clients', () => {
    expect(() => handler.broadcastToGame('unknown', { type: 'update' })).not.toThrow();
  });

  it('skips closed clients within the game', () => {
    const openWs = mockWs(1);
    const closedWs = mockWs(3);
    handler.gameClients.set('g1', new Map([['p1', openWs], ['p2', closedWs]]));

    handler.broadcastToGame('g1', { type: 'update' });
    expect(openWs.send).toHaveBeenCalledTimes(1);
    expect(closedWs.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getGamePlayerCount
// ---------------------------------------------------------------------------

describe('WsHandler — getGamePlayerCount', () => {
  let handler, loop;

  beforeEach(() => {
    loop = makeLoop();
    handler = new WsHandler(loop);
  });

  it('returns 0 for an unknown game', () => {
    expect(handler.getGamePlayerCount('unknown')).toBe(0);
  });

  it('returns the correct count after players join', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    expect(handler.getGamePlayerCount('g1')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// message routing — join_game
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — join_game', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    loop = makeLoop();
    gsm = makeGsm();
    handler = new WsHandler(loop, gsm);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
  });

  it('sends joined_game confirmation to the joining player', () => {
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'joined_game', gameId: 'g1', playerId: 'p1', role: 'seeker', team: null });
  });

  it('defaults role to hider when not specified', () => {
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    const msgs = sentMessages(ws);
    const joinMsg = msgs.find(m => m.type === 'joined_game');
    expect(joinMsg.role).toBe('hider');
  });

  it('adds the player to gameClients', () => {
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    expect(handler.getGamePlayerCount('g1')).toBe(1);
  });

  it('adds the game to playerGames', () => {
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    expect(handler.playerGames.get('p1').has('g1')).toBe(true);
  });

  it('calls gsm.addPlayerToGame when GSM is present', () => {
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    expect(gsm.addPlayerToGame).toHaveBeenCalledWith('g1', 'p1', 'seeker', null);
  });

  it('notifies existing players with player_joined', () => {
    // p2 joins first
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();

    // p1 now joins
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    const msgs = sentMessages(ws2);
    expect(msgs).toContainEqual({ type: 'player_joined', gameId: 'g1', playerId: 'p1', team: null });
  });

  it('returns error when gameId is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'join_game' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'error', message: 'gameId required' });
  });

  it('works without a GSM (no crash)', () => {
    const noGsmHandler = new WsHandler(loop);
    const noGsmWs = mockWs();
    noGsmHandler.handleConnection(noGsmWs, 'p1');
    expect(() =>
      noGsmWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }))
    ).not.toThrow();
  });

  it('sends HIDER_SLOT_TAKEN error and does not send joined_game when GSM throws', () => {
    gsm.addPlayerToGame.mockImplementation(() => { throw new Error('HIDER_SLOT_TAKEN'); });
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({
      type: 'error',
      code: 'HIDER_SLOT_TAKEN',
      message: 'A hider has already joined this game',
    });
    expect(msgs.find(m => m.type === 'joined_game')).toBeUndefined();
  });

  it('removes the player from gameClients after HIDER_SLOT_TAKEN so the slot is not leaked', () => {
    gsm.addPlayerToGame.mockImplementation(() => { throw new Error('HIDER_SLOT_TAKEN'); });
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    expect(handler.getGamePlayerCount('g1')).toBe(0);
  });

  it('re-throws unexpected errors from GSM (non-HIDER_SLOT_TAKEN)', () => {
    gsm.addPlayerToGame.mockImplementation(() => { throw new Error('UNEXPECTED'); });
    expect(() =>
      ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }))
    ).toThrow('UNEXPECTED');
  });
});

// ---------------------------------------------------------------------------
// message routing — leave_game
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — leave_game', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    loop = makeLoop();
    gsm = makeGsm();
    handler = new WsHandler(loop, gsm);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.send.mockClear();
  });

  it('sends left_game confirmation', () => {
    ws.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'left_game', gameId: 'g1', playerId: 'p1' });
  });

  it('removes player from gameClients', () => {
    ws.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(handler.getGamePlayerCount('g1')).toBe(0);
  });

  it('removes game entry when no players remain', () => {
    ws.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(handler.gameClients.has('g1')).toBe(false);
  });

  it('calls gsm.removePlayerFromGame', () => {
    ws.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(gsm.removePlayerFromGame).toHaveBeenCalledWith('g1', 'p1');
  });

  it('returns error when gameId is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'leave_game' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'error', message: 'gameId required' });
  });
});

// ---------------------------------------------------------------------------
// message routing — location_update
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — location_update', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    loop = makeLoop();
    gsm = makeGsm();
    handler = new WsHandler(loop, gsm);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.send.mockClear();
  });

  it('calls gsm.updatePlayerLocation with correct coords', () => {
    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.1 }));
    expect(gsm.updatePlayerLocation).toHaveBeenCalledWith('g1', 'p1', 51.5, -0.1);
  });

  it('broadcasts player_location to all players in the game (role unknown = seeker path)', () => {
    // Default GSM mock returns null for getPlayerRole → treated as seeker and broadcast to all.
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.1 }));
    const msgs = sentMessages(ws2);
    expect(msgs).toContainEqual({ type: 'player_location', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.1 });
  });

  it('is silent when gameId is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'location_update', lat: 51.5, lon: -0.1 }));
    expect(gsm.updatePlayerLocation).not.toHaveBeenCalled();
  });

  it('is silent when lat is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lon: -0.1 }));
    expect(gsm.updatePlayerLocation).not.toHaveBeenCalled();
  });

  it('is silent when lon is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5 }));
    expect(gsm.updatePlayerLocation).not.toHaveBeenCalled();
  });

  it('works without a GSM (no crash)', () => {
    const noGsmHandler = new WsHandler(loop);
    const noGsmWs = mockWs();
    noGsmHandler.handleConnection(noGsmWs, 'p1');
    noGsmWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    expect(() =>
      noGsmWs.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 0, lon: 0 }))
    ).not.toThrow();
  });

  it('silently ignores location_update from hider when End Game is active', () => {
    gsm.isEndGameActive.mockReturnValue(true);
    gsm.getPlayerRole.mockReturnValue('hider');

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 10, lon: 20 }));

    // GSM should NOT be updated and no broadcast should occur.
    expect(gsm.updatePlayerLocation).not.toHaveBeenCalled();
  });

  it('still broadcasts location_update from seeker when End Game is active', () => {
    gsm.isEndGameActive.mockReturnValue(true);
    gsm.getPlayerRole.mockReturnValue('seeker');

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 10, lon: 20 }));

    // Seeker location updates proceed normally during End Game.
    expect(gsm.updatePlayerLocation).toHaveBeenCalledWith('g1', 'p1', 10, 20);
  });

  // ── Hider location privacy (Task 72) ──────────────────────────────────────

  it('hider location_update stores in GSM but does NOT broadcast to other players', () => {
    gsm.getPlayerRole.mockReturnValue('hider');

    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();
    ws.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.1 }));

    // GSM must be updated (for capture detection).
    expect(gsm.updatePlayerLocation).toHaveBeenCalledWith('g1', 'p1', 51.5, -0.1);

    // The OTHER player (seeker / observer) must NOT receive the hider's position.
    const msgsForOther = sentMessages(ws2);
    const locMsgs = msgsForOther.filter((m) => m.type === 'player_location' || m.type === 'location_update');
    expect(locMsgs).toHaveLength(0);
  });

  it('hider location_update is echoed only to the hider themselves', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    ws.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.1 }));

    // The hider's own socket receives the echo so their own marker stays accurate.
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'player_location', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.1 });
  });

  it('seeker location_update is broadcast to all players in the game', () => {
    gsm.getPlayerRole.mockReturnValue('seeker');

    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();
    ws.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.1 }));

    // p2 (and p1 who sent it) receive the seeker's location.
    const msgsForOther = sentMessages(ws2);
    expect(msgsForOther).toContainEqual({ type: 'player_location', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.1 });
  });
});

// ---------------------------------------------------------------------------
// message routing — request_state
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — request_state', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    loop = makeLoop();
    gsm = makeGsm();
    handler = new WsHandler(loop, gsm);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
  });

  it('sends game_state with state from GSM', () => {
    const fakeState = { status: 'hiding', players: { p1: { lat: 1, lon: 2 } } };
    gsm.getGameState.mockReturnValue(fakeState);

    ws.emit('message', JSON.stringify({ type: 'request_state', gameId: 'g1' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'game_state', gameId: 'g1', state: fakeState });
  });

  it('sends game_state with null state when no GSM is present', () => {
    const noGsmHandler = new WsHandler(loop);
    const noGsmWs = mockWs();
    noGsmHandler.handleConnection(noGsmWs, 'p1');
    noGsmWs.send.mockClear();

    noGsmWs.emit('message', JSON.stringify({ type: 'request_state', gameId: 'g1' }));
    const msgs = sentMessages(noGsmWs);
    expect(msgs).toContainEqual({ type: 'game_state', gameId: 'g1', state: null });
  });

  it('returns error when gameId is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'request_state' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'error', message: 'gameId required' });
  });
});

// ---------------------------------------------------------------------------
// message routing — unknown type
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — unknown message type', () => {
  it('sends an ack with the received type', () => {
    const loop = makeLoop();
    const handler = new WsHandler(loop);
    const ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'custom_event' }));
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'ack', received: 'custom_event', playerId: 'p1' });
  });
});

// ---------------------------------------------------------------------------
// message routing — invalid JSON
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — invalid JSON', () => {
  it('sends an error message on parse failure', () => {
    const loop = makeLoop();
    const handler = new WsHandler(loop);
    const ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();

    ws.emit('message', 'NOT JSON {{');
    const msgs = sentMessages(ws);
    expect(msgs).toContainEqual({ type: 'error', message: 'Invalid JSON' });
  });

  it('does not throw on invalid JSON', () => {
    const loop = makeLoop();
    const handler = new WsHandler(loop);
    const ws = mockWs();
    handler.handleConnection(ws, 'p1');
    expect(() => ws.emit('message', '{')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// disconnect — immediate effects (no timer needed)
// ---------------------------------------------------------------------------

describe('WsHandler — disconnect (immediate)', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = makeLoop();
    gsm = makeGsm();
    // Use a long grace period so deferred cleanup does not run in these tests.
    handler = new WsHandler(loop, gsm, 60_000);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g2' }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes the player from the clients map immediately on close', () => {
    ws.emit('close');
    expect(handler.clients.has('p1')).toBe(false);
  });

  it('calls gameLoop.removePlayer immediately on close', () => {
    ws.emit('close');
    expect(loop.removePlayer).toHaveBeenCalledWith('p1');
  });

  it('broadcasts player_disconnected to game peers immediately (not player_left)', () => {
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();

    ws.emit('close');

    const msgs = sentMessages(ws2);
    expect(msgs.some(m => m.type === 'player_disconnected' && m.playerId === 'p1')).toBe(true);
    // player_left is NOT sent immediately — it is deferred until grace period expires.
    expect(msgs.some(m => m.type === 'player_left' && m.playerId === 'p1')).toBe(false);
  });

  it('does NOT call gsm.removePlayerFromGame immediately (deferred)', () => {
    ws.emit('close');
    expect(gsm.removePlayerFromGame).not.toHaveBeenCalled();
  });

  it('does NOT remove player from gameClients immediately (grace period)', () => {
    ws.emit('close');
    // Player is still in the game during grace period (slot held for reconnect).
    expect(handler.getGamePlayerCount('g1')).toBe(1);
  });

  it('also disconnects on ws error event', () => {
    ws.emit('error');
    expect(handler.clients.has('p1')).toBe(false);
    expect(loop.removePlayer).toHaveBeenCalledWith('p1');
  });

  it('handles disconnect for a player with no game memberships', () => {
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2'); // joined no games
    expect(() => ws2.emit('close')).not.toThrow();
    expect(handler.clients.has('p2')).toBe(false);
  });

  it('decrements getConnectedCount immediately after disconnect', () => {
    expect(handler.getConnectedCount()).toBe(1);
    ws.emit('close');
    expect(handler.getConnectedCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// disconnect — deferred cleanup after grace period
// ---------------------------------------------------------------------------

describe('WsHandler — disconnect (grace period expiry)', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = makeLoop();
    gsm = makeGsm();
    handler = new WsHandler(loop, gsm, 5_000);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g2' }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes player from all joined games after grace period', () => {
    ws.emit('close');
    vi.advanceTimersByTime(5_000);
    expect(handler.getGamePlayerCount('g1')).toBe(0);
    expect(handler.getGamePlayerCount('g2')).toBe(0);
  });

  it('clears playerGames tracking after grace period', () => {
    ws.emit('close');
    vi.advanceTimersByTime(5_000);
    expect(handler.playerGames.has('p1')).toBe(false);
  });

  it('calls gsm.removePlayerFromGame for each game after grace period', () => {
    ws.emit('close');
    vi.advanceTimersByTime(5_000);
    expect(gsm.removePlayerFromGame).toHaveBeenCalledWith('g1', 'p1');
    expect(gsm.removePlayerFromGame).toHaveBeenCalledWith('g2', 'p1');
  });

  it('broadcasts player_left after grace period expires', () => {
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();

    ws.emit('close');
    vi.advanceTimersByTime(5_000);

    const msgs = sentMessages(ws2);
    expect(msgs.some(m => m.type === 'player_left' && m.playerId === 'p1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reconnect — player rejoins within grace period
// ---------------------------------------------------------------------------

describe('WsHandler — reconnect within grace period', () => {
  let handler, loop, gsm, ws1, ws2;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = makeLoop();
    gsm = makeGsm();
    handler = new WsHandler(loop, gsm, 5_000);
    ws1 = mockWs();
    handler.handleConnection(ws1, 'p1');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    // Simulate disconnect
    ws1.emit('close');
    // Player reconnects with a new WebSocket
    ws2 = mockWs();
    handler.handleConnection(ws2, 'p1');
    ws2.send.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the grace timer when player rejoins the game', () => {
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    vi.advanceTimersByTime(5_000);
    // gsm.removePlayerFromGame should NOT have been called (timer was cancelled)
    expect(gsm.removePlayerFromGame).not.toHaveBeenCalled();
  });

  it('sends joined_game to the reconnecting player', () => {
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    const msgs = sentMessages(ws2);
    expect(msgs.some(m => m.type === 'joined_game' && m.gameId === 'g1')).toBe(true);
  });

  it('sends current game_state to the reconnecting player', () => {
    const fakeState = { status: 'hiding', players: { p1: { lat: 1, lon: 2 } } };
    gsm.getGameState.mockReturnValue(fakeState);

    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    const msgs = sentMessages(ws2);
    expect(msgs.some(m => m.type === 'game_state' && m.gameId === 'g1')).toBe(true);
  });

  it('broadcasts player_reconnected (not player_joined) to other players', () => {
    const ws3 = mockWs();
    handler.handleConnection(ws3, 'p2');
    ws3.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws3.send.mockClear();

    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));

    const msgs = sentMessages(ws3);
    expect(msgs.some(m => m.type === 'player_reconnected' && m.playerId === 'p1')).toBe(true);
    expect(msgs.some(m => m.type === 'player_joined' && m.playerId === 'p1')).toBe(false);
  });

  it('does not finalize disconnect after reconnect even if old timer duration elapses', () => {
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    vi.advanceTimersByTime(10_000); // well past grace period
    expect(handler.getGamePlayerCount('g1')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// message routing — set_transit
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — set_transit', () => {
  let handler, loop, gsm, ws;

  beforeEach(() => {
    loop = makeLoop();
    gsm = makeGsm();
    // Add setPlayerTransit to the gsm stub
    gsm.setPlayerTransit = vi.fn();
    handler = new WsHandler(loop, gsm);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws.send.mockClear();
  });

  it('calls gsm.setPlayerTransit with onTransit=true', () => {
    ws.emit('message', JSON.stringify({ type: 'set_transit', gameId: 'g1', onTransit: true }));
    expect(gsm.setPlayerTransit).toHaveBeenCalledWith('g1', 'p1', true);
  });

  it('calls gsm.setPlayerTransit with onTransit=false', () => {
    ws.emit('message', JSON.stringify({ type: 'set_transit', gameId: 'g1', onTransit: false }));
    expect(gsm.setPlayerTransit).toHaveBeenCalledWith('g1', 'p1', false);
  });

  it('broadcasts player_transit to all players in the game', () => {
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws2.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'set_transit', gameId: 'g1', onTransit: true }));

    const msgs = sentMessages(ws2);
    expect(msgs).toContainEqual({ type: 'player_transit', gameId: 'g1', playerId: 'p1', onTransit: true });
  });

  it('is silent when gameId is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'set_transit', onTransit: true }));
    expect(gsm.setPlayerTransit).not.toHaveBeenCalled();
  });

  it('works without a GSM (no crash)', () => {
    const noGsmHandler = new WsHandler(loop);
    const noGsmWs = mockWs();
    noGsmHandler.handleConnection(noGsmWs, 'p1');
    noGsmWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    expect(() =>
      noGsmWs.emit('message', JSON.stringify({ type: 'set_transit', gameId: 'g1', onTransit: true }))
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// message routing — spot_hider
// ---------------------------------------------------------------------------

describe('WsHandler — message routing — spot_hider', () => {
  let handler, loop, gsm, ws;

  /** Shared seeker setup: p1 is a seeker in game g1. */
  beforeEach(() => {
    loop = makeLoop();
    gsm  = makeGsm();
    // Default GSM state: return a game state that tests can override.
    gsm.getGameState.mockReturnValue({
      gameId: 'g1', status: 'seeking',
      players: {
        h1: { lat: 51.5,      lon: 0, role: 'hider'  },
        p1: { lat: 51.50009,  lon: 0, role: 'seeker' }, // ~10 m from hider
      },
    });
    handler = new WsHandler(loop, gsm);
    ws = mockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws.send.mockClear();
  });

  it('sends error when gameId is missing', () => {
    ws.emit('message', JSON.stringify({ type: 'spot_hider' }));
    expect(sentMessages(ws)).toContainEqual({ type: 'error', message: 'gameId required' });
  });

  it('broadcasts spot_confirmed when spotter is within default spot radius', () => {
    // Inject a stub that always returns spotted=true.
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: true, distance: 10, hiderLat: 51.5, hiderLon: 0 });

    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws2.send.mockClear();
    ws.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    // Both the spotter and their partner should receive spot_confirmed.
    const msgs1 = sentMessages(ws);
    const msgs2 = sentMessages(ws2);
    expect(msgs1).toContainEqual(expect.objectContaining({ type: 'spot_confirmed', gameId: 'g1', spotterId: 'p1' }));
    expect(msgs2).toContainEqual(expect.objectContaining({ type: 'spot_confirmed', gameId: 'g1', spotterId: 'p1' }));
  });

  it('calls onSpotConfirmed callback with gameId and spotterId when confirmed', () => {
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: true, distance: 5, hiderLat: 51.5, hiderLon: 0 });
    const onSpotConfirmed = vi.fn();
    handler.onSpotConfirmed = onSpotConfirmed;

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    expect(onSpotConfirmed).toHaveBeenCalledWith('g1', 'p1');
  });

  it('sends spot_rejected back to the spotter when outside radius', () => {
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: false, distance: 80, hiderLat: 51.5, hiderLon: 0 });

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    const msgs = sentMessages(ws);
    const rejected = msgs.find(m => m.type === 'spot_rejected');
    expect(rejected).toBeTruthy();
    expect(rejected.gameId).toBe('g1');
    expect(rejected.spotterId).toBe('p1');
    expect(rejected.distanceM).toBe(80);
    expect(rejected.spotRadiusM).toBe(30); // default
  });

  it('does NOT call onSpotConfirmed when spot is rejected', () => {
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: false, distance: 200, hiderLat: 51.5, hiderLon: 0 });
    const onSpotConfirmed = vi.fn();
    handler.onSpotConfirmed = onSpotConfirmed;

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    expect(onSpotConfirmed).not.toHaveBeenCalled();
  });

  it('does not broadcast spot_rejected to other players (private response)', () => {
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: false, distance: 200, hiderLat: 51.5, hiderLon: 0 });

    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws2.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    // p2 should NOT receive spot_rejected
    expect(sentMessages(ws2).some(m => m.type === 'spot_rejected')).toBe(false);
  });

  it('respects a custom spotRadiusM set on the handler', () => {
    // Set a very tight radius — even a 10 m spotter should be rejected with 5 m limit.
    handler.spotRadiusM = 5;
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: false, distance: 10, hiderLat: 51.5, hiderLon: 0 });

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    const msgs = sentMessages(ws);
    const rejected = msgs.find(m => m.type === 'spot_rejected');
    expect(rejected).toBeTruthy();
    expect(rejected.spotRadiusM).toBe(5);
  });

  it('passes gameState from GSM to checkSpot', () => {
    const fakeState = { gameId: 'g1', status: 'seeking', players: { h1: { lat: 1, lon: 2, role: 'hider' }, p1: { lat: 1, lon: 2, role: 'seeker' } } };
    gsm.getGameState.mockReturnValue(fakeState);
    handler._checkSpotFn = vi.fn().mockReturnValue({ spotted: false, distance: null, hiderLat: null, hiderLon: null });

    ws.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }));

    expect(handler._checkSpotFn).toHaveBeenCalledWith(fakeState, 'p1', handler.spotRadiusM);
  });

  it('handles spot_hider gracefully when GSM is absent', () => {
    const noGsmHandler = new WsHandler(loop);
    noGsmHandler._checkSpotFn = vi.fn().mockReturnValue({ spotted: false, distance: null, hiderLat: null, hiderLon: null });
    const noGsmWs = mockWs();
    noGsmHandler.handleConnection(noGsmWs, 'p1');
    noGsmWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    expect(() =>
      noGsmWs.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'g1' }))
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// location_update — hider out-of-zone warning (Task 77)
// ---------------------------------------------------------------------------

describe('WsHandler — hider out-of-zone warning', () => {
  let handler, loop, gsm, hiderWs, seekerWs;

  // A zone centred at (51.5, 0) with 500 m radius.
  const zone = { stationId: 's1', lat: 51.5, lon: 0, radiusM: 500 };

  beforeEach(() => {
    loop = makeLoop();
    gsm  = makeGsm();
    gsm.isEndGameActive.mockReturnValue(false);
    handler = new WsHandler(loop, gsm);

    hiderWs = mockWs();
    handler.handleConnection(hiderWs, 'h1');
    hiderWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    hiderWs.send.mockClear();

    seekerWs = mockWs();
    handler.handleConnection(seekerWs, 's1');
    seekerWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    seekerWs.send.mockClear();
  });

  it('sends no zone_warning when hider is inside zone during seeking', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    gsm.getGameStatus.mockReturnValue('seeking');
    gsm.getGameZones.mockReturnValue([zone]);

    // lat 51.5, lon 0 — centre of zone, distance = 0
    hiderWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 'h1', lat: 51.5, lon: 0,
    }));

    const msgs = sentMessages(hiderWs);
    expect(msgs.some(m => m.type === 'zone_warning')).toBe(false);
  });

  it('sends no hider_out_of_zone broadcast when hider is inside zone', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    gsm.getGameStatus.mockReturnValue('seeking');
    gsm.getGameZones.mockReturnValue([zone]);

    hiderWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 'h1', lat: 51.5, lon: 0,
    }));

    expect(sentMessages(seekerWs).some(m => m.type === 'hider_out_of_zone')).toBe(false);
  });

  it('sends zone_warning to hider when outside zone during seeking', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    gsm.getGameStatus.mockReturnValue('seeking');
    gsm.getGameZones.mockReturnValue([zone]);

    // lat 51.51 is ~1.1 km from 51.5 — outside 500 m radius
    hiderWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 'h1', lat: 51.51, lon: 0,
    }));

    const msgs = sentMessages(hiderWs);
    const warning = msgs.find(m => m.type === 'zone_warning');
    expect(warning).toBeTruthy();
    expect(warning.code).toBe('HIDER_OUT_OF_ZONE');
  });

  it('broadcasts hider_out_of_zone to all players when hider leaves zone', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    gsm.getGameStatus.mockReturnValue('seeking');
    gsm.getGameZones.mockReturnValue([zone]);

    hiderWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 'h1', lat: 51.51, lon: 0,
    }));

    expect(sentMessages(seekerWs).some(m => m.type === 'hider_out_of_zone' && m.gameId === 'g1')).toBe(true);
  });

  it('sends no warning during hiding phase (wrong phase)', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    gsm.getGameStatus.mockReturnValue('hiding');
    gsm.getGameZones.mockReturnValue([zone]);

    hiderWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 'h1', lat: 51.51, lon: 0,
    }));

    expect(sentMessages(hiderWs).some(m => m.type === 'zone_warning')).toBe(false);
  });

  it('sends no warning for a seeker location update (wrong role)', () => {
    gsm.getPlayerRole.mockReturnValue('seeker');
    gsm.getGameStatus.mockReturnValue('seeking');
    gsm.getGameZones.mockReturnValue([zone]);

    seekerWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 's1', lat: 51.51, lon: 0,
    }));

    expect(sentMessages(seekerWs).some(m => m.type === 'zone_warning')).toBe(false);
  });

  it('sends no warning during seeking when no zones are set', () => {
    gsm.getPlayerRole.mockReturnValue('hider');
    gsm.getGameStatus.mockReturnValue('seeking');
    gsm.getGameZones.mockReturnValue([]); // no locked zone

    hiderWs.emit('message', JSON.stringify({
      type: 'location_update', gameId: 'g1', playerId: 'h1', lat: 51.51, lon: 0,
    }));

    expect(sentMessages(hiderWs).some(m => m.type === 'zone_warning')).toBe(false);
  });
});
