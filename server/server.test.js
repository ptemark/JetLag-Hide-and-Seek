// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoop, GameLoopStatus } from './gameLoop.js';
import { WsHandler } from './wsHandler.js';
import { GameStateManager } from './gameState.js';
import { HeartbeatManager } from './heartbeat.js';
import { createServer } from './index.js';
import { MetricsCollector, MetricKey } from './monitoring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendNotify(server, payload) {
  return new Promise((resolve) => {
    let body = '';
    const req = Object.assign(
      Object.create(require ? null : null), // plain object is fine for mock
      {
        method: 'POST',
        url: '/internal/notify',
        headers: { host: 'localhost' },
        on(ev, cb) {
          if (ev === 'data') { cb(JSON.stringify(payload)); }
          if (ev === 'end')  { cb(); }
        },
      },
    );
    const res = {
      statusCode: null,
      writeHead(code) { this.statusCode = code; },
      end: resolve,
    };
    server.httpServer.emit('request', req, res);
  });
}

function createMockWs(readyState = 1) {
  const listeners = {};
  return {
    readyState,
    send: vi.fn(),
    on(event, handler) {
      listeners[event] = handler;
    },
    emit(event, ...args) {
      listeners[event]?.(...args);
    },
  };
}

// ---------------------------------------------------------------------------
// GameLoop
// ---------------------------------------------------------------------------

describe('GameLoop', () => {
  let loop;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = new GameLoop(500);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it('starts with IDLE status and zero players', () => {
    expect(loop.status).toBe(GameLoopStatus.IDLE);
    expect(loop.getPlayerCount()).toBe(0);
  });

  it('transitions to RUNNING when started', () => {
    loop.start();
    expect(loop.status).toBe(GameLoopStatus.RUNNING);
  });

  it('returns to IDLE after stop', () => {
    loop.start();
    loop.stop();
    expect(loop.status).toBe(GameLoopStatus.IDLE);
  });

  it('calling start twice does not create duplicate timers', () => {
    loop.start();
    const firstTimer = loop._timer;
    loop.start();
    expect(loop._timer).toBe(firstTimer);
  });

  it('auto-starts when first player added', () => {
    loop.addPlayer('p1');
    expect(loop.status).toBe(GameLoopStatus.RUNNING);
    expect(loop.getPlayerCount()).toBe(1);
  });

  it('auto-stops when last player removed', () => {
    loop.addPlayer('p1');
    loop.removePlayer('p1');
    expect(loop.status).toBe(GameLoopStatus.IDLE);
    expect(loop.getPlayerCount()).toBe(0);
  });

  it('stays running while multiple players remain', () => {
    loop.addPlayer('p1');
    loop.addPlayer('p2');
    loop.removePlayer('p1');
    expect(loop.status).toBe(GameLoopStatus.RUNNING);
    expect(loop.getPlayerCount()).toBe(1);
  });

  it('tracks multiple players correctly', () => {
    loop.addPlayer('p1');
    loop.addPlayer('p2');
    loop.addPlayer('p3');
    expect(loop.getPlayerCount()).toBe(3);
  });

  it('fires onTick callback on each tick', () => {
    const onTick = vi.fn();
    loop.onTick = onTick;
    loop.start();
    vi.advanceTimersByTime(1500);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('stops firing ticks after stop', () => {
    const onTick = vi.fn();
    loop.onTick = onTick;
    loop.start();
    vi.advanceTimersByTime(500);
    loop.stop();
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('clears players on stop', () => {
    loop.addPlayer('p1');
    loop.addPlayer('p2');
    loop.stop();
    expect(loop.getPlayerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WsHandler
// ---------------------------------------------------------------------------

describe('WsHandler', () => {
  let loop;
  let handler;

  beforeEach(() => {
    loop = new GameLoop(1000);
    handler = new WsHandler(loop);
  });

  afterEach(() => {
    loop.stop();
  });

  it('sends connected message on new connection', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'player-1');
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'connected', playerId: 'player-1' })
    );
  });

  it('adds player to game loop on connection', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'player-1');
    expect(loop.getPlayerCount()).toBe(1);
    expect(loop.status).toBe(GameLoopStatus.RUNNING);
  });

  it('increments connected count per connection', () => {
    handler.handleConnection(createMockWs(), 'p1');
    handler.handleConnection(createMockWs(), 'p2');
    expect(handler.getConnectedCount()).toBe(2);
  });

  it('removes player and client on disconnect', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('close');
    expect(handler.getConnectedCount()).toBe(0);
    expect(loop.getPlayerCount()).toBe(0);
  });

  it('removes player and client on error', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('error');
    expect(handler.getConnectedCount()).toBe(0);
  });

  it('acks valid JSON messages', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'ping' }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'ack', received: 'ping', playerId: 'p1' })
    );
  });

  it('sends error on invalid JSON', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', 'not-json{{{');
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', message: 'Invalid JSON' })
    );
  });

  it('broadcasts to all open clients', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    handler.broadcast({ type: 'update', data: 42 });
    expect(ws1.send).toHaveBeenLastCalledWith(
      JSON.stringify({ type: 'update', data: 42 })
    );
    expect(ws2.send).toHaveBeenLastCalledWith(
      JSON.stringify({ type: 'update', data: 42 })
    );
  });

  it('skips closed clients during broadcast', () => {
    const ws1 = createMockWs(1);   // OPEN
    const ws2 = createMockWs(3);   // CLOSED
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.send.mockClear();
    ws2.send.mockClear();
    handler.broadcast({ type: 'update' });
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WsHandler — game routing
// ---------------------------------------------------------------------------

describe('WsHandler — game routing', () => {
  let loop;
  let gsm;
  let handler;

  beforeEach(() => {
    loop = new GameLoop(1000);
    gsm = new GameStateManager();
    handler = new WsHandler(loop, gsm);
  });

  afterEach(() => {
    loop.stop();
  });

  it('join_game sends joined_game confirmation to joiner', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'joined_game', gameId: 'g1', playerId: 'p1', role: 'seeker', team: null })
    );
  });

  it('join_game sends error when gameId missing', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'join_game' }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', message: 'gameId required' })
    );
  });

  it('join_game notifies existing players in game', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    ws1.send.mockClear();

    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));

    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'player_joined', gameId: 'g1', playerId: 'p2', team: null })
    );
  });

  it('join_game does not send player_joined to the joining player themselves', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    const calls = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(calls.find((m) => m.type === 'player_joined')).toBeUndefined();
  });

  it('join_game registers player in GameStateManager', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    const state = gsm.getGameState('g1');
    expect(state.players['p1']).toBeDefined();
    expect(state.players['p1'].role).toBe('hider');
  });

  it('getGamePlayerCount reflects joined players', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    expect(handler.getGamePlayerCount('g1')).toBe(2);
  });

  it('leave_game sends left_game confirmation', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'left_game', gameId: 'g1', playerId: 'p1' })
    );
  });

  it('leave_game removes player from game routing', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(handler.getGamePlayerCount('g1')).toBe(0);
  });

  it('leave_game sends error when gameId missing', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'leave_game' }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', message: 'gameId required' })
    );
  });

  it('leave_game broadcasts player_left to remaining players', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws1.send.mockClear();
    ws2.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'player_left', gameId: 'g1', playerId: 'p2' })
    );
  });

  it('disconnect removes player from all joined games after grace period', () => {
    vi.useFakeTimers();
    // Use a short grace period for this test.
    const shortHandler = new WsHandler(loop, gsm, 100);
    const ws = createMockWs();
    shortHandler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g2' }));
    ws.emit('close');
    // Connected clients map is cleared immediately.
    expect(shortHandler.getConnectedCount()).toBe(0);
    // Game slots are held during the grace period.
    expect(shortHandler.getGamePlayerCount('g1')).toBe(1);
    // After grace period expires, slots are freed.
    vi.advanceTimersByTime(100);
    expect(shortHandler.getGamePlayerCount('g1')).toBe(0);
    expect(shortHandler.getGamePlayerCount('g2')).toBe(0);
    vi.useRealTimers();
  });

  it('seeker location_update broadcasts player_location to game players', () => {
    // Seeker locations are public; all players in the game receive them.
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws1.send.mockClear();
    ws2.send.mockClear();
    ws1.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.12 }));
    const expected = JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.12 });
    expect(ws1.send).toHaveBeenCalledWith(expected);
    expect(ws2.send).toHaveBeenCalledWith(expected);
  });

  it('hider location_update is echoed only to hider, not to other players', () => {
    // Hider location is private: seekers must not see the hider's GPS position (RULES.md §Hiding Rules).
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'hider' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1', role: 'seeker' }));
    ws1.send.mockClear();
    ws2.send.mockClear();
    ws1.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.12 }));
    // Hider receives their own echo for self-marker accuracy.
    const echoMsg = JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.12 });
    expect(ws1.send).toHaveBeenCalledWith(echoMsg);
    // Seeker must NOT receive the hider's location.
    expect(ws2.send).not.toHaveBeenCalled();
  });

  it('location_update updates GameStateManager', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 48.85, lon: 2.35 }));
    const state = gsm.getGameState('g1');
    expect(state.players['p1'].lat).toBe(48.85);
    expect(state.players['p1'].lon).toBe(2.35);
  });

  it('location_update ignores messages missing required fields', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 1 })); // missing lon
    expect(ws.send).not.toHaveBeenCalled(); // silently ignored
  });

  it('request_state returns game state', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'request_state', gameId: 'g1' }));
    const call = JSON.parse(ws.send.mock.calls[0][0]);
    expect(call.type).toBe('game_state');
    expect(call.gameId).toBe('g1');
    expect(call.state).not.toBeNull();
    expect(call.state.players).toHaveProperty('p1');
  });

  it('request_state sends error when gameId missing', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.send.mockClear();
    ws.emit('message', JSON.stringify({ type: 'request_state' }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', message: 'gameId required' })
    );
  });

  it('broadcastToGame only reaches players in the target game', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g2' }));
    ws1.send.mockClear();
    ws2.send.mockClear();
    handler.broadcastToGame('g1', { type: 'test' });
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
    expect(ws2.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Server integration — HTTP health check
// ---------------------------------------------------------------------------

describe('createServer', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and responds to HTTP health check', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('exposes gameLoop, wsHandler, gameStateManager, and heartbeatManager', () => {
    const s = createServer();
    expect(s.gameLoop).toBeInstanceOf(GameLoop);
    expect(s.wsHandler).toBeInstanceOf(WsHandler);
    expect(s.gameStateManager).toBeInstanceOf(GameStateManager);
    expect(s.heartbeatManager).toBeInstanceOf(HeartbeatManager);
  });

  it('heartbeatManager starts on server start and stops on server stop', async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000 });
    await server.start(0);
    expect(server.heartbeatManager._timer).not.toBeNull();
    await server.stop();
    expect(server.heartbeatManager._timer).toBeNull();
    server = null; // already stopped — prevent afterEach double-stop
  });

  it('onActive callback fires when first game starts', () => {
    const s = createServer({ tickInterval: 5000 });
    const onActive = vi.fn();
    s.onActive(onActive);
    s.gameLoopManager.startGame('g1');
    expect(onActive).toHaveBeenCalledTimes(1);
    s.gameLoopManager.stopGame('g1');
  });

  it('onIdle callback fires when last game stops', () => {
    const s = createServer({ tickInterval: 5000 });
    const onIdle = vi.fn();
    s.onIdle(onIdle);
    s.gameLoopManager.startGame('g1');
    s.gameLoopManager.stopGame('g1');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('onActive fires the registered callback when the first game starts', () => {
    const s = createServer({ tickInterval: 5000 });
    const fn = vi.fn();
    s.onActive(fn);
    s.gameLoopManager.startGame('g1');
    expect(fn).toHaveBeenCalledOnce();
    s.gameLoopManager.stopGame('g1');
  });

  it('GET /internal/state/:gameId returns 200 with live game state', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('live-game', { status: 'hiding' });
    server.gameStateManager.addPlayerToGame('live-game', 'p1', 'hider');
    server.gameStateManager.updatePlayerLocation('live-game', 'p1', 51.5, -0.1);

    const res = await fetch(`http://localhost:${port}/internal/state/live-game`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gameId).toBe('live-game');
    expect(body.status).toBe('hiding');
    expect(body.players.p1.lat).toBe(51.5);
    expect(body.players.p1.lon).toBe(-0.1);
  });

  it('GET /internal/state/:gameId returns 404 for unknown game', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/state/no-such-game`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/game not found/i);
  });

  it('GET / still returns health check after state endpoint added', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('GET /internal/admin returns 200 with empty games when no active games', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/admin`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connectedPlayers).toBe(0);
    expect(body.activeGameCount).toBe(0);
    expect(body.games).toEqual([]);
    expect(typeof body.uptimeMs).toBe('number');
  });

  it('GET /internal/admin reflects active games and connected player counts', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameLoopManager.startGame('admin-game');
    server.gameStateManager.createGame('admin-game', { status: 'hiding' });
    server.gameStateManager.addPlayerToGame('admin-game', 'p1', 'hider');

    const res = await fetch(`http://localhost:${port}/internal/admin`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeGameCount).toBe(1);
    const gameEntry = body.games.find((g) => g.gameId === 'admin-game');
    expect(gameEntry).toBeDefined();
    expect(gameEntry.phase).toBe('waiting');
    expect(typeof gameEntry.phaseElapsedMs).toBe('number');

    server.gameLoopManager.stopGame('admin-game');
  });

  it('GET /internal/admin uptimeMs increases over time', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res1 = await fetch(`http://localhost:${port}/internal/admin`);
    const body1 = await res1.json();

    await new Promise((r) => setTimeout(r, 10));

    const res2 = await fetch(`http://localhost:${port}/internal/admin`);
    const body2 = await res2.json();

    expect(body2.uptimeMs).toBeGreaterThanOrEqual(body1.uptimeMs);
  });

  it('GET /internal/admin includes metrics snapshot', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/admin`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
    expect(typeof body.metrics[MetricKey.LOOP_ITERATIONS]).toBe('number');
    expect(typeof body.metrics[MetricKey.ACTIVE_CONNECTIONS]).toBe('number');
    expect(typeof body.metrics[MetricKey.DB_READS]).toBe('number');
    expect(typeof body.metrics[MetricKey.DB_WRITES]).toBe('number');
    expect(typeof body.metrics[MetricKey.ERRORS]).toBe('number');
    expect(typeof body.metrics.loopIterationsPerMinute).toBe('number');
  });

  it('createServer accepts a custom MetricsCollector instance', () => {
    const metrics = new MetricsCollector();
    const s = createServer({ tickInterval: 5000, metrics });
    expect(s.metrics).toBe(metrics);
  });

  it('LOOP_ITERATIONS counter increments on each game tick', async () => {
    vi.useFakeTimers();
    const metrics = new MetricsCollector();
    const s = createServer({ tickInterval: 100, metrics });

    s.gameLoopManager.startGame('tick-game');
    s.gameStateManager.createGame('tick-game', { status: 'hiding' });

    // Advance clock to trigger ticks
    vi.advanceTimersByTime(350);

    const snap = metrics.getSnapshot();
    expect(snap[MetricKey.LOOP_ITERATIONS]).toBeGreaterThanOrEqual(3);

    s.gameLoopManager.stopGame('tick-game');
    vi.useRealTimers();
  });

  it('loopRateTracker is exposed on the server object', () => {
    const s = createServer({ tickInterval: 5000 });
    expect(s.loopRateTracker).toBeDefined();
    expect(typeof s.loopRateTracker.getPerMinute).toBe('function');
  });

  it('alertManager is exposed on the server object', () => {
    const s = createServer({ tickInterval: 5000 });
    expect(s.alertManager).toBeDefined();
  });

  it('createServer accepts a custom alertManager', () => {
    const alertManager = { alert: vi.fn(), checkMetrics: vi.fn(), watchProcess: vi.fn(), reset: vi.fn() };
    const s = createServer({ tickInterval: 5000, alertManager });
    expect(s.alertManager).toBe(alertManager);
  });

  it('alertManager.checkMetrics is called on each game tick', () => {
    vi.useFakeTimers();
    const alertManager = { alert: vi.fn(), checkMetrics: vi.fn(), watchProcess: vi.fn(), reset: vi.fn() };
    const s = createServer({ tickInterval: 100, alertManager });

    s.gameLoopManager.startGame('alert-game');
    s.gameStateManager.createGame('alert-game', { status: 'hiding' });

    vi.advanceTimersByTime(250);

    expect(alertManager.checkMetrics).toHaveBeenCalled();

    s.gameLoopManager.stopGame('alert-game');
    vi.useRealTimers();
  });

  it('alertManager.alert is called on WebSocket error', () => {
    const alertManager = { alert: vi.fn(), checkMetrics: vi.fn(), watchProcess: vi.fn(), reset: vi.fn() };
    const s = createServer({ tickInterval: 5000, alertManager });

    // Simulate a WS error event via the wss connection handler
    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('error', new Error('net error'));

    expect(alertManager.alert).toHaveBeenCalledWith(
      'CONNECTION_DROP',
      expect.any(String),
      expect.objectContaining({ playerId: 'p1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// AutoScaler integration
// ---------------------------------------------------------------------------

describe('createServer — autoScaler integration', () => {
  it('exposes the injected autoScaler on the returned server object', () => {
    const autoScaler = { check: vi.fn(), reset: vi.fn() };
    const s = createServer({ autoScaler });
    expect(s.autoScaler).toBe(autoScaler);
  });

  it('calls autoScaler.check on every game tick', () => {
    vi.useFakeTimers();
    const autoScaler = { check: vi.fn(), reset: vi.fn() };
    const s = createServer({ tickInterval: 100, autoScaler });

    s.gameLoopManager.startGame('as-game');

    vi.advanceTimersByTime(250);

    expect(autoScaler.check).toHaveBeenCalled();
    // Arguments are (activeGames, activeConnections)
    const [activeGames, activeConnections] = autoScaler.check.mock.calls[0];
    expect(typeof activeGames).toBe('number');
    expect(typeof activeConnections).toBe('number');

    s.gameLoopManager.stopGame('as-game');
    vi.useRealTimers();
  });

  it('passes current active game count to autoScaler.check', () => {
    vi.useFakeTimers();
    const autoScaler = { check: vi.fn(), reset: vi.fn() };
    const s = createServer({ tickInterval: 100, autoScaler });

    s.gameLoopManager.startGame('game-a');
    s.gameLoopManager.startGame('game-b');

    vi.advanceTimersByTime(150);

    const calls = autoScaler.check.mock.calls;
    // At least one call should have activeGames >= 2 (both games running)
    expect(calls.some(([games]) => games >= 2)).toBe(true);

    s.gameLoopManager.stopGame('game-a');
    s.gameLoopManager.stopGame('game-b');
    vi.useRealTimers();
  });

  it('uses nullAutoScaler by default (no errors without explicit autoScaler)', () => {
    vi.useFakeTimers();
    // Should not throw when autoScaler is omitted
    const s = createServer({ tickInterval: 100 });
    s.gameLoopManager.startGame('default-game');
    expect(() => vi.advanceTimersByTime(150)).not.toThrow();
    s.gameLoopManager.stopGame('default-game');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Question expiry — StateDispatcher task
// ---------------------------------------------------------------------------

describe('createServer — question expiry task', () => {
  it('calls store.dbExpireStaleQuestions on each seeking tick', () => {
    vi.useFakeTimers();
    const expireFn = vi.fn().mockResolvedValue([]);
    const s = createServer({
      tickInterval: 100,
      store: { dbExpireStaleQuestions: ({ gameId }) => expireFn(gameId) },
    });

    s.gameLoopManager.startGame('exp-game');
    s.gameStateManager.createGame('exp-game', { status: 'seeking' });

    vi.advanceTimersByTime(250);

    expect(expireFn).toHaveBeenCalledWith('exp-game');

    s.gameLoopManager.stopGame('exp-game');
    vi.useRealTimers();
  });

  it('broadcasts question_expired for each expired question returned', async () => {
    // Test the stateDispatcher task directly to avoid timer-loop complexity.
    const expiredQ = { questionId: 'q-dead', gameId: 'qe-game', askerId: 'a1' };
    const expireFn = vi.fn().mockResolvedValueOnce([expiredQ]).mockResolvedValue([]);
    const s = createServer({
      tickInterval: 5000,
      store: { dbExpireStaleQuestions: ({ gameId }) => expireFn(gameId) },
    });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'qe-game' }));
    mockWs.send.mockClear();

    // The join_game WS message already created the game with 'waiting' status.
    // Advance it to 'seeking' so the question_expiry task fires.
    s.gameStateManager.setGameStatus('qe-game', 'seeking');
    const gameState = s.gameStateManager.getGameState('qe-game');

    // Dispatch directly — no timer loop needed.
    await s.stateDispatcher.dispatch(gameState);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    expect(broadcasts.some(b => b.type === 'question_expired' && b.questionId === 'q-dead')).toBe(true);
  });

  it('does not throw when store.dbExpireStaleQuestions is absent', () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 100, store: null });
    s.gameLoopManager.startGame('no-store-game');
    s.gameStateManager.createGame('no-store-game', { status: 'seeking' });
    expect(() => vi.advanceTimersByTime(250)).not.toThrow();
    s.gameLoopManager.stopGame('no-store-game');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// POST /internal/games/:gameId/start — scale-aware game start (Task 68)
// ---------------------------------------------------------------------------

describe('POST /internal/games/:gameId/start', () => {
  let server;

  afterEach(async () => {
    vi.useRealTimers();
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('responds 204 and starts the game in HIDING phase', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/my-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'medium' }),
    });
    expect(res.status).toBe(204);
    expect(server.gameLoopManager.getPhase('my-game')).toBe('hiding');
  });

  it('small scale sets 30-minute hiding duration', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/small-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'small' }),
    });
    expect(server.gameLoopManager.getGameDuration('small-game', 'hiding')).toBe(30 * 60_000);
    expect(server.gameLoopManager.getGameDuration('small-game', 'seeking')).toBe(30 * 60_000);
  });

  it('medium scale sets 60-minute durations', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/med-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'medium' }),
    });
    expect(server.gameLoopManager.getGameDuration('med-game', 'hiding')).toBe(60 * 60_000);
    expect(server.gameLoopManager.getGameDuration('med-game', 'seeking')).toBe(60 * 60_000);
  });

  it('large scale sets 180-minute durations', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/large-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'large' }),
    });
    expect(server.gameLoopManager.getGameDuration('large-game', 'hiding')).toBe(180 * 60_000);
    expect(server.gameLoopManager.getGameDuration('large-game', 'seeking')).toBe(180 * 60_000);
  });

  it('unknown scale falls back to constructor-default durations', async () => {
    server = createServer({ tickInterval: 5000, hidingDuration: 120_000, seekingDuration: 600_000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/unknown-scale-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'giant' }),
    });
    expect(server.gameLoopManager.getGameDuration('unknown-scale-game', 'hiding')).toBe(120_000);
    expect(server.gameLoopManager.getGameDuration('unknown-scale-game', 'seeking')).toBe(600_000);
  });

  it('missing body falls back to constructor-default durations', async () => {
    server = createServer({ tickInterval: 5000, hidingDuration: 120_000, seekingDuration: 600_000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/no-body-game/start`, {
      method: 'POST',
    });
    expect(server.gameLoopManager.getGameDuration('no-body-game', 'hiding')).toBe(120_000);
    expect(server.gameLoopManager.getGameDuration('no-body-game', 'seeking')).toBe(600_000);
  });

  it('calling start twice is idempotent — second call is a no-op for game state', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/dup-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'small' }),
    });
    const firstPhase = server.gameLoopManager.getPhase('dup-game');

    await fetch(`http://localhost:${port}/internal/games/dup-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'large' }),
    });
    // Phase and duration must not change on second call
    expect(server.gameLoopManager.getPhase('dup-game')).toBe(firstPhase);
    expect(server.gameLoopManager.getGameDuration('dup-game', 'hiding')).toBe(30 * 60_000);
  });

  // Task 74 — configurable hiding duration within scale range
  it('custom hidingDurationMs within small range overrides scale default', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    await fetch(`http://localhost:${port}/internal/games/custom-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'small', hidingDurationMs: 45 * 60_000, seekingDurationMs: 45 * 60_000 }),
    });
    expect(server.gameLoopManager.getGameDuration('custom-game', 'hiding')).toBe(45 * 60_000);
    expect(server.gameLoopManager.getGameDuration('custom-game', 'seeking')).toBe(45 * 60_000);
  });

  it('returns 400 when hidingDurationMs is below the scale minimum', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/low-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'small', hidingDurationMs: 10 * 60_000 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/out of range/i);
  });

  it('returns 400 when hidingDurationMs exceeds the scale maximum', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/high-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 'small', hidingDurationMs: 90 * 60_000 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/out of range/i);
  });

  it('custom hidingDurationMs without scale is applied directly (no range check)', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/no-scale-game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidingDurationMs: 25 * 60_000 }),
    });
    expect(res.status).toBe(204);
    expect(server.gameLoopManager.getGameDuration('no-scale-game', 'hiding')).toBe(25 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// Timer sync — phase-change broadcast + periodic tick
// ---------------------------------------------------------------------------

describe('createServer — timer sync', () => {
  it('broadcasts timer_sync immediately on transition to hiding phase', () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 5000, hidingDuration: 120_000, seekingDuration: 600_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'ts-game' }));
    s.gameLoopManager.startGame('ts-game');
    mockWs.send.mockClear();

    s.gameLoopManager.beginHiding('ts-game');

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSync = broadcasts.find((b) => b.type === 'timer_sync');
    expect(timerSync).toBeTruthy();
    expect(timerSync.phase).toBe('hiding');
    expect(timerSync.phaseEndsAt).toBeTruthy();
    expect(new Date(timerSync.phaseEndsAt) > new Date()).toBe(true);

    s.gameLoopManager.stopGame('ts-game');
    vi.useRealTimers();
  });

  it('broadcasts timer_sync immediately on transition to seeking phase', () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 5000, hidingDuration: 120_000, seekingDuration: 600_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'ts-seek' }));
    s.gameLoopManager.startGame('ts-seek');
    s.gameLoopManager.beginHiding('ts-seek');
    mockWs.send.mockClear();

    s.gameLoopManager.beginSeeking('ts-seek');

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSync = broadcasts.find((b) => b.type === 'timer_sync');
    expect(timerSync).toBeTruthy();
    expect(timerSync.phase).toBe('seeking');
    expect(timerSync.phaseEndsAt).toBeTruthy();

    s.gameLoopManager.stopGame('ts-seek');
    vi.useRealTimers();
  });

  it('does not broadcast timer_sync on transition to waiting (no duration)', () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 5000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'ts-wait' }));
    mockWs.send.mockClear();

    // startGame enters WAITING phase — no timer_sync expected
    s.gameLoopManager.startGame('ts-wait');

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    expect(broadcasts.some((b) => b.type === 'timer_sync')).toBe(false);

    s.gameLoopManager.stopGame('ts-wait');
    vi.useRealTimers();
  });

  it('broadcasts timer_sync periodically during seeking phase (30 s throttle)', () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 100, hidingDuration: 120_000, seekingDuration: 600_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'ts-periodic' }));
    s.gameLoopManager.startGame('ts-periodic');
    // Manually advance phases so gameLoopManager tracks the correct phase on ticks.
    s.gameLoopManager.beginHiding('ts-periodic');
    s.gameLoopManager.beginSeeking('ts-periodic');
    // Clear all phase-change + phase-entry timer_sync broadcasts.
    mockWs.send.mockClear();

    // Advance 31 s — periodic timer_sync should fire at least once (throttle = 30 s).
    vi.advanceTimersByTime(31_000);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSyncs = broadcasts.filter((b) => b.type === 'timer_sync');
    // At least one sync broadcast, at most a handful (throttled to ~1/30 s).
    expect(timerSyncs.length).toBeGreaterThan(0);
    expect(timerSyncs.length).toBeLessThanOrEqual(3);
    expect(timerSyncs[0].phase).toBe('seeking');
    expect(timerSyncs[0].phaseEndsAt).toBeTruthy();

    s.gameLoopManager.stopGame('ts-periodic');
    vi.useRealTimers();
  });

  it('phaseEndsAt is approximately hidingDuration in the future on phase entry', () => {
    vi.useFakeTimers();
    const HIDING = 120_000;
    const s = createServer({ tickInterval: 5000, hidingDuration: HIDING, seekingDuration: 600_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'ts-ends' }));
    s.gameLoopManager.startGame('ts-ends');
    s.gameLoopManager.beginHiding('ts-ends');

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSync = broadcasts.find((b) => b.type === 'timer_sync' && b.phase === 'hiding');
    const remainingMs = new Date(timerSync.phaseEndsAt) - Date.now();
    // Should be very close to HIDING duration (within 1 s for test overhead).
    expect(remainingMs).toBeGreaterThan(HIDING - 1000);
    expect(remainingMs).toBeLessThanOrEqual(HIDING);

    s.gameLoopManager.stopGame('ts-ends');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Hider timeout victory
// ---------------------------------------------------------------------------

describe('createServer — hider timeout victory', () => {
  it('broadcasts capture event with winner hider when seeking phase expires without capture', () => {
    vi.useFakeTimers();
    const SEEKING = 500;
    const s = createServer({ tickInterval: 100, hidingDuration: 10_000, seekingDuration: SEEKING });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'timeout-game' }));
    s.gameLoopManager.startGame('timeout-game');
    s.gameLoopManager.beginHiding('timeout-game');
    s.gameLoopManager.beginSeeking('timeout-game');
    mockWs.send.mockClear();

    // Advance past seeking duration so the timer auto-finishes the game.
    vi.advanceTimersByTime(SEEKING + 200);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const captureEvent = broadcasts.find((b) => b.type === 'capture');
    expect(captureEvent).toBeTruthy();
    expect(captureEvent.winner).toBe('hider');
    expect(captureEvent.seekersInZone).toEqual([]);
    expect(captureEvent.captureTeam).toBeNull();
    expect(typeof captureEvent.seekingElapsedMs).toBe('number');
    expect(captureEvent.seekingElapsedMs).toBeGreaterThanOrEqual(SEEKING);

    vi.useRealTimers();
  });

  it('calls store.dbUpdateGameStatus with finished when hider wins by timeout', async () => {
    vi.useFakeTimers();
    const SEEKING = 300;
    const updateStatusFn = vi.fn().mockResolvedValue(undefined);
    const s = createServer({
      tickInterval: 50,
      hidingDuration: 10_000,
      seekingDuration: SEEKING,
      store: { dbUpdateGameStatus: updateStatusFn, dbExpireStaleQuestions: vi.fn().mockResolvedValue([]) },
    });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'timeout-db-game' }));
    s.gameLoopManager.startGame('timeout-db-game');
    s.gameLoopManager.beginHiding('timeout-db-game');
    s.gameLoopManager.beginSeeking('timeout-db-game');

    vi.advanceTimersByTime(SEEKING + 100);

    // Allow async store call to resolve.
    await Promise.resolve();

    expect(updateStatusFn).toHaveBeenCalledWith({ gameId: 'timeout-db-game', status: 'finished' });

    vi.useRealTimers();
  });

  it('broadcasts end_game_started (not capture) when all seekers enter zone (phase 1)', async () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 5000, seekingDuration: 600_000, endGameTimeoutMs: 600_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'end-game-phase1', role: 'seeker' }));
    s.gameLoopManager.startGame('end-game-phase1');
    s.gameLoopManager.beginHiding('end-game-phase1');
    s.gameLoopManager.beginSeeking('end-game-phase1');

    // Set up a hider in zone so capture_check triggers.
    s.gameStateManager.addPlayerToGame('end-game-phase1', 'hider1', 'hider');
    s.gameStateManager.updatePlayerLocation('end-game-phase1', 'hider1', 0, 0);
    s.gameStateManager.updatePlayerLocation('end-game-phase1', 'p1', 0, 0);
    s.gameStateManager.setGameZones('end-game-phase1', [{ stationId: 's1', lat: 0, lon: 0, radiusM: 1000 }]);

    mockWs.send.mockClear();

    // Dispatch the capture task directly.
    const gameState = s.gameStateManager.getGameState('end-game-phase1');
    await s.stateDispatcher.dispatch(gameState);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));

    // Phase 1: end_game_started — no capture event yet.
    expect(broadcasts.some((b) => b.type === 'end_game_started')).toBe(true);
    expect(broadcasts.some((b) => b.type === 'capture')).toBe(false);

    // Game is still alive (not finished).
    expect(s.gameLoopManager.getPhase('end-game-phase1')).toBe('seeking');

    vi.useRealTimers();
  });

  it('broadcasts timer_sync with phase end_game alongside end_game_started', async () => {
    vi.useFakeTimers();
    const END_GAME_MS = 10 * 60_000;
    const s = createServer({ tickInterval: 5000, seekingDuration: 600_000, endGameTimeoutMs: END_GAME_MS });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=eg-timer-p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'eg-timer-game', role: 'seeker' }));
    s.gameLoopManager.startGame('eg-timer-game');
    s.gameLoopManager.beginHiding('eg-timer-game');
    s.gameLoopManager.beginSeeking('eg-timer-game');

    s.gameStateManager.addPlayerToGame('eg-timer-game', 'eg-hider1', 'hider');
    s.gameStateManager.updatePlayerLocation('eg-timer-game', 'eg-hider1', 0, 0);
    s.gameStateManager.updatePlayerLocation('eg-timer-game', 'eg-timer-p1', 0, 0);
    s.gameStateManager.setGameZones('eg-timer-game', [{ stationId: 's1', lat: 0, lon: 0, radiusM: 1000 }]);

    mockWs.send.mockClear();
    const now = Date.now();

    const gameState = s.gameStateManager.getGameState('eg-timer-game');
    await s.stateDispatcher.dispatch(gameState);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSync = broadcasts.find((b) => b.type === 'timer_sync' && b.phase === 'end_game');
    expect(timerSync).toBeTruthy();
    expect(timerSync.gameId).toBe('eg-timer-game');
    // phaseEndsAt should be approximately now + END_GAME_MS.
    const endsAt = new Date(timerSync.phaseEndsAt).getTime();
    expect(endsAt).toBeGreaterThanOrEqual(now + END_GAME_MS - 100);
    expect(endsAt).toBeLessThanOrEqual(now + END_GAME_MS + 100);

    vi.useRealTimers();
  });

  it('periodic tick broadcasts timer_sync for end_game phase when end game is active', async () => {
    vi.useFakeTimers();
    const END_GAME_MS = 10 * 60_000;
    const s = createServer({ tickInterval: 100, seekingDuration: 600_000, endGameTimeoutMs: END_GAME_MS });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=eg-tick-p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'eg-tick-game', role: 'seeker' }));
    s.gameLoopManager.startGame('eg-tick-game');
    s.gameLoopManager.beginHiding('eg-tick-game');
    s.gameLoopManager.beginSeeking('eg-tick-game');

    s.gameStateManager.addPlayerToGame('eg-tick-game', 'eg-tick-hider', 'hider');
    s.gameStateManager.updatePlayerLocation('eg-tick-game', 'eg-tick-hider', 0, 0);
    s.gameStateManager.updatePlayerLocation('eg-tick-game', 'eg-tick-p1', 0, 0);
    s.gameStateManager.setGameZones('eg-tick-game', [{ stationId: 's1', lat: 0, lon: 0, radiusM: 1000 }]);

    // Trigger End Game.
    const gameState = s.gameStateManager.getGameState('eg-tick-game');
    await s.stateDispatcher.dispatch(gameState);
    mockWs.send.mockClear();

    // Advance 31 s — periodic timer sync should fire.
    vi.advanceTimersByTime(31_000);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSync = broadcasts.find((b) => b.type === 'timer_sync' && b.phase === 'end_game');
    expect(timerSync).toBeTruthy();

    vi.useRealTimers();
  });

  it('broadcasts capture(winner=hider) when end game timeout expires with no spot_hider', async () => {
    vi.useFakeTimers();
    const END_GAME_MS = 500;
    const s = createServer({ tickInterval: 5000, seekingDuration: 600_000, endGameTimeoutMs: END_GAME_MS });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'eg-timeout-game', role: 'seeker' }));
    s.gameLoopManager.startGame('eg-timeout-game');
    s.gameLoopManager.beginHiding('eg-timeout-game');
    s.gameLoopManager.beginSeeking('eg-timeout-game');

    s.gameStateManager.addPlayerToGame('eg-timeout-game', 'hider1', 'hider');
    s.gameStateManager.updatePlayerLocation('eg-timeout-game', 'hider1', 0, 0);
    s.gameStateManager.updatePlayerLocation('eg-timeout-game', 'p1', 0, 0);
    s.gameStateManager.setGameZones('eg-timeout-game', [{ stationId: 's1', lat: 0, lon: 0, radiusM: 1000 }]);

    // Trigger End Game (phase 1).
    const gameState = s.gameStateManager.getGameState('eg-timeout-game');
    await s.stateDispatcher.dispatch(gameState);
    mockWs.send.mockClear();

    // Advance past End Game timeout.
    vi.advanceTimersByTime(END_GAME_MS + 100);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const captureEvent = broadcasts.find((b) => b.type === 'capture');
    expect(captureEvent).toBeTruthy();
    expect(captureEvent.winner).toBe('hider');

    vi.useRealTimers();
  });

  it('broadcasts capture(winner=seekers) via onSpotConfirmed during End Game', async () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 5000, seekingDuration: 600_000, endGameTimeoutMs: 60_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'spot-end-game', role: 'seeker' }));
    s.gameLoopManager.startGame('spot-end-game');
    s.gameLoopManager.beginHiding('spot-end-game');
    s.gameLoopManager.beginSeeking('spot-end-game');

    s.gameStateManager.addPlayerToGame('spot-end-game', 'hider1', 'hider');
    s.gameStateManager.updatePlayerLocation('spot-end-game', 'hider1', 0, 0);
    s.gameStateManager.updatePlayerLocation('spot-end-game', 'p1', 0, 0);
    s.gameStateManager.setGameZones('spot-end-game', [{ stationId: 's1', lat: 0, lon: 0, radiusM: 1000 }]);

    // Trigger End Game (phase 1).
    const gameState = s.gameStateManager.getGameState('spot-end-game');
    await s.stateDispatcher.dispatch(gameState);
    mockWs.send.mockClear();

    // Seeker spots hider within radius via WS spot_hider message.
    // Inject stub checkSpot that always returns spotted=true.
    s.wsHandler._checkSpotFn = vi.fn().mockReturnValue({ spotted: true, distance: 5, hiderLat: 0, hiderLon: 0 });
    mockWs.emit('message', JSON.stringify({ type: 'spot_hider', gameId: 'spot-end-game' }));

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const captureEvent = broadcasts.find((b) => b.type === 'capture');
    expect(captureEvent).toBeTruthy();
    expect(captureEvent.winner).toBe('seekers');
    expect(captureEvent.spotterId).toBe('p1');

    vi.useRealTimers();
  });

  it('hider timeout victory does not double-broadcast when end_game already handled hider win', async () => {
    vi.useFakeTimers();
    const END_GAME_MS = 200;
    const SEEKING_MS  = 600_000;
    const s = createServer({ tickInterval: 5000, seekingDuration: SEEKING_MS, endGameTimeoutMs: END_GAME_MS });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'no-double-hider', role: 'seeker' }));
    s.gameLoopManager.startGame('no-double-hider');
    s.gameLoopManager.beginHiding('no-double-hider');
    s.gameLoopManager.beginSeeking('no-double-hider');

    s.gameStateManager.addPlayerToGame('no-double-hider', 'hider1', 'hider');
    s.gameStateManager.updatePlayerLocation('no-double-hider', 'hider1', 0, 0);
    s.gameStateManager.updatePlayerLocation('no-double-hider', 'p1', 0, 0);
    s.gameStateManager.setGameZones('no-double-hider', [{ stationId: 's1', lat: 0, lon: 0, radiusM: 1000 }]);

    // Trigger End Game (phase 1).
    const gameState = s.gameStateManager.getGameState('no-double-hider');
    await s.stateDispatcher.dispatch(gameState);
    mockWs.send.mockClear();

    // Advance past End Game timeout (fires hider win).
    vi.advanceTimersByTime(END_GAME_MS + 50);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const captureEvents = broadcasts.filter((b) => b.type === 'capture');
    // Exactly one hider-win capture event (no duplicate from onPhaseChange).
    expect(captureEvents.length).toBe(1);
    expect(captureEvents[0].winner).toBe('hider');

    vi.useRealTimers();
  });

  it('does not broadcast capture event when game is stopped without playing (stopGame)', () => {
    vi.useFakeTimers();
    const s = createServer({ tickInterval: 5000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'stop-game' }));
    s.gameLoopManager.startGame('stop-game');
    mockWs.send.mockClear();

    // stopGame does NOT trigger onPhaseChange — no capture event expected.
    s.gameLoopManager.stopGame('stop-game');

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    expect(broadcasts.some((b) => b.type === 'capture')).toBe(false);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Time bonus — /internal/notify + extendPhase + timer_sync broadcast
// ---------------------------------------------------------------------------

describe('createServer — time bonus notify', () => {
  it('/internal/notify time_bonus calls extendPhase on the game', async () => {
    const s = createServer({ tickInterval: 5000, hidingDuration: 600_000, seekingDuration: 600_000 });

    s.gameLoopManager.startGame('tb-game');
    s.gameLoopManager.beginHiding('tb-game');
    expect(s.gameLoopManager.getPhaseExtension('tb-game')).toBe(0);

    await sendNotify(s, { type: 'time_bonus', gameId: 'tb-game', minutesAdded: 10 });

    expect(s.gameLoopManager.getPhaseExtension('tb-game')).toBe(600_000);

    s.gameLoopManager.stopGame('tb-game');
  });

  it('/internal/notify time_bonus broadcasts updated timer_sync to game players', async () => {
    const s = createServer({ tickInterval: 5000, hidingDuration: 120_000, seekingDuration: 600_000 });

    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'tb-sync' }));
    s.gameLoopManager.startGame('tb-sync');
    s.gameLoopManager.beginHiding('tb-sync');
    mockWs.send.mockClear();

    await sendNotify(s, { type: 'time_bonus', gameId: 'tb-sync', minutesAdded: 5 });

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const timerSync = broadcasts.find((b) => b.type === 'timer_sync');
    expect(timerSync).toBeTruthy();
    expect(timerSync.phase).toBe('hiding');
    // phaseEndsAt should be > 120 s in the future (original duration + 5 min extension)
    const remainingMs = new Date(timerSync.phaseEndsAt) - Date.now();
    expect(remainingMs).toBeGreaterThan(120_000);

    s.gameLoopManager.stopGame('tb-sync');
  });

  it('/internal/notify time_bonus with unknown gameId does not throw', async () => {
    const s = createServer({ tickInterval: 5000 });
    await expect(
      sendNotify(s, { type: 'time_bonus', gameId: 'no-such-game', minutesAdded: 10 })
    ).resolves.not.toThrow();
  });

  it('/internal/notify false_zone broadcasts false_zone event when zones exist', async () => {
    const s = createServer({ tickInterval: 5000 });
    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'fz-game' }));

    // Register a zone so the server has something to offset.
    s.gameStateManager.createGame('fz-game');
    s.gameStateManager.setGameZones('fz-game', [
      { stationId: 's1', name: 'Station A', lat: 51.5, lon: -0.1, radiusM: 500 },
    ]);
    mockWs.send.mockClear();

    await sendNotify(s, { type: 'false_zone', gameId: 'fz-game' });

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const falseZoneMsg = broadcasts.find((b) => b.type === 'false_zone');
    expect(falseZoneMsg).toBeTruthy();
    expect(falseZoneMsg.gameId).toBe('fz-game');
    expect(typeof falseZoneMsg.zone.lat).toBe('number');
    expect(typeof falseZoneMsg.zone.lon).toBe('number');
    expect(falseZoneMsg.zone.decoyId).toBeTruthy();
    // Decoy should be offset from the original zone (not identical).
    expect(falseZoneMsg.zone.lat).not.toBe(51.5);
  });

  it('/internal/notify false_zone does nothing when no zones registered', async () => {
    const s = createServer({ tickInterval: 5000 });
    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'fz-nozone' }));
    s.gameStateManager.createGame('fz-nozone');
    mockWs.send.mockClear();

    await sendNotify(s, { type: 'false_zone', gameId: 'fz-nozone' });

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    expect(broadcasts.find((b) => b.type === 'false_zone')).toBeUndefined();
  });

  it('/internal/notify false_zone with unknown gameId does not throw', async () => {
    const s = createServer({ tickInterval: 5000 });
    await expect(
      sendNotify(s, { type: 'false_zone', gameId: 'no-such-game' })
    ).resolves.not.toThrow();
  });
});

describe('false_zone_expiry StateDispatcher task', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('broadcasts false_zone_expired when decoy duration elapses', async () => {
    const s = createServer({ tickInterval: 5000 });
    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'fze-game' }));

    s.gameStateManager.createGame('fze-game');
    s.gameStateManager.setGameZones('fze-game', [
      { stationId: 's1', name: 'Station A', lat: 51.5, lon: -0.1, radiusM: 500 },
    ]);
    s.gameStateManager.setGameStatus('fze-game', 'seeking');

    // Register a false zone via the notify endpoint (fake timers active so Date.now() is frozen).
    await sendNotify(s, { type: 'false_zone', gameId: 'fze-game' });

    const fzBroadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const fzMsg = fzBroadcasts.find((b) => b.type === 'false_zone');
    expect(fzMsg).toBeTruthy();
    const decoyId = fzMsg.zone.decoyId;

    // Advance time past the 5-minute expiry.
    mockWs.send.mockClear();
    vi.advanceTimersByTime(5 * 60_000 + 100);

    // Manually trigger the seeking-phase stateDispatcher tasks.
    const gameState = s.gameStateManager.getGameState('fze-game');
    await s.stateDispatcher.dispatch(gameState);

    const expiryBroadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    const expiredMsg = expiryBroadcasts.find((b) => b.type === 'false_zone_expired');
    expect(expiredMsg).toBeTruthy();
    expect(expiredMsg.decoyId).toBe(decoyId);
    expect(expiredMsg.gameId).toBe('fze-game');
  });

  it('does not expire decoy before duration elapses', async () => {
    const s = createServer({ tickInterval: 5000 });
    const mockWs = createMockWs();
    s.wss.emit('connection', mockWs, { url: '/?playerId=p1', headers: { host: 'localhost' } });
    mockWs.emit('message', JSON.stringify({ type: 'join_game', gameId: 'fze-early' }));

    s.gameStateManager.createGame('fze-early');
    s.gameStateManager.setGameZones('fze-early', [
      { stationId: 's1', name: 'Station A', lat: 51.5, lon: -0.1, radiusM: 500 },
    ]);
    s.gameStateManager.setGameStatus('fze-early', 'seeking');

    await sendNotify(s, { type: 'false_zone', gameId: 'fze-early' });
    mockWs.send.mockClear();

    // Only advance 1 minute — decoy should still be active.
    vi.advanceTimersByTime(60_000);

    const gameState = s.gameStateManager.getGameState('fze-early');
    await s.stateDispatcher.dispatch(gameState);

    const broadcasts = mockWs.send.mock.calls.map(([m]) => JSON.parse(m));
    expect(broadcasts.find((b) => b.type === 'false_zone_expired')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /internal/games/:gameId/thermometer
// ---------------------------------------------------------------------------

describe('GET /internal/games/:gameId/thermometer', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    vi.useRealTimers();
  });

  it('returns 401 when no Authorization header and adminApiKey is configured', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/g1/thermometer?seekerId=s1`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when wrong token is provided', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/g1/thermometer?seekerId=s1`, {
      headers: { 'Authorization': 'Bearer wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown game', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/no-game/thermometer?seekerId=s1`, {
      headers: { 'Authorization': 'Bearer secret-key' },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/game not found/i);
  });

  it('returns thermometer result when seeker moved closer to hider (warmer)', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('therm-game', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('therm-game', 'hider1', 'hider');
    server.gameStateManager.addPlayerToGame('therm-game', 'seeker1', 'seeker');
    // Hider position
    server.gameStateManager.updatePlayerLocation('therm-game', 'hider1', 51.5, 0);
    // Seeker: first update sets previousLocation, second moves closer
    server.gameStateManager.updatePlayerLocation('therm-game', 'seeker1', 51.6, 0);   // ~11 km from hider
    server.gameStateManager.updatePlayerLocation('therm-game', 'seeker1', 51.51, 0);  // ~1 km from hider

    const res = await fetch(
      `http://localhost:${port}/internal/games/therm-game/thermometer?seekerId=seeker1`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('warmer');
    expect(typeof body.currentDistanceM).toBe('number');
    expect(typeof body.previousDistanceM).toBe('number');
    expect(body.currentDistanceM).toBeLessThan(body.previousDistanceM);
  });

  it('returns unknown result when seeker has no previous location', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('therm-noprev', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('therm-noprev', 'hider1', 'hider');
    server.gameStateManager.addPlayerToGame('therm-noprev', 'seeker1', 'seeker');
    server.gameStateManager.updatePlayerLocation('therm-noprev', 'hider1', 51.5, 0);
    // Only one location update — no previousLocation yet.
    server.gameStateManager.updatePlayerLocation('therm-noprev', 'seeker1', 51.51, 0);

    const res = await fetch(
      `http://localhost:${port}/internal/games/therm-noprev/thermometer?seekerId=seeker1`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('unknown');
  });

  it('allows access when no adminApiKey is configured (open endpoint)', async () => {
    server = createServer({ tickInterval: 5000 }); // no adminApiKey
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('open-game', { status: 'seeking' });

    const res = await fetch(`http://localhost:${port}/internal/games/open-game/thermometer?seekerId=s1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('unknown'); // seeker not in game → unknown
  });
});

// ---------------------------------------------------------------------------
// GET /internal/games/:gameId/measuring
// ---------------------------------------------------------------------------

describe('GET /internal/games/:gameId/measuring', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    vi.useRealTimers();
  });

  it('returns 401 when no Authorization header and adminApiKey is configured', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/g1/measuring?seekerId=s1&targetLat=51.5&targetLon=0`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when wrong token is supplied', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(
      `http://localhost:${port}/internal/games/g1/measuring?seekerId=s1&targetLat=51.5&targetLon=0`,
      { headers: { 'Authorization': 'Bearer wrong-key' } },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown game', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(
      `http://localhost:${port}/internal/games/no-game/measuring?seekerId=s1&targetLat=51.5&targetLon=0`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/game not found/i);
  });

  it('returns hiderIsCloser true when hider is closer to the target than the seeker', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('meas-hider-game', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('meas-hider-game', 'hider1', 'hider');
    server.gameStateManager.addPlayerToGame('meas-hider-game', 'seeker1', 'seeker');
    // Hider in London, seeker in Birmingham, target in Paris.
    server.gameStateManager.updatePlayerLocation('meas-hider-game', 'hider1',  51.5074, -0.1278);
    server.gameStateManager.updatePlayerLocation('meas-hider-game', 'seeker1', 52.4862, -1.8904);

    const params = new URLSearchParams({ seekerId: 'seeker1', targetLat: '48.8584', targetLon: '2.2945' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/meas-hider-game/measuring?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hiderIsCloser).toBe(true);
    expect(typeof body.hiderDistanceKm).toBe('number');
    expect(typeof body.seekerDistanceKm).toBe('number');
    expect(body.hiderDistanceKm).toBeLessThan(body.seekerDistanceKm);
  });

  it('returns hiderIsCloser false when seeker is closer to the target', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('meas-seeker-game', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('meas-seeker-game', 'hider1', 'hider');
    server.gameStateManager.addPlayerToGame('meas-seeker-game', 'seeker1', 'seeker');
    // Hider in Birmingham (far from Paris), seeker in London (closer to Paris).
    server.gameStateManager.updatePlayerLocation('meas-seeker-game', 'hider1',  52.4862, -1.8904);
    server.gameStateManager.updatePlayerLocation('meas-seeker-game', 'seeker1', 51.5074, -0.1278);

    const params = new URLSearchParams({ seekerId: 'seeker1', targetLat: '48.8584', targetLon: '2.2945' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/meas-seeker-game/measuring?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hiderIsCloser).toBe(false);
  });

  it('returns nulls when hider has no location', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('meas-noloc', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('meas-noloc', 'seeker1', 'seeker');
    server.gameStateManager.updatePlayerLocation('meas-noloc', 'seeker1', 51.5, 0);
    // No hider location update.

    const params = new URLSearchParams({ seekerId: 'seeker1', targetLat: '51.5', targetLon: '0' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/meas-noloc/measuring?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hiderIsCloser).toBeNull();
    expect(body.hiderDistanceKm).toBeNull();
  });

  it('returns nulls when seekerId is missing', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('meas-noseeker', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('meas-noseeker', 'hider1', 'hider');
    server.gameStateManager.updatePlayerLocation('meas-noseeker', 'hider1', 51.5, 0);

    // No seekerId in params.
    const params = new URLSearchParams({ targetLat: '51.5', targetLon: '0' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/meas-noseeker/measuring?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hiderIsCloser).toBeNull();
    expect(body.seekerDistanceKm).toBeNull();
  });

  it('is accessible without token when no adminApiKey is configured', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('open-meas-game', { status: 'seeking' });

    const params = new URLSearchParams({ seekerId: 's1', targetLat: '51.5', targetLon: '0' });
    const res = await fetch(`http://localhost:${port}/internal/games/open-meas-game/measuring?${params}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hiderIsCloser).toBeNull(); // no hider in game
  });
});

// ---------------------------------------------------------------------------
// GET /internal/games/:gameId/tentacle
// ---------------------------------------------------------------------------

describe('GET /internal/games/:gameId/tentacle', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    vi.useRealTimers();
  });

  it('returns 401 when no Authorization header and adminApiKey is configured', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/g1/tentacle?targetLat=51.5&targetLon=0&radiusKm=2`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when wrong Bearer token', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(
      `http://localhost:${port}/internal/games/g1/tentacle?targetLat=51.5&targetLon=0&radiusKm=2`,
      { headers: { 'Authorization': 'Bearer wrong-key' } },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when game not found', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(
      `http://localhost:${port}/internal/games/no-game/tentacle?targetLat=51.5&targetLon=0&radiusKm=2`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/game not found/i);
  });

  it('returns withinRadius true when hider is inside the specified radius', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    // Set up hider at London (51.5074, -0.1278); target at same point, radius 1 km → within.
    server.gameStateManager.createGame('tent-game', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('tent-game', 'hider1', 'hider');
    server.gameStateManager.updatePlayerLocation('tent-game', 'hider1', 51.5074, -0.1278);

    const params = new URLSearchParams({ targetLat: '51.5074', targetLon: '-0.1278', radiusKm: '1' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/tent-game/tentacle?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.withinRadius).toBe(true);
    expect(typeof body.distanceKm).toBe('number');
  });

  it('returns withinRadius false when hider is outside the specified radius', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    // Hider in London; target ~150 km away in Birmingham; radius 1 km → outside.
    server.gameStateManager.createGame('tent-out-game', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('tent-out-game', 'hider1', 'hider');
    server.gameStateManager.updatePlayerLocation('tent-out-game', 'hider1', 51.5074, -0.1278);

    const params = new URLSearchParams({ targetLat: '52.4862', targetLon: '-1.8904', radiusKm: '1' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/tent-out-game/tentacle?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.withinRadius).toBe(false);
    expect(body.distanceKm).toBeGreaterThan(1);
  });

  it('returns nulls when hider has no location', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('tent-noloc', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('tent-noloc', 'hider1', 'hider');
    // No location update → hider has no lat/lon.

    const params = new URLSearchParams({ targetLat: '51.5', targetLon: '0', radiusKm: '2' });
    const res = await fetch(
      `http://localhost:${port}/internal/games/tent-noloc/tentacle?${params}`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.withinRadius).toBeNull();
    expect(body.distanceKm).toBeNull();
  });

  it('is accessible without auth when adminApiKey is not configured', async () => {
    server = createServer({ tickInterval: 5000 });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('open-tent-game', { status: 'seeking' });

    const params = new URLSearchParams({ targetLat: '51.5', targetLon: '0', radiusKm: '2' });
    const res = await fetch(`http://localhost:${port}/internal/games/open-tent-game/tentacle?${params}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.withinRadius).toBeNull(); // no hider in game
  });
});

// GET /internal/games/:gameId/hider-position
// ---------------------------------------------------------------------------

describe('GET /internal/games/:gameId/hider-position', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    vi.useRealTimers();
  });

  it('returns 401 when no Authorization header and adminApiKey is configured', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/internal/games/g1/hider-position`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 404 for an unknown game', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    const res = await fetch(
      `http://localhost:${port}/internal/games/no-game/hider-position`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/game not found/i);
  });

  it('returns hider lat/lon when the hider has a position', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('hpos-game', { status: 'seeking' });
    server.gameStateManager.addPlayerToGame('hpos-game', 'hider1', 'hider');
    server.gameStateManager.updatePlayerLocation('hpos-game', 'hider1', 51.5074, -0.1278);

    const res = await fetch(
      `http://localhost:${port}/internal/games/hpos-game/hider-position`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lat).toBeCloseTo(51.5074);
    expect(body.lon).toBeCloseTo(-0.1278);
  });

  it('returns { lat: null, lon: null } when hider has not sent a location', async () => {
    server = createServer({ tickInterval: 5000, adminApiKey: 'secret-key' });
    await server.start(0);
    const port = server.httpServer.address().port;

    server.gameStateManager.createGame('hpos-noloc', { status: 'hiding' });
    server.gameStateManager.addPlayerToGame('hpos-noloc', 'hider2', 'hider');

    const res = await fetch(
      `http://localhost:${port}/internal/games/hpos-noloc/hider-position`,
      { headers: { 'Authorization': 'Bearer secret-key' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lat).toBeNull();
    expect(body.lon).toBeNull();
  });
});
