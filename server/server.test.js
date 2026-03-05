// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoop, GameLoopStatus } from './gameLoop.js';
import { WsHandler } from './wsHandler.js';
import { createServer } from './index.js';

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

  it('exposes gameLoop and wsHandler', () => {
    const s = createServer();
    expect(s.gameLoop).toBeInstanceOf(GameLoop);
    expect(s.wsHandler).toBeInstanceOf(WsHandler);
  });
});
