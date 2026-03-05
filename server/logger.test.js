import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger, LogLevel, LogCategory, nullLogger } from './logger.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSink() {
  const entries = [];
  return { sink: (e) => entries.push(e), entries };
}

// ── Logger construction ──────────────────────────────────────────────────────

describe('Logger construction', () => {
  it('defaults to info level', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ sink });
    logger.debug(LogCategory.LOOP, 'should be filtered');
    logger.info(LogCategory.LOOP, 'should appear');
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('should appear');
  });

  it('accepts debug level and emits all entries', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sink });
    logger.debug(LogCategory.LOOP, 'dbg');
    logger.info(LogCategory.LOOP, 'inf');
    logger.warn(LogCategory.ERROR, 'wrn');
    logger.error(LogCategory.SERVER, 'err');
    expect(entries).toHaveLength(4);
  });

  it('accepts error level and filters debug/info/warn', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.ERROR, sink });
    logger.debug(LogCategory.LOOP, 'd');
    logger.info(LogCategory.LOOP, 'i');
    logger.warn(LogCategory.LOOP, 'w');
    logger.error(LogCategory.ERROR, 'e');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
  });

  it('throws on unknown level', () => {
    expect(() => new Logger({ level: 'verbose' })).toThrow(RangeError);
  });
});

// ── Log entry structure ──────────────────────────────────────────────────────

describe('Log entry structure', () => {
  it('emits required fields on every entry', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ sink });
    logger.info(LogCategory.LOOP, 'tick', { gameId: 'g1', phase: 'hiding' });
    const e = entries[0];
    expect(e).toMatchObject({
      level:    'info',
      category: LogCategory.LOOP,
      message:  'tick',
      gameId:   'g1',
      phase:    'hiding',
    });
    expect(typeof e.timestamp).toBe('string');
    expect(() => new Date(e.timestamp)).not.toThrow();
  });

  it('merges arbitrary data fields into the entry', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ sink });
    logger.warn(LogCategory.ERROR, 'oops', { taskName: 'zoneCalc', gameId: 'g2' });
    expect(entries[0].taskName).toBe('zoneCalc');
    expect(entries[0].gameId).toBe('g2');
  });
});

// ── Level methods ────────────────────────────────────────────────────────────

describe('Level methods', () => {
  it.each([
    ['debug', LogLevel.DEBUG],
    ['info',  LogLevel.INFO],
    ['warn',  LogLevel.WARN],
    ['error', LogLevel.ERROR],
  ])('%s() sets level to %s', (method, expectedLevel) => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sink });
    logger[method](LogCategory.SERVER, 'msg');
    expect(entries[0].level).toBe(expectedLevel);
  });
});

// ── Level filtering ──────────────────────────────────────────────────────────

describe('Level filtering', () => {
  it('filters entries below the configured minimum level', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.WARN, sink });
    logger.debug(LogCategory.LOOP, 'd');
    logger.info(LogCategory.LOOP, 'i');
    expect(entries).toHaveLength(0);
  });

  it('emits entries at the configured minimum level', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.WARN, sink });
    logger.warn(LogCategory.ERROR, 'w');
    expect(entries).toHaveLength(1);
  });

  it('emits entries above the configured minimum level', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.WARN, sink });
    logger.error(LogCategory.ERROR, 'e');
    expect(entries).toHaveLength(1);
  });
});

// ── Performance timer ────────────────────────────────────────────────────────

describe('startTimer / end', () => {
  it('returns a timer with an end method', () => {
    const { sink } = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sink });
    const timer = logger.startTimer();
    expect(typeof timer.end).toBe('function');
  });

  it('logs an entry with elapsedMs on end()', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sink });
    const timer = logger.startTimer();
    timer.end(LogCategory.PERF, 'dispatch_done', { gameId: 'g3' });
    const e = entries[0];
    expect(e.category).toBe(LogCategory.PERF);
    expect(e.message).toBe('dispatch_done');
    expect(typeof e.elapsedMs).toBe('number');
    expect(e.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(e.gameId).toBe('g3');
  });

  it('timer elapsedMs increases over time', async () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sink });
    const timer = logger.startTimer();
    await new Promise((r) => setTimeout(r, 20));
    timer.end(LogCategory.PERF, 'slow_op');
    expect(entries[0].elapsedMs).toBeGreaterThanOrEqual(15);
  });

  it('end() is filtered by minimum level (emits at debug)', () => {
    // timer.end logs at debug; a logger at info level should suppress it
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.INFO, sink });
    const timer = logger.startTimer();
    timer.end(LogCategory.PERF, 'should be suppressed');
    expect(entries).toHaveLength(0);
  });
});

// ── Custom sink ──────────────────────────────────────────────────────────────

describe('Custom sink', () => {
  it('routes all emitted entries through the provided sink', () => {
    const custom = vi.fn();
    const logger = new Logger({ level: LogLevel.DEBUG, sink: custom });
    logger.info(LogCategory.SERVER, 'hello');
    expect(custom).toHaveBeenCalledOnce();
    expect(custom.mock.calls[0][0].message).toBe('hello');
  });
});

// ── nullLogger ───────────────────────────────────────────────────────────────

describe('nullLogger', () => {
  it('exposes all Logger public methods', () => {
    expect(typeof nullLogger.debug).toBe('function');
    expect(typeof nullLogger.info).toBe('function');
    expect(typeof nullLogger.warn).toBe('function');
    expect(typeof nullLogger.error).toBe('function');
    expect(typeof nullLogger.startTimer).toBe('function');
  });

  it('does not throw when called', () => {
    expect(() => nullLogger.debug(LogCategory.LOOP, 'x')).not.toThrow();
    expect(() => nullLogger.info(LogCategory.SERVER, 'x')).not.toThrow();
    expect(() => nullLogger.warn(LogCategory.ERROR, 'x')).not.toThrow();
    expect(() => nullLogger.error(LogCategory.PERF, 'x')).not.toThrow();
  });

  it('startTimer().end() does not throw', () => {
    const timer = nullLogger.startTimer();
    expect(() => timer.end(LogCategory.PERF, 'noop')).not.toThrow();
  });
});

// ── Loop/Phase/Error scenario integration ────────────────────────────────────

describe('Scenario — loop tick and phase change logging', () => {
  it('captures a tick log and a phase change log in order', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sink });

    logger.debug(LogCategory.LOOP, 'tick', { gameId: 'g1', phase: 'hiding', iteration: 42 });
    logger.info(LogCategory.LOOP, 'phase_change', { gameId: 'g1', oldPhase: 'hiding', newPhase: 'seeking' });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: 'debug', message: 'tick', gameId: 'g1', iteration: 42 });
    expect(entries[1]).toMatchObject({ level: 'info', message: 'phase_change', oldPhase: 'hiding', newPhase: 'seeking' });
  });
});

describe('Scenario — task error logging', () => {
  it('captures task error with name and error info', () => {
    const { sink, entries } = makeSink();
    const logger = new Logger({ sink });

    const err = new Error('zone calc failed');
    logger.error(LogCategory.ERROR, 'task_error', {
      gameId: 'g2',
      taskName: 'zoneCalc',
      errorMessage: err.message,
    });

    expect(entries[0]).toMatchObject({
      level: 'error',
      category: 'error',
      message: 'task_error',
      taskName: 'zoneCalc',
      errorMessage: 'zone calc failed',
    });
  });
});
