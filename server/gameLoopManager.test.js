// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoopManager, GamePhase } from './gameLoopManager.js';
import { GameLoopManager as ReExport } from './gameLoopManager.js';
import { GameStateManager } from './gameState.js';

// ---------------------------------------------------------------------------
// GamePhase constants
// ---------------------------------------------------------------------------

describe('GamePhase', () => {
  it('exports all four phase constants', () => {
    expect(GamePhase.WAITING).toBe('waiting');
    expect(GamePhase.HIDING).toBe('hiding');
    expect(GamePhase.SEEKING).toBe('seeking');
    expect(GamePhase.FINISHED).toBe('finished');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(GamePhase)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — lifecycle
// ---------------------------------------------------------------------------

describe('GameLoopManager — lifecycle', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
  });

  afterEach(() => {
    // Clean up any lingering timers
    for (const gameId of [...mgr._games.keys()]) {
      mgr.stopGame(gameId);
    }
    vi.useRealTimers();
  });

  it('starts with no active games', () => {
    expect(mgr.getActiveGameCount()).toBe(0);
  });

  it('startGame registers a game in WAITING phase', () => {
    mgr.startGame('g1');
    expect(mgr.getPhase('g1')).toBe(GamePhase.WAITING);
    expect(mgr.getActiveGameCount()).toBe(1);
  });

  it('startGame is idempotent — calling twice does not duplicate', () => {
    mgr.startGame('g1');
    const entry = mgr._games.get('g1');
    mgr.startGame('g1');
    expect(mgr._games.get('g1')).toBe(entry); // same reference
    expect(mgr.getActiveGameCount()).toBe(1);
  });

  it('stopGame removes game and halts timer', () => {
    mgr.startGame('g1');
    mgr.stopGame('g1');
    expect(mgr.getPhase('g1')).toBeNull();
    expect(mgr.getActiveGameCount()).toBe(0);
  });

  it('stopGame on unknown gameId is a no-op', () => {
    expect(() => mgr.stopGame('nonexistent')).not.toThrow();
  });

  it('manages multiple games independently', () => {
    mgr.startGame('g1');
    mgr.startGame('g2');
    expect(mgr.getActiveGameCount()).toBe(2);
    mgr.stopGame('g1');
    expect(mgr.getActiveGameCount()).toBe(1);
    expect(mgr.getPhase('g2')).toBe(GamePhase.WAITING);
  });

  it('getPhase returns null for unregistered games', () => {
    expect(mgr.getPhase('unknown')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — manual phase transitions
// ---------------------------------------------------------------------------

describe('GameLoopManager — manual phase transitions', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
    mgr.startGame('g1');
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('beginHiding transitions from WAITING to HIDING', () => {
    mgr.beginHiding('g1');
    expect(mgr.getPhase('g1')).toBe(GamePhase.HIDING);
  });

  it('beginSeeking transitions to SEEKING', () => {
    mgr.beginHiding('g1');
    mgr.beginSeeking('g1');
    expect(mgr.getPhase('g1')).toBe(GamePhase.SEEKING);
  });

  it('finishGame transitions to FINISHED and removes game', () => {
    mgr.beginHiding('g1');
    mgr.beginSeeking('g1');
    mgr.finishGame('g1');
    expect(mgr.getPhase('g1')).toBeNull();
    expect(mgr.getActiveGameCount()).toBe(0);
  });

  it('same-phase transition is a no-op (no onPhaseChange call)', () => {
    const onChange = vi.fn();
    mgr.onPhaseChange = onChange;
    mgr.beginHiding('g1');
    onChange.mockClear();
    mgr.beginHiding('g1'); // already HIDING
    expect(onChange).not.toHaveBeenCalled();
  });

  it('transition on unknown gameId is a no-op', () => {
    expect(() => mgr.beginHiding('nonexistent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — onPhaseChange callback
// ---------------------------------------------------------------------------

describe('GameLoopManager — onPhaseChange callback', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('fires onPhaseChange with correct args on manual beginHiding', () => {
    const onChange = vi.fn();
    mgr.onPhaseChange = onChange;
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    expect(onChange).toHaveBeenCalledWith('g1', GamePhase.WAITING, GamePhase.HIDING);
  });

  it('fires onPhaseChange on beginSeeking', () => {
    const onChange = vi.fn();
    mgr.onPhaseChange = onChange;
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    onChange.mockClear();
    mgr.beginSeeking('g1');
    expect(onChange).toHaveBeenCalledWith('g1', GamePhase.HIDING, GamePhase.SEEKING);
  });

  it('fires onPhaseChange on finishGame', () => {
    const onChange = vi.fn();
    mgr.onPhaseChange = onChange;
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    mgr.beginSeeking('g1');
    onChange.mockClear();
    mgr.finishGame('g1');
    expect(onChange).toHaveBeenCalledWith('g1', GamePhase.SEEKING, GamePhase.FINISHED);
  });

  it('works without onPhaseChange set (no crash)', () => {
    mgr.startGame('g1');
    expect(() => mgr.beginHiding('g1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — onTick callback
// ---------------------------------------------------------------------------

describe('GameLoopManager — onTick callback', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('fires onTick each tick interval', () => {
    const onTick = vi.fn();
    mgr.onTick = onTick;
    mgr.startGame('g1');
    vi.advanceTimersByTime(350);
    // 3 ticks at 100 ms each (100, 200, 300)
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('passes gameId and current phase to onTick', () => {
    const onTick = vi.fn();
    mgr.onTick = onTick;
    mgr.startGame('g1');
    vi.advanceTimersByTime(100);
    expect(onTick).toHaveBeenCalledWith('g1', GamePhase.WAITING);
  });

  it('stops firing after stopGame', () => {
    const onTick = vi.fn();
    mgr.onTick = onTick;
    mgr.startGame('g1');
    vi.advanceTimersByTime(100);
    mgr.stopGame('g1');
    onTick.mockClear();
    vi.advanceTimersByTime(500);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('fires independently for each game', () => {
    const onTick = vi.fn();
    mgr.onTick = onTick;
    mgr.startGame('g1');
    mgr.startGame('g2');
    vi.advanceTimersByTime(100);
    const gameIds = onTick.mock.calls.map((c) => c[0]);
    expect(gameIds).toContain('g1');
    expect(gameIds).toContain('g2');
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — automatic phase progression
// ---------------------------------------------------------------------------

describe('GameLoopManager — automatic phase progression', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('auto-transitions HIDING → SEEKING after hidingDuration', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    vi.advanceTimersByTime(600); // past hidingDuration of 500 ms
    expect(mgr.getPhase('g1')).toBe(GamePhase.SEEKING);
  });

  it('auto-transitions SEEKING → FINISHED (removes game) after seekingDuration', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    vi.advanceTimersByTime(600); // → SEEKING
    vi.advanceTimersByTime(1100); // past seekingDuration of 1000 ms → FINISHED
    expect(mgr.getPhase('g1')).toBeNull(); // game removed
  });

  it('does not auto-advance WAITING phase regardless of time elapsed', () => {
    mgr.startGame('g1');
    vi.advanceTimersByTime(5000);
    expect(mgr.getPhase('g1')).toBe(GamePhase.WAITING);
  });

  it('fires onPhaseChange callbacks on auto-transition', () => {
    const onChange = vi.fn();
    mgr.onPhaseChange = onChange;
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    onChange.mockClear();
    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenCalledWith('g1', GamePhase.HIDING, GamePhase.SEEKING);
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — getPhaseElapsed
// ---------------------------------------------------------------------------

describe('GameLoopManager — getPhaseElapsed', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 5000, seekingDuration: 10_000 });
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('returns 0 for unknown game', () => {
    expect(mgr.getPhaseElapsed('unknown')).toBe(0);
  });

  it('tracks elapsed time within a phase', () => {
    mgr.startGame('g1');
    vi.advanceTimersByTime(300);
    expect(mgr.getPhaseElapsed('g1')).toBeGreaterThanOrEqual(300);
  });

  it('resets elapsed time after phase transition', () => {
    mgr.startGame('g1');
    vi.advanceTimersByTime(300);
    mgr.beginHiding('g1');
    expect(mgr.getPhaseElapsed('g1')).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — onActive / onIdle lifecycle hooks
// ---------------------------------------------------------------------------

describe('GameLoopManager — onActive / onIdle hooks', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('fires onActive when first game starts', () => {
    const onActive = vi.fn();
    mgr.onActive = onActive;
    mgr.startGame('g1');
    expect(onActive).toHaveBeenCalledTimes(1);
  });

  it('does not fire onActive for subsequent games while already active', () => {
    const onActive = vi.fn();
    mgr.onActive = onActive;
    mgr.startGame('g1');
    mgr.startGame('g2');
    expect(onActive).toHaveBeenCalledTimes(1);
  });

  it('fires onActive again after returning to idle', () => {
    const onActive = vi.fn();
    mgr.onActive = onActive;
    mgr.startGame('g1');
    mgr.stopGame('g1');
    mgr.startGame('g2');
    expect(onActive).toHaveBeenCalledTimes(2);
  });

  it('fires onIdle when last game is stopped', () => {
    const onIdle = vi.fn();
    mgr.onIdle = onIdle;
    mgr.startGame('g1');
    mgr.stopGame('g1');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not fire onIdle when a second game stops but others remain', () => {
    const onIdle = vi.fn();
    mgr.onIdle = onIdle;
    mgr.startGame('g1');
    mgr.startGame('g2');
    mgr.stopGame('g1');
    expect(onIdle).not.toHaveBeenCalled();
    mgr.stopGame('g2'); // cleanup
  });

  it('fires onIdle when last game finishes', () => {
    const onIdle = vi.fn();
    mgr.onIdle = onIdle;
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    mgr.beginSeeking('g1');
    mgr.finishGame('g1');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('fires onIdle when last game auto-finishes after seeking duration', () => {
    const onIdle = vi.fn();
    mgr.onIdle = onIdle;
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    vi.advanceTimersByTime(600); // → SEEKING
    vi.advanceTimersByTime(1100); // → FINISHED, game removed
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('works without onActive or onIdle set (no crash)', () => {
    expect(() => {
      mgr.startGame('g1');
      mgr.stopGame('g1');
    }).not.toThrow();
  });

  it('fires both onActive and onIdle in correct sequence across multiple cycles', () => {
    const calls = [];
    mgr.onActive = () => calls.push('active');
    mgr.onIdle = () => calls.push('idle');

    mgr.startGame('g1');
    mgr.stopGame('g1');
    mgr.startGame('g2');
    mgr.stopGame('g2');

    expect(calls).toEqual(['active', 'idle', 'active', 'idle']);
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — integration with GameStateManager
// ---------------------------------------------------------------------------

describe('GameLoopManager — integration with GameStateManager', () => {
  let mgr;
  let gsm;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
    gsm = new GameStateManager();

    mgr.onPhaseChange = (gameId, _oldPhase, newPhase) => {
      if (!gsm.hasGame(gameId)) gsm.createGame(gameId);
      gsm.setGameStatus(gameId, newPhase);
    };
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('updates GameStateManager status on manual beginHiding', () => {
    gsm.createGame('g1');
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    expect(gsm.getGameState('g1').status).toBe(GamePhase.HIDING);
  });

  it('updates GameStateManager on auto-transition HIDING → SEEKING', () => {
    gsm.createGame('g1');
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    vi.advanceTimersByTime(600);
    expect(gsm.getGameState('g1').status).toBe(GamePhase.SEEKING);
  });
});

// ---------------------------------------------------------------------------
// GameLoopManager — extendPhase / getPhaseExtension
// ---------------------------------------------------------------------------

describe('GameLoopManager — extendPhase / getPhaseExtension', () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new GameLoopManager({ tickInterval: 100, hidingDuration: 500, seekingDuration: 1000 });
  });

  afterEach(() => {
    for (const gameId of [...mgr._games.keys()]) mgr.stopGame(gameId);
    vi.useRealTimers();
  });

  it('getPhaseExtension returns 0 for unknown game', () => {
    expect(mgr.getPhaseExtension('nonexistent')).toBe(0);
  });

  it('getPhaseExtension returns 0 before any extension', () => {
    mgr.startGame('g1');
    expect(mgr.getPhaseExtension('g1')).toBe(0);
  });

  it('extendPhase accumulates extraMs', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    mgr.extendPhase('g1', 30_000);
    expect(mgr.getPhaseExtension('g1')).toBe(30_000);
  });

  it('extendPhase stacks multiple calls', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    mgr.extendPhase('g1', 10_000);
    mgr.extendPhase('g1', 20_000);
    expect(mgr.getPhaseExtension('g1')).toBe(30_000);
  });

  it('extendPhase is a no-op for unknown game', () => {
    expect(() => mgr.extendPhase('nonexistent', 10_000)).not.toThrow();
  });

  it('extendPhase ignores zero or negative extraMs', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    mgr.extendPhase('g1', 0);
    mgr.extendPhase('g1', -5000);
    expect(mgr.getPhaseExtension('g1')).toBe(0);
  });

  it('extension resets to 0 on phase transition', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    mgr.extendPhase('g1', 30_000);
    expect(mgr.getPhaseExtension('g1')).toBe(30_000);
    mgr.beginSeeking('g1');
    expect(mgr.getPhaseExtension('g1')).toBe(0);
  });

  it('extendPhase delays auto-transition from HIDING', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    // hidingDuration = 500 ms; add 300 ms extension → total 800 ms
    mgr.extendPhase('g1', 300);
    // At 600 ms (past original 500 ms duration) it should still be HIDING
    vi.advanceTimersByTime(600);
    expect(mgr.getPhase('g1')).toBe(GamePhase.HIDING);
    // At 900 ms it should have advanced
    vi.advanceTimersByTime(300);
    expect(mgr.getPhase('g1')).toBe(GamePhase.SEEKING);
  });

  it('extendPhase delays auto-transition from SEEKING', () => {
    mgr.startGame('g1');
    mgr.beginHiding('g1');
    vi.advanceTimersByTime(600); // → SEEKING (hidingDuration=500ms)
    // seekingDuration = 1000 ms; add 500 ms extension → total 1500 ms
    mgr.extendPhase('g1', 500);
    // At 1100 ms past SEEKING start it should still be SEEKING
    vi.advanceTimersByTime(1100);
    expect(mgr.getPhase('g1')).toBe(GamePhase.SEEKING);
    // At 1600 ms it should finish
    vi.advanceTimersByTime(500);
    expect(mgr.getPhase('g1')).toBeNull(); // game removed after finish
  });
});
