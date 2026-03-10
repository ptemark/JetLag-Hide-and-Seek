import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShutdownManager } from './shutdown.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeShutdown(overrides = {}) {
  const stopFn         = vi.fn().mockResolvedValue(undefined);
  const exitFn         = vi.fn();
  const setTimeoutFn   = vi.fn((fn, ms) => {
    // Return a handle; store fn so tests can fire it manually.
    const handle = { fn, ms };
    setTimeoutFn._pending = handle;
    return handle;
  });
  const clearTimeoutFn = vi.fn((handle) => {
    if (setTimeoutFn._pending === handle) {
      setTimeoutFn._pending = null;
    }
  });
  const processRef     = { once: vi.fn() };

  const mgr = new ShutdownManager({
    stopFn,
    exitFn,
    setTimeoutFn,
    clearTimeoutFn,
    processRef,
    ...overrides,
  });

  return { mgr, stopFn, exitFn, setTimeoutFn, clearTimeoutFn, processRef };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ShutdownManager — idle shutdown (no delay)', () => {
  it('calls stopFn and exitFn when onIdle fires with idleDelayMs=0', async () => {
    const { mgr, stopFn, exitFn } = makeShutdown({ idleDelayMs: 0 });
    await mgr.onIdle();
    expect(stopFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('does not call stopFn twice if onIdle is called multiple times', async () => {
    const { mgr, stopFn } = makeShutdown({ idleDelayMs: 0 });
    await mgr.onIdle();
    await mgr.onIdle();
    expect(stopFn).toHaveBeenCalledOnce();
  });
});

describe('ShutdownManager — idle shutdown with delay', () => {
  it('schedules a timer when onIdle fires with idleDelayMs > 0', () => {
    const { mgr, setTimeoutFn, exitFn } = makeShutdown({ idleDelayMs: 5000 });
    mgr.onIdle();
    expect(setTimeoutFn).toHaveBeenCalledOnce();
    expect(setTimeoutFn.mock.calls[0][1]).toBe(5000);
    // Exit not yet called
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('shuts down when the timer fires', async () => {
    const { mgr, setTimeoutFn, stopFn, exitFn } = makeShutdown({ idleDelayMs: 5000 });
    mgr.onIdle();
    // Manually trigger the timer callback
    await setTimeoutFn._pending.fn();
    expect(stopFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('cancels the timer when onActive fires during countdown', () => {
    const { mgr, setTimeoutFn, clearTimeoutFn, exitFn } = makeShutdown({ idleDelayMs: 5000 });
    mgr.onIdle();
    const handle = setTimeoutFn._pending;
    mgr.onActive();
    expect(clearTimeoutFn).toHaveBeenCalledWith(handle);
    expect(setTimeoutFn._pending).toBeNull();
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('does not schedule a second timer if already counting down', () => {
    const { mgr, setTimeoutFn } = makeShutdown({ idleDelayMs: 5000 });
    mgr.onIdle();
    mgr.onIdle(); // second call — should be ignored
    expect(setTimeoutFn).toHaveBeenCalledOnce();
  });

  it('shuts down again after active→idle cycle when timer was cancelled', async () => {
    const { mgr, setTimeoutFn, stopFn, exitFn } = makeShutdown({ idleDelayMs: 5000 });

    // First idle → active → idle cycle
    mgr.onIdle();
    mgr.onActive();       // cancel first countdown
    mgr.onIdle();         // start second countdown
    await setTimeoutFn._pending.fn();

    expect(stopFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });
});

describe('ShutdownManager — signal handlers', () => {
  it('registers SIGTERM and SIGINT handlers via watchSignals', () => {
    const { mgr, processRef } = makeShutdown();
    mgr.watchSignals();
    expect(processRef.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processRef.once).toHaveBeenCalledWith('SIGINT',  expect.any(Function));
  });

  it('shuts down cleanly on SIGTERM', async () => {
    const { mgr, processRef, stopFn, exitFn } = makeShutdown();
    mgr.watchSignals();
    const sigtermHandler = processRef.once.mock.calls.find(c => c[0] === 'SIGTERM')[1];
    await sigtermHandler();
    expect(stopFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('shuts down cleanly on SIGINT', async () => {
    const { mgr, processRef, stopFn, exitFn } = makeShutdown();
    mgr.watchSignals();
    const sigintHandler = processRef.once.mock.calls.find(c => c[0] === 'SIGINT')[1];
    await sigintHandler();
    expect(stopFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('ignores duplicate shutdown from concurrent signal + idle', async () => {
    const { mgr, processRef, stopFn, exitFn } = makeShutdown({ idleDelayMs: 0 });
    mgr.watchSignals();
    const sigtermHandler = processRef.once.mock.calls.find(c => c[0] === 'SIGTERM')[1];
    // Fire both concurrently
    await Promise.all([sigtermHandler(), mgr.onIdle()]);
    expect(stopFn).toHaveBeenCalledOnce();
    expect(exitFn).toHaveBeenCalledOnce();
  });
});

describe('ShutdownManager — cleanup hooks', () => {
  it('calls registered cleanup functions before exit', async () => {
    const order = [];
    const { mgr } = makeShutdown({ idleDelayMs: 0 });
    mgr.onCleanup(() => order.push('a'));
    mgr.onCleanup(() => order.push('b'));
    await mgr.onIdle();
    expect(order).toEqual(['a', 'b']);
  });

  it('awaits async cleanup functions', async () => {
    let resolved = false;
    const { mgr, exitFn } = makeShutdown({ idleDelayMs: 0 });
    mgr.onCleanup(() => new Promise(r => setTimeout(() => { resolved = true; r(); }, 0)));
    await mgr.onIdle();
    expect(resolved).toBe(true);
    expect(exitFn).toHaveBeenCalled();
  });

  it('continues cleanup and exits even if one cleanup throws', async () => {
    const order = [];
    const { mgr, exitFn } = makeShutdown({ idleDelayMs: 0 });
    mgr.onCleanup(() => { throw new Error('fail'); });
    mgr.onCleanup(() => order.push('ran'));
    await mgr.onIdle();
    expect(order).toEqual(['ran']);
    expect(exitFn).toHaveBeenCalledWith(0);
  });
});

describe('ShutdownManager — stopFn error handling', () => {
  it('still exits even when stopFn rejects', async () => {
    const stopFn = vi.fn().mockRejectedValue(new Error('stop failed'));
    const exitFn = vi.fn();
    const mgr = new ShutdownManager({
      stopFn,
      idleDelayMs: 0,
      exitFn,
      processRef: { once: vi.fn() },
    });
    await mgr.onIdle();
    expect(exitFn).toHaveBeenCalledWith(0);
  });
});

describe('ShutdownManager — onActive with no pending timer', () => {
  it('is a no-op when no idle countdown is active', () => {
    const { mgr, clearTimeoutFn } = makeShutdown({ idleDelayMs: 5000 });
    // Should not throw and should not call clearTimeout
    mgr.onActive();
    expect(clearTimeoutFn).not.toHaveBeenCalled();
  });
});
