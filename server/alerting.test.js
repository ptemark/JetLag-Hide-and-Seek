import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertManager, AlertType, nullAlertManager } from './alerting.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
}

// ── AlertType constants ────────────────────────────────────────────────────────

describe('AlertType', () => {
  it('exposes all expected type keys', () => {
    expect(AlertType.SERVER_CRASH).toBe('SERVER_CRASH');
    expect(AlertType.DB_ERROR).toBe('DB_ERROR');
    expect(AlertType.CONNECTION_DROP).toBe('CONNECTION_DROP');
    expect(AlertType.ERROR_RATE_HIGH).toBe('ERROR_RATE_HIGH');
    expect(AlertType.LOOP_STALL).toBe('LOOP_STALL');
  });

  it('is frozen (immutable)', () => {
    expect(() => { AlertType.NEW_KEY = 'x'; }).toThrow();
  });
});

// ── AlertManager — construction ────────────────────────────────────────────────

describe('AlertManager — construction', () => {
  it('constructs with no options', () => {
    expect(() => new AlertManager()).not.toThrow();
  });

  it('accepts custom threshold', () => {
    const am = new AlertManager({ thresholds: { errorCount: 5 } });
    expect(am._errorThreshold).toBe(5);
  });

  it('defaults errorCount threshold to 10', () => {
    const am = new AlertManager();
    expect(am._errorThreshold).toBe(10);
  });
});

// ── AlertManager.alert() ──────────────────────────────────────────────────────

describe('AlertManager.alert() — logger', () => {
  it('logs at error level', () => {
    const logger = makeLogger();
    const am = new AlertManager({ logger });
    am.alert(AlertType.CONNECTION_DROP, 'ws error', { playerId: 'p1' });
    expect(logger.error).toHaveBeenCalledOnce();
    const [category, message, data] = logger.error.mock.calls[0];
    expect(category).toBe('alert');
    expect(message).toBe('ws error');
    expect(data.alertType).toBe(AlertType.CONNECTION_DROP);
    expect(data.playerId).toBe('p1');
  });
});

describe('AlertManager.alert() — onAlert callback', () => {
  it('invokes the callback with type, message, data', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.alert(AlertType.DB_ERROR, 'db failure', { query: 'SELECT 1' });
    expect(onAlert).toHaveBeenCalledOnce();
    expect(onAlert).toHaveBeenCalledWith(AlertType.DB_ERROR, 'db failure', { query: 'SELECT 1' });
  });

  it('does not throw if the callback throws', () => {
    const onAlert = vi.fn(() => { throw new Error('boom'); });
    const am = new AlertManager({ onAlert });
    expect(() => am.alert(AlertType.SERVER_CRASH, 'crash')).not.toThrow();
  });

  it('skips callback if not provided', () => {
    const am = new AlertManager();
    expect(() => am.alert(AlertType.LOOP_STALL, 'stall')).not.toThrow();
  });
});

describe('AlertManager.alert() — webhook', () => {
  it('POSTs JSON to the webhook URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const am = new AlertManager({ webhookUrl: 'https://example.com/hook', fetchFn });
    am.alert(AlertType.SERVER_CRASH, 'crash', { error: 'oops' });
    // Allow fire-and-forget promise to settle
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.type).toBe(AlertType.SERVER_CRASH);
    expect(body.message).toBe('crash');
    expect(body.error).toBe('oops');
    expect(body.timestamp).toBeDefined();
  });

  it('silently swallows webhook fetch errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    const am = new AlertManager({ webhookUrl: 'https://example.com/hook', fetchFn });
    expect(() => am.alert(AlertType.LOOP_STALL, 'stall')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve(); // two ticks for promise chain
  });

  it('does not call fetch when no webhookUrl is set', async () => {
    const fetchFn = vi.fn();
    const am = new AlertManager({ fetchFn });
    am.alert(AlertType.CONNECTION_DROP, 'drop');
    await Promise.resolve();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ── AlertManager.checkMetrics() — error rate ──────────────────────────────────

describe('AlertManager.checkMetrics() — error rate', () => {
  it('does not alert when errors are below threshold', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 5 }, 60, 0);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('fires ERROR_RATE_HIGH when errors cross the threshold', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 11 }, 60, 0);
    expect(onAlert).toHaveBeenCalledOnce();
    expect(onAlert.mock.calls[0][0]).toBe(AlertType.ERROR_RATE_HIGH);
  });

  it('does not fire the same threshold crossing twice', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 11 }, 60, 0);
    am.checkMetrics({ errors: 12 }, 60, 0);
    expect(onAlert).toHaveBeenCalledOnce();
  });

  it('fires again when the next threshold multiple is crossed', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 11 }, 60, 0); // multiple=1
    am.checkMetrics({ errors: 21 }, 60, 0); // multiple=2
    expect(onAlert).toHaveBeenCalledTimes(2);
  });

  it('does not alert when errors is zero', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 0 }, 60, 0);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('includes errors and threshold in alert data', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 15 }, 60, 0);
    const data = onAlert.mock.calls[0][2];
    expect(data.errors).toBe(15);
    expect(data.threshold).toBe(10);
  });
});

// ── AlertManager.checkMetrics() — loop stall ──────────────────────────────────

describe('AlertManager.checkMetrics() — loop stall', () => {
  it('does not alert when there are no active games', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.checkMetrics({ errors: 0 }, 0, 0);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('does not alert when loop is healthy', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.checkMetrics({ errors: 0 }, 30, 2);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('fires LOOP_STALL when active games exist but rate is zero', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.checkMetrics({ errors: 0 }, 0, 1);
    expect(onAlert).toHaveBeenCalledOnce();
    expect(onAlert.mock.calls[0][0]).toBe(AlertType.LOOP_STALL);
  });

  it('does not fire LOOP_STALL twice in a row', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.checkMetrics({ errors: 0 }, 0, 1);
    am.checkMetrics({ errors: 0 }, 0, 1);
    expect(onAlert).toHaveBeenCalledOnce();
  });

  it('re-fires LOOP_STALL after recovery then re-stall', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.checkMetrics({ errors: 0 }, 0, 1); // stall
    am.checkMetrics({ errors: 0 }, 10, 1); // recovery
    am.checkMetrics({ errors: 0 }, 0, 1);  // stall again
    expect(onAlert).toHaveBeenCalledTimes(2);
  });

  it('includes activeGameCount and loopIterationsPerMin in alert data', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.checkMetrics({ errors: 0 }, 0, 3);
    const data = onAlert.mock.calls[0][2];
    expect(data.activeGameCount).toBe(3);
    expect(data.loopIterationsPerMin).toBe(0);
  });
});

// ── AlertManager.reset() ──────────────────────────────────────────────────────

describe('AlertManager.reset()', () => {
  it('clears fired state so alerts can re-fire', () => {
    const onAlert = vi.fn();
    const am = new AlertManager({ thresholds: { errorCount: 10 }, onAlert });
    am.checkMetrics({ errors: 11 }, 60, 0);
    expect(onAlert).toHaveBeenCalledOnce();
    am.reset();
    am.checkMetrics({ errors: 11 }, 60, 0);
    expect(onAlert).toHaveBeenCalledTimes(2);
  });
});

// ── AlertManager.watchProcess() ───────────────────────────────────────────────

describe('AlertManager.watchProcess()', () => {
  it('registers process-level listeners', () => {
    const addListener = vi.spyOn(process, 'on').mockImplementation(() => process);
    const am = new AlertManager();
    am.watchProcess();
    const events = addListener.mock.calls.map((c) => c[0]);
    expect(events).toContain('uncaughtException');
    expect(events).toContain('unhandledRejection');
    addListener.mockRestore();
  });

  it('fires SERVER_CRASH on uncaughtException listener', () => {
    let uncaughtHandler;
    vi.spyOn(process, 'on').mockImplementation((event, fn) => {
      if (event === 'uncaughtException') uncaughtHandler = fn;
      return process;
    });
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.watchProcess();
    uncaughtHandler(new Error('kaboom'));
    expect(onAlert).toHaveBeenCalledWith(AlertType.SERVER_CRASH, expect.any(String), expect.any(Object));
    vi.restoreAllMocks();
  });

  it('fires SERVER_CRASH on unhandledRejection listener', () => {
    let rejectionHandler;
    vi.spyOn(process, 'on').mockImplementation((event, fn) => {
      if (event === 'unhandledRejection') rejectionHandler = fn;
      return process;
    });
    const onAlert = vi.fn();
    const am = new AlertManager({ onAlert });
    am.watchProcess();
    rejectionHandler('reason string');
    expect(onAlert).toHaveBeenCalledWith(AlertType.SERVER_CRASH, expect.any(String), expect.any(Object));
    vi.restoreAllMocks();
  });
});

// ── nullAlertManager ─────────────────────────────────────────────────────────

describe('nullAlertManager', () => {
  it('all methods exist', () => {
    expect(typeof nullAlertManager.alert).toBe('function');
    expect(typeof nullAlertManager.checkMetrics).toBe('function');
    expect(typeof nullAlertManager.watchProcess).toBe('function');
    expect(typeof nullAlertManager.reset).toBe('function');
  });

  it('calling methods does not throw', () => {
    expect(() => nullAlertManager.alert('T', 'msg', {})).not.toThrow();
    expect(() => nullAlertManager.checkMetrics({}, 0, 0)).not.toThrow();
    expect(() => nullAlertManager.watchProcess()).not.toThrow();
    expect(() => nullAlertManager.reset()).not.toThrow();
  });

  it('is frozen', () => {
    expect(() => { nullAlertManager.newProp = 1; }).toThrow();
  });
});
