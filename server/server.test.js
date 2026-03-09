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
      JSON.stringify({ type: 'joined_game', gameId: 'g1', playerId: 'p1', role: 'seeker' })
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
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws1.send.mockClear();

    handler.handleConnection(ws2, 'p2');
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));

    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'player_joined', gameId: 'g1', playerId: 'p2' })
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
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
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
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws1.send.mockClear();
    ws2.emit('message', JSON.stringify({ type: 'leave_game', gameId: 'g1' }));
    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'player_left', gameId: 'g1', playerId: 'p2' })
    );
  });

  it('disconnect removes player from all joined games', () => {
    const ws = createMockWs();
    handler.handleConnection(ws, 'p1');
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g2' }));
    ws.emit('close');
    expect(handler.getGamePlayerCount('g1')).toBe(0);
    expect(handler.getGamePlayerCount('g2')).toBe(0);
    expect(handler.getConnectedCount()).toBe(0);
  });

  it('location_update broadcasts to game players', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    handler.handleConnection(ws1, 'p1');
    handler.handleConnection(ws2, 'p2');
    ws1.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws2.emit('message', JSON.stringify({ type: 'join_game', gameId: 'g1' }));
    ws1.send.mockClear();
    ws2.send.mockClear();
    ws1.emit('message', JSON.stringify({ type: 'location_update', gameId: 'g1', lat: 51.5, lon: -0.12 }));
    const expected = JSON.stringify({ type: 'location_update', gameId: 'g1', playerId: 'p1', lat: 51.5, lon: -0.12 });
    expect(ws1.send).toHaveBeenCalledWith(expected);
    expect(ws2.send).toHaveBeenCalledWith(expected);
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
