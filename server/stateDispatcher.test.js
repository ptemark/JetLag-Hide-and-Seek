import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateDispatcher } from './stateDispatcher.js';

function makeState(overrides = {}) {
  return { gameId: 'g1', status: 'hiding', players: {}, ...overrides };
}

describe('StateDispatcher', () => {
  let dispatcher;

  beforeEach(() => {
    dispatcher = new StateDispatcher();
  });

  // ── Registration ────────────────────────────────────────────────────────

  describe('register()', () => {
    it('registers a task without throwing', () => {
      expect(() => dispatcher.register('hiding', 'myTask', () => {})).not.toThrow();
    });

    it('throws if fn is not a function', () => {
      expect(() => dispatcher.register('hiding', 'bad', 'not-a-fn')).toThrow(TypeError);
    });

    it('allows multiple tasks under the same phase', () => {
      dispatcher.register('hiding', 'a', () => 1);
      dispatcher.register('hiding', 'b', () => 2);
      expect(dispatcher._tasks.get('hiding')).toHaveLength(2);
    });

    it('allows tasks under different phases independently', () => {
      dispatcher.register('hiding', 'h', () => {});
      dispatcher.register('seeking', 's', () => {});
      expect(dispatcher._tasks.get('hiding')).toHaveLength(1);
      expect(dispatcher._tasks.get('seeking')).toHaveLength(1);
    });

    it('allows global "*" tasks', () => {
      dispatcher.register('*', 'global', () => {});
      expect(dispatcher._tasks.get('*')).toHaveLength(1);
    });
  });

  // ── clearPhase / clearAll ───────────────────────────────────────────────

  describe('clearPhase()', () => {
    it('removes all tasks for the given phase', () => {
      dispatcher.register('hiding', 'h', () => {});
      dispatcher.register('seeking', 's', () => {});
      dispatcher.clearPhase('hiding');
      expect(dispatcher._tasks.has('hiding')).toBe(false);
      expect(dispatcher._tasks.has('seeking')).toBe(true);
    });
  });

  describe('clearAll()', () => {
    it('removes every task', () => {
      dispatcher.register('hiding', 'h', () => {});
      dispatcher.register('*', 'g', () => {});
      dispatcher.clearAll();
      expect(dispatcher._tasks.size).toBe(0);
    });
  });

  // ── dispatch() ─────────────────────────────────────────────────────────

  describe('dispatch()', () => {
    it('returns empty array when no tasks are registered', async () => {
      const results = await dispatcher.dispatch(makeState());
      expect(results).toEqual([]);
    });

    it('returns empty array when gameState is null', async () => {
      const results = await dispatcher.dispatch(null);
      expect(results).toEqual([]);
    });

    it('runs task matching current phase', async () => {
      dispatcher.register('hiding', 'zoneCheck', () => 'zones-ok');
      const results = await dispatcher.dispatch(makeState({ status: 'hiding' }));
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ name: 'zoneCheck', status: 'ok', value: 'zones-ok' });
    });

    it('does NOT run task registered for a different phase', async () => {
      dispatcher.register('seeking', 'captureCheck', () => 'found');
      const results = await dispatcher.dispatch(makeState({ status: 'hiding' }));
      expect(results).toHaveLength(0);
    });

    it('runs global "*" tasks regardless of phase', async () => {
      dispatcher.register('*', 'heartbeat', () => 'ping');
      const results = await dispatcher.dispatch(makeState({ status: 'seeking' }));
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('heartbeat');
    });

    it('runs both global and phase-specific tasks together', async () => {
      dispatcher.register('*', 'global', () => 'g');
      dispatcher.register('hiding', 'phaseTask', () => 'h');
      const results = await dispatcher.dispatch(makeState({ status: 'hiding' }));
      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain('global');
      expect(names).toContain('phaseTask');
    });

    it('passes the full game state snapshot to each task', async () => {
      const received = [];
      dispatcher.register('hiding', 'spy', (state) => { received.push(state); });
      const state = makeState({ players: { p1: { lat: 1, lon: 2, role: 'hider' } } });
      await dispatcher.dispatch(state);
      expect(received[0]).toEqual(state);
    });

    it('supports async tasks', async () => {
      dispatcher.register('hiding', 'asyncTask', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 'async-done';
      });
      const results = await dispatcher.dispatch(makeState());
      expect(results[0]).toEqual({ name: 'asyncTask', status: 'ok', value: 'async-done' });
    });

    it('isolates task errors — other tasks still complete', async () => {
      dispatcher.register('hiding', 'bad', () => { throw new Error('boom'); });
      dispatcher.register('hiding', 'good', () => 'ok');
      const results = await dispatcher.dispatch(makeState());
      expect(results).toHaveLength(2);
      const bad = results.find((r) => r.name === 'bad');
      const good = results.find((r) => r.name === 'good');
      expect(bad.status).toBe('error');
      expect(bad.error.message).toBe('boom');
      expect(good.status).toBe('ok');
      expect(good.value).toBe('ok');
    });

    it('isolates async task errors', async () => {
      dispatcher.register('hiding', 'asyncBad', async () => { throw new Error('async-boom'); });
      const results = await dispatcher.dispatch(makeState());
      expect(results[0].status).toBe('error');
      expect(results[0].error.message).toBe('async-boom');
    });

    it('runs multiple tasks registered for the same phase concurrently', async () => {
      const order = [];
      dispatcher.register('hiding', 't1', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('t1');
      });
      dispatcher.register('hiding', 't2', async () => {
        order.push('t2');
      });
      await dispatcher.dispatch(makeState());
      // Both must have run (order may vary — concurrent)
      expect(order).toContain('t1');
      expect(order).toContain('t2');
    });
  });

  // ── onDispatch callback ─────────────────────────────────────────────────

  describe('onDispatch callback', () => {
    it('fires with gameId, phase, and results after dispatch', async () => {
      const cb = vi.fn();
      dispatcher.onDispatch = cb;
      dispatcher.register('hiding', 'task', () => 'result');
      const state = makeState({ gameId: 'game-123', status: 'hiding' });
      await dispatcher.dispatch(state);
      expect(cb).toHaveBeenCalledOnce();
      const [gameId, phase, results] = cb.mock.calls[0];
      expect(gameId).toBe('game-123');
      expect(phase).toBe('hiding');
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('result');
    });

    it('does not throw if onDispatch is null', async () => {
      dispatcher.onDispatch = null;
      dispatcher.register('hiding', 't', () => {});
      await expect(dispatcher.dispatch(makeState())).resolves.toBeDefined();
    });

    it('fires even when a task errors', async () => {
      const cb = vi.fn();
      dispatcher.onDispatch = cb;
      dispatcher.register('hiding', 'bad', () => { throw new Error('x'); });
      await dispatcher.dispatch(makeState());
      expect(cb).toHaveBeenCalledOnce();
      const [, , results] = cb.mock.calls[0];
      expect(results[0].status).toBe('error');
    });

    it('fires with empty results when no tasks registered', async () => {
      const cb = vi.fn();
      dispatcher.onDispatch = cb;
      await dispatcher.dispatch(makeState({ gameId: 'g2', status: 'waiting' }));
      expect(cb).toHaveBeenCalledWith('g2', 'waiting', []);
    });
  });

  // ── Integration: wired to game phases ──────────────────────────────────

  describe('phase-gating integration', () => {
    it('dispatches correct tasks across all four phases', async () => {
      const log = [];
      dispatcher.register('*', 'always', () => log.push('*'));
      dispatcher.register('waiting', 'onWaiting', () => log.push('waiting'));
      dispatcher.register('hiding', 'onHiding', () => log.push('hiding'));
      dispatcher.register('seeking', 'onSeeking', () => log.push('seeking'));
      dispatcher.register('finished', 'onFinished', () => log.push('finished'));

      for (const status of ['waiting', 'hiding', 'seeking', 'finished']) {
        log.length = 0;
        await dispatcher.dispatch(makeState({ status }));
        expect(log).toContain('*');
        expect(log).toContain(status);
        expect(log).toHaveLength(2);
      }
    });
  });
});
