// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatManager } from './heartbeat.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWs() {
  const listeners = {};
  return {
    isAlive: undefined,
    ping: vi.fn(),
    terminate: vi.fn(),
    on(event, handler) {
      listeners[event] = handler;
    },
    emit(event) {
      listeners[event]?.();
    },
  };
}

function createMockWss(clients = []) {
  return { clients: new Set(clients) };
}

// ---------------------------------------------------------------------------
// HeartbeatManager
// ---------------------------------------------------------------------------

describe('HeartbeatManager — track()', () => {
  it('sets isAlive to true on new connection', () => {
    const hbm = new HeartbeatManager(createMockWss());
    const ws = createMockWs();
    hbm.track(ws);
    expect(ws.isAlive).toBe(true);
  });

  it('registers pong listener that resets isAlive', () => {
    const hbm = new HeartbeatManager(createMockWss());
    const ws = createMockWs();
    hbm.track(ws);
    ws.isAlive = false;
    ws.emit('pong');
    expect(ws.isAlive).toBe(true);
  });

  it('pong listener can be fired multiple times', () => {
    const hbm = new HeartbeatManager(createMockWss());
    const ws = createMockWs();
    hbm.track(ws);
    ws.isAlive = false;
    ws.emit('pong');
    ws.isAlive = false;
    ws.emit('pong');
    expect(ws.isAlive).toBe(true);
  });
});

describe('HeartbeatManager — start/stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start begins periodic ticks at the configured interval', () => {
    const ws = createMockWs();
    ws.isAlive = true;
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.start();
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    hbm.stop();
  });

  it('start is idempotent — calling twice does not double-tick', () => {
    const ws = createMockWs();
    ws.isAlive = true;
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.start();
    hbm.start();
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    hbm.stop();
  });

  it('stop cancels further ticks', () => {
    const ws = createMockWs();
    ws.isAlive = true;
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.start();
    hbm.stop();
    vi.advanceTimersByTime(3000);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it('stop is idempotent — calling twice does not throw', () => {
    const hbm = new HeartbeatManager(createMockWss(), { interval: 1000 });
    hbm.start();
    hbm.stop();
    expect(() => hbm.stop()).not.toThrow();
  });
});

describe('HeartbeatManager — tick behaviour', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pings alive clients and marks them as awaiting pong', () => {
    const ws = createMockWs();
    ws.isAlive = true;
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.start();
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.isAlive).toBe(false);
    hbm.stop();
  });

  it('terminates unresponsive clients and does not ping them', () => {
    const ws = createMockWs();
    ws.isAlive = false;
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.start();
    vi.advanceTimersByTime(1000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(ws.ping).not.toHaveBeenCalled();
    hbm.stop();
  });

  it('handles mixed alive and dead clients in one tick', () => {
    const alive = createMockWs();
    alive.isAlive = true;
    const dead = createMockWs();
    dead.isAlive = false;
    const hbm = new HeartbeatManager(createMockWss([alive, dead]), { interval: 1000 });
    hbm.start();
    vi.advanceTimersByTime(1000);
    expect(alive.ping).toHaveBeenCalledTimes(1);
    expect(alive.terminate).not.toHaveBeenCalled();
    expect(dead.terminate).toHaveBeenCalledTimes(1);
    expect(dead.ping).not.toHaveBeenCalled();
    hbm.stop();
  });

  it('client that responds with pong survives the next tick', () => {
    const ws = createMockWs();
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.track(ws);      // sets isAlive=true, registers pong listener
    hbm.start();

    // Tick 1: alive → marked as awaiting → pinged
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.isAlive).toBe(false);

    // Client sends pong
    ws.emit('pong');
    expect(ws.isAlive).toBe(true);

    // Tick 2: alive again → pinged, NOT terminated
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(ws.terminate).not.toHaveBeenCalled();

    hbm.stop();
  });

  it('client that does not respond to pong is terminated on next tick', () => {
    const ws = createMockWs();
    const hbm = new HeartbeatManager(createMockWss([ws]), { interval: 1000 });
    hbm.track(ws);
    hbm.start();

    // Tick 1: alive → marked as awaiting → pinged
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    // No pong response — isAlive stays false

    // Tick 2: not alive → terminated
    vi.advanceTimersByTime(1000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);

    hbm.stop();
  });

  it('empty client set causes no errors during tick', () => {
    const hbm = new HeartbeatManager(createMockWss([]), { interval: 1000 });
    hbm.start();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    hbm.stop();
  });
});
