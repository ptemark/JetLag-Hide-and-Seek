// @vitest-environment node
/**
 * Task 15 — Connection reliability and message delivery tests.
 *
 * Focus areas:
 *  1. Reconnection — same playerId re-connects after disconnect
 *  2. Closed-client safety — messages are never sent to closed sockets
 *  3. Multi-game membership — disconnect cleans up every joined game
 *  4. Message delivery ordering — sequential messages arrive in order
 *  5. Broadcast isolation — game broadcasts stay within the target game
 *  6. No-gameStateManager path — handler degrades gracefully without GSM
 *  7. Concurrent multi-player activity — several players emitting events
 *  8. Heartbeat ↔ WsHandler integration — terminated client loses WS slot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsHandler } from './wsHandler.js';
import { GameLoop } from './gameLoop.js';
import { GameStateManager } from './gameState.js';
import { HeartbeatManager } from './heartbeat.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWs(readyState = 1) {
  const listeners = {};
  const ws = {
    readyState,
    isAlive: undefined,
    ping: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn(),
    on(event, handler) {
      listeners[event] = handler;
    },
    emit(event, ...args) {
      listeners[event]?.(...args);
    },
  };
  return ws;
}

function createMockWss(clients = []) {
  return { clients: new Set(clients) };
}

function msg(type, extra = {}) {
  return JSON.stringify({ type, ...extra });
}

function sent(ws) {
  return ws.send.mock.calls.map((c) => JSON.parse(c[0]));
}

// ---------------------------------------------------------------------------
// 1. Reconnection — same playerId re-connects
// ---------------------------------------------------------------------------

describe('Connection reliability — reconnection', () => {
  let loop, handler;

  beforeEach(() => {
    loop = new GameLoop(5000);
    handler = new WsHandler(loop, new GameStateManager());
  });

  afterEach(() => loop.stop());

  it('replaces the old socket entry when same playerId reconnects', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    handler.handleConnection(ws1, 'p1');
    ws1.emit('close');

    handler.handleConnection(ws2, 'p1');

    // Only the new socket is tracked
    expect(handler.getConnectedCount()).toBe(1);
    expect(ws2.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'connected', playerId: 'p1' })
    );
  });

  it('reconnected player can join a game successfully', () => {
    const ws1 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    ws1.emit('close');

    const ws2 = createMockWs();
    handler.handleConnection(ws2, 'p1');
    ws2.send.mockClear();

    ws2.emit('message', msg('join_game', { gameId: 'g1', role: 'seeker' }));
    const types = sent(ws2).map((m) => m.type);
    expect(types).toContain('joined_game');
  });

  it('after reconnect the old socket receives no further messages', () => {
    const ws1 = createMockWs();
    handler.handleConnection(ws1, 'p1');

    const ws2 = createMockWs();
    // ws1 disconnects, ws2 connects with same id
    ws1.emit('close');
    handler.handleConnection(ws2, 'p1');

    ws1.send.mockClear();
    handler.broadcast({ type: 'update', round: 1 });

    expect(ws1.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Closed-client safety
// ---------------------------------------------------------------------------

describe('Message delivery — closed-client safety', () => {
  let loop, handler;

  beforeEach(() => {
    loop = new GameLoop(5000);
    handler = new WsHandler(loop, new GameStateManager());
  });

  afterEach(() => loop.stop());

  it('broadcast skips a client whose readyState is CLOSING (2)', () => {
    const open = createMockWs(1);
    const closing = createMockWs(2);  // CLOSING

    handler.handleConnection(open, 'p1');
    handler.handleConnection(closing, 'p2');
    open.send.mockClear();
    closing.send.mockClear();

    handler.broadcast({ type: 'tick' });

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closing.send).not.toHaveBeenCalled();
  });

  it('broadcastToGame skips a closed client still registered in a game', () => {
    const open = createMockWs(1);
    const closed = createMockWs(3); // CLOSED

    handler.handleConnection(open, 'p1');
    handler.handleConnection(closed, 'p2');

    open.emit('message', msg('join_game', { gameId: 'g1' }));
    closed.emit('message', msg('join_game', { gameId: 'g1' }));

    open.send.mockClear();
    closed.send.mockClear();

    handler.broadcastToGame('g1', { type: 'state_sync' });

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closed.send).not.toHaveBeenCalled();
  });

  it('_send does not throw when ws readyState is not OPEN', () => {
    const ws = createMockWs(3); // CLOSED
    handler.handleConnection(ws, 'p1');
    // The 'connected' message should not have been delivered
    expect(ws.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-game membership cleanup on disconnect
// ---------------------------------------------------------------------------

describe('Connection reliability — multi-game cleanup', () => {
  let loop, handler;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = new GameLoop(5000);
    // Use a short grace period so tests can advance past it quickly.
    handler = new WsHandler(loop, new GameStateManager(), 5_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    loop.stop();
  });

  it('disconnect removes player from all three games after grace period', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');

    ['g1', 'g2', 'g3'].forEach((gameId) => {
      ws.emit('message', msg('join_game', { gameId }));
    });

    ws.emit('close');
    // Player is still counted during grace period.
    expect(handler.getConnectedCount()).toBe(0); // removed from clients immediately

    // Advance past grace period — player is fully removed from all games.
    vi.advanceTimersByTime(5_000);
    expect(handler.getGamePlayerCount('g1')).toBe(0);
    expect(handler.getGamePlayerCount('g2')).toBe(0);
    expect(handler.getGamePlayerCount('g3')).toBe(0);
  });

  it('other players receive player_disconnected immediately and player_left after grace period', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');

    ws1.emit('message', msg('join_game', { gameId: 'g1' }));
    ws2.emit('message', msg('join_game', { gameId: 'g1' }));

    ws2.send.mockClear();
    ws1.emit('close');

    // Immediate: player_disconnected (grace window open).
    let types = sent(ws2).map((m) => m.type);
    expect(types).toContain('player_disconnected');
    expect(types).not.toContain('player_left');

    // After grace period: player_left arrives.
    ws2.send.mockClear();
    vi.advanceTimersByTime(5_000);
    types = sent(ws2).map((m) => m.type);
    expect(types).toContain('player_left');
  });

  it('game entry is removed when last player grace period expires', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', msg('join_game', { gameId: 'solo' }));

    ws.emit('close');
    // Still in grace period — player slot held.
    expect(handler.getGamePlayerCount('solo')).toBe(1);

    vi.advanceTimersByTime(5_000);
    // Grace period expired — game entry cleaned up.
    expect(handler.getGamePlayerCount('solo')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Message delivery ordering
// ---------------------------------------------------------------------------

describe('Message delivery — ordering', () => {
  let loop, handler;

  beforeEach(() => {
    loop = new GameLoop(5000);
    handler = new WsHandler(loop, new GameStateManager());
  });

  afterEach(() => loop.stop());

  it('delivers broadcast messages to clients in the order they are sent', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();

    const messages = [
      { type: 'round', n: 1 },
      { type: 'round', n: 2 },
      { type: 'round', n: 3 },
    ];
    messages.forEach((m) => handler.broadcast(m));

    const received = sent(ws);
    expect(received[0].n).toBe(1);
    expect(received[1].n).toBe(2);
    expect(received[2].n).toBe(3);
  });

  it('delivers game-scoped messages in the order they are broadcast', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', msg('join_game', { gameId: 'g1' }));
    ws.send.mockClear();

    handler.broadcastToGame('g1', { type: 'event', seq: 10 });
    handler.broadcastToGame('g1', { type: 'event', seq: 11 });
    handler.broadcastToGame('g1', { type: 'event', seq: 12 });

    const received = sent(ws);
    expect(received.map((m) => m.seq)).toEqual([10, 11, 12]);
  });
});

// ---------------------------------------------------------------------------
// 5. Broadcast isolation between games
// ---------------------------------------------------------------------------

describe('Message delivery — broadcast isolation', () => {
  let loop, handler;

  beforeEach(() => {
    loop = new GameLoop(5000);
    handler = new WsHandler(loop, new GameStateManager());
  });

  afterEach(() => loop.stop());

  it('game broadcast does not reach players in a different game', () => {
    const wsA = createMockWs();
    const wsB = createMockWs();

    handler.handleConnection(wsA, 'pA');
    handler.handleConnection(wsB, 'pB');

    wsA.emit('message', msg('join_game', { gameId: 'game-A' }));
    wsB.emit('message', msg('join_game', { gameId: 'game-B' }));

    wsA.send.mockClear();
    wsB.send.mockClear();

    handler.broadcastToGame('game-A', { type: 'secret' });

    expect(wsA.send).toHaveBeenCalledTimes(1);
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it('global broadcast reaches players in all games', () => {
    const wsA = createMockWs();
    const wsB = createMockWs();

    handler.handleConnection(wsA, 'pA');
    handler.handleConnection(wsB, 'pB');

    wsA.emit('message', msg('join_game', { gameId: 'game-A' }));
    wsB.emit('message', msg('join_game', { gameId: 'game-B' }));

    wsA.send.mockClear();
    wsB.send.mockClear();

    handler.broadcast({ type: 'server_shutdown' });

    expect(wsA.send).toHaveBeenCalledTimes(1);
    expect(wsB.send).toHaveBeenCalledTimes(1);
  });

  it('player in two games receives a game broadcast only from the target game', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', msg('join_game', { gameId: 'g1' }));
    ws.emit('message', msg('join_game', { gameId: 'g2' }));
    ws.send.mockClear();

    handler.broadcastToGame('g1', { type: 'g1_event' });

    const messages = sent(ws);
    const g1 = messages.filter((m) => m.type === 'g1_event');
    expect(g1).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Graceful degradation without GameStateManager
// ---------------------------------------------------------------------------

describe('Connection reliability — no GameStateManager', () => {
  let loop, handler;

  beforeEach(() => {
    loop = new GameLoop(5000);
    handler = new WsHandler(loop); // no GSM
  });

  afterEach(() => loop.stop());

  it('join_game succeeds without crashing when GSM is absent', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();

    expect(() => {
      ws.emit('message', msg('join_game', { gameId: 'g1', role: 'hider' }));
    }).not.toThrow();

    const types = sent(ws).map((m) => m.type);
    expect(types).toContain('joined_game');
  });

  it('location_update succeeds without crashing when GSM is absent', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', msg('join_game', { gameId: 'g1' }));
    ws.send.mockClear();

    expect(() => {
      ws.emit('message', msg('location_update', { gameId: 'g1', lat: 10, lon: 20 }));
    }).not.toThrow();
  });

  it('request_state returns null state when GSM is absent', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', msg('join_game', { gameId: 'g1' }));
    ws.send.mockClear();

    ws.emit('message', msg('request_state', { gameId: 'g1' }));

    const call = JSON.parse(ws.send.mock.calls[0][0]);
    expect(call.type).toBe('game_state');
    expect(call.state).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Concurrent multi-player activity
// ---------------------------------------------------------------------------

describe('Connection reliability — concurrent players', () => {
  let loop, handler, gsm;

  beforeEach(() => {
    loop = new GameLoop(5000);
    gsm = new GameStateManager();
    handler = new WsHandler(loop, gsm);
  });

  afterEach(() => loop.stop());

  it('10 players connecting and joining the same game are all tracked', () => {
    const sockets = [];
    for (let i = 0; i < 10; i++) {
      const ws = createMockWs();
      handler.handleConnection(ws, `p${i}`);
      ws.emit('message', msg('join_game', { gameId: 'mass-game', role: 'seeker' }));
      sockets.push(ws);
    }

    expect(handler.getConnectedCount()).toBe(10);
    expect(handler.getGamePlayerCount('mass-game')).toBe(10);
  });

  it('seeker location updates from multiple players all reach every game member', () => {
    // All seekers join so their location broadcasts are public.
    const sockets = [];
    for (let i = 0; i < 4; i++) {
      const ws = createMockWs();
      handler.handleConnection(ws, `p${i}`);
      ws.emit('message', msg('join_game', { gameId: 'multi', role: 'seeker' }));
      sockets.push(ws);
    }

    sockets.forEach((ws) => ws.send.mockClear());

    // p0 sends a location update
    sockets[0].emit('message', msg('location_update', { gameId: 'multi', lat: 5, lon: 10 }));

    // All 4 players (including p0 who sent it) should receive the broadcast.
    sockets.forEach((ws) => {
      const types = sent(ws).map((m) => m.type);
      expect(types).toContain('player_location');
    });
  });

  it('player leaving a full game notifies all remaining members', () => {
    const sockets = [];
    for (let i = 0; i < 5; i++) {
      const ws = createMockWs();
      handler.handleConnection(ws, `p${i}`);
      ws.emit('message', msg('join_game', { gameId: 'notify-game' }));
      sockets.push(ws);
    }

    // Clear all outbox so far
    sockets.forEach((ws) => ws.send.mockClear());

    // p4 leaves
    sockets[4].emit('message', msg('leave_game', { gameId: 'notify-game' }));

    // Remaining 4 players should each receive player_left
    for (let i = 0; i < 4; i++) {
      const types = sent(sockets[i]).map((m) => m.type);
      expect(types).toContain('player_left');
    }

    expect(handler.getGamePlayerCount('notify-game')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 8. HeartbeatManager ↔ WsHandler integration
// ---------------------------------------------------------------------------

describe('HeartbeatManager integration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('terminated client is removed from WsHandler on close event', () => {
    const loop = new GameLoop(5000);
    const handler = new WsHandler(loop, new GameStateManager());
    const ws = createMockWs();

    handler.handleConnection(ws, 'p1');
    expect(handler.getConnectedCount()).toBe(1);

    // Simulate heartbeat termination triggering the close event
    ws.terminate();
    ws.emit('close');

    expect(handler.getConnectedCount()).toBe(0);

    loop.stop();
  });

  it('unresponsive client is terminated by HeartbeatManager and cleared from handler', () => {
    const loop = new GameLoop(5000);
    const handler = new WsHandler(loop, new GameStateManager());
    const ws = createMockWs();

    const wss = createMockWss([ws]);
    const hbm = new HeartbeatManager(wss, { interval: 1000 });

    handler.handleConnection(ws, 'p1');
    hbm.track(ws);
    hbm.start();

    // Tick 1: marks ws as awaiting pong
    vi.advanceTimersByTime(1000);
    expect(ws.isAlive).toBe(false);

    // Tick 2: no pong received — terminate
    vi.advanceTimersByTime(1000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);

    // Simulate close event triggered by terminate
    ws.emit('close');
    expect(handler.getConnectedCount()).toBe(0);

    hbm.stop();
    loop.stop();
  });

  it('live client responding with pong stays connected across multiple ticks', () => {
    const loop = new GameLoop(5000);
    const handler = new WsHandler(loop, new GameStateManager());
    const ws = createMockWs();

    const wss = createMockWss([ws]);
    const hbm = new HeartbeatManager(wss, { interval: 1000 });

    handler.handleConnection(ws, 'p1');
    hbm.track(ws);
    hbm.start();

    for (let tick = 0; tick < 5; tick++) {
      vi.advanceTimersByTime(1000);
      ws.emit('pong'); // client responds every tick
    }

    expect(ws.terminate).not.toHaveBeenCalled();
    expect(handler.getConnectedCount()).toBe(1);

    hbm.stop();
    loop.stop();
  });
});
