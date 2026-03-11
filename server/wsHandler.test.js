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

  it('broadcasts location_update to all players in the game', () => {
    const ws2 = mockWs();
    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.send.mockClear();

    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.1 }));
    const msgs = sentMessages(ws2);
    expect(msgs).toContainEqual({ type: 'location_update', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.1 });
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
