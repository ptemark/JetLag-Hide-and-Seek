// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GameStateManager } from './gameState.js';

describe('GameStateManager', () => {
  let gsm;

  beforeEach(() => {
    gsm = new GameStateManager();
  });

  // -------------------------------------------------------------------------
  // Game lifecycle
  // -------------------------------------------------------------------------

  it('starts with zero active games', () => {
    expect(gsm.getActiveGameCount()).toBe(0);
  });

  it('creates a game with default waiting status', () => {
    gsm.createGame('g1');
    expect(gsm.hasGame('g1')).toBe(true);
    expect(gsm.getGameState('g1').status).toBe('waiting');
  });

  it('creates a game with custom status', () => {
    gsm.createGame('g1', { status: 'hiding' });
    expect(gsm.getGameState('g1').status).toBe('hiding');
  });

  it('ignores duplicate createGame calls', () => {
    gsm.createGame('g1');
    gsm.addPlayerToGame('g1', 'p1');
    gsm.createGame('g1'); // should not wipe players
    expect(gsm.getGameState('g1').players).toHaveProperty('p1');
  });

  it('removes a game', () => {
    gsm.createGame('g1');
    gsm.removeGame('g1');
    expect(gsm.hasGame('g1')).toBe(false);
    expect(gsm.getGameState('g1')).toBeNull();
  });

  it('returns null state for unknown game', () => {
    expect(gsm.getGameState('unknown')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Player management
  // -------------------------------------------------------------------------

  it('adds a player to a game (auto-creates game)', () => {
    gsm.addPlayerToGame('g1', 'p1', 'seeker');
    const state = gsm.getGameState('g1');
    expect(state.players['p1']).toEqual({ lat: null, lon: null, role: 'seeker', team: null, onTransit: false, previousLocation: null });
  });

  it('defaults role to hider', () => {
    gsm.addPlayerToGame('g1', 'p1');
    expect(gsm.getGameState('g1').players['p1'].role).toBe('hider');
  });

  it('does not overwrite an existing player on re-add', () => {
    gsm.addPlayerToGame('g1', 'p1');
    gsm.updatePlayerLocation('g1', 'p1', 10, 20);
    gsm.addPlayerToGame('g1', 'p1', 'seeker'); // already exists — no change
    const state = gsm.getGameState('g1');
    expect(state.players['p1'].lat).toBe(10);
    expect(state.players['p1'].role).toBe('hider');
  });

  it('removes a player from a game', () => {
    gsm.addPlayerToGame('g1', 'p1', 'hider');
    gsm.addPlayerToGame('g1', 'p2', 'seeker');
    gsm.removePlayerFromGame('g1', 'p1');
    const state = gsm.getGameState('g1');
    expect(state.players).not.toHaveProperty('p1');
    expect(state.players).toHaveProperty('p2');
  });

  it('auto-removes empty game when last player leaves', () => {
    gsm.addPlayerToGame('g1', 'p1');
    gsm.removePlayerFromGame('g1', 'p1');
    expect(gsm.hasGame('g1')).toBe(false);
  });

  it('ignores removePlayerFromGame for unknown game', () => {
    expect(() => gsm.removePlayerFromGame('unknown', 'p1')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Transit state
  // -------------------------------------------------------------------------

  it('initialises player onTransit to false', () => {
    gsm.addPlayerToGame('g1', 'p1', 'seeker');
    expect(gsm.getPlayerTransit('g1', 'p1')).toBe(false);
  });

  it('sets player transit status to true', () => {
    gsm.addPlayerToGame('g1', 'p1', 'seeker');
    const ok = gsm.setPlayerTransit('g1', 'p1', true);
    expect(ok).toBe(true);
    expect(gsm.getPlayerTransit('g1', 'p1')).toBe(true);
  });

  it('sets player transit status back to false', () => {
    gsm.addPlayerToGame('g1', 'p1', 'seeker');
    gsm.setPlayerTransit('g1', 'p1', true);
    gsm.setPlayerTransit('g1', 'p1', false);
    expect(gsm.getPlayerTransit('g1', 'p1')).toBe(false);
  });

  it('returns false from setPlayerTransit for unknown game', () => {
    expect(gsm.setPlayerTransit('unknown', 'p1', true)).toBe(false);
  });

  it('returns false from setPlayerTransit for unknown player', () => {
    gsm.createGame('g1');
    expect(gsm.setPlayerTransit('g1', 'unknown', true)).toBe(false);
  });

  it('returns false from getPlayerTransit for unknown game', () => {
    expect(gsm.getPlayerTransit('unknown', 'p1')).toBe(false);
  });

  it('getGameState snapshot includes onTransit field', () => {
    gsm.addPlayerToGame('g1', 'p1', 'seeker');
    gsm.setPlayerTransit('g1', 'p1', true);
    const state = gsm.getGameState('g1');
    expect(state.players['p1'].onTransit).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Location updates
  // -------------------------------------------------------------------------

  it('updates player location', () => {
    gsm.addPlayerToGame('g1', 'p1');
    const ok = gsm.updatePlayerLocation('g1', 'p1', 51.5, -0.12);
    expect(ok).toBe(true);
    const { lat, lon } = gsm.getGameState('g1').players['p1'];
    expect(lat).toBe(51.5);
    expect(lon).toBe(-0.12);
  });

  it('returns false when updating location for unknown game', () => {
    expect(gsm.updatePlayerLocation('unknown', 'p1', 0, 0)).toBe(false);
  });

  it('returns false when updating location for unknown player', () => {
    gsm.createGame('g1');
    expect(gsm.updatePlayerLocation('g1', 'unknown', 0, 0)).toBe(false);
  });

  it('saves previousLocation as null on first location update', () => {
    gsm.addPlayerToGame('g1', 'p1');
    gsm.updatePlayerLocation('g1', 'p1', 51.5, -0.1);
    expect(gsm.getPreviousPlayerLocation('g1', 'p1')).toBeNull();
  });

  it('saves previousLocation on second location update', () => {
    gsm.addPlayerToGame('g1', 'p1');
    gsm.updatePlayerLocation('g1', 'p1', 51.5, -0.1);
    gsm.updatePlayerLocation('g1', 'p1', 51.6, -0.2);
    const prev = gsm.getPreviousPlayerLocation('g1', 'p1');
    expect(prev).toEqual({ lat: 51.5, lon: -0.1 });
  });

  it('getPreviousPlayerLocation returns null for unknown game', () => {
    expect(gsm.getPreviousPlayerLocation('no-game', 'p1')).toBeNull();
  });

  it('getPreviousPlayerLocation returns null for unknown player', () => {
    gsm.createGame('g1');
    expect(gsm.getPreviousPlayerLocation('g1', 'no-player')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Game status
  // -------------------------------------------------------------------------

  it('sets game status', () => {
    gsm.createGame('g1');
    const ok = gsm.setGameStatus('g1', 'seeking');
    expect(ok).toBe(true);
    expect(gsm.getGameState('g1').status).toBe('seeking');
  });

  it('returns false when setting status for unknown game', () => {
    expect(gsm.setGameStatus('unknown', 'seeking')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getGameState snapshot isolation
  // -------------------------------------------------------------------------

  it('returns a snapshot copy of player data', () => {
    gsm.addPlayerToGame('g1', 'p1');
    const state = gsm.getGameState('g1');
    state.players['p1'].lat = 999; // mutate snapshot
    expect(gsm.getGameState('g1').players['p1'].lat).toBeNull(); // original unchanged
  });

  // -------------------------------------------------------------------------
  // Active game count
  // -------------------------------------------------------------------------

  it('tracks active game count across multiple games', () => {
    gsm.createGame('g1');
    gsm.createGame('g2');
    expect(gsm.getActiveGameCount()).toBe(2);
    gsm.removeGame('g1');
    expect(gsm.getActiveGameCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // End Game active flag
  // -------------------------------------------------------------------------

  it('isEndGameActive returns false by default', () => {
    gsm.createGame('g1');
    expect(gsm.isEndGameActive('g1')).toBe(false);
  });

  it('setEndGameActive sets and clears the End Game flag', () => {
    gsm.createGame('g1');
    expect(gsm.setEndGameActive('g1', true)).toBe(true);
    expect(gsm.isEndGameActive('g1')).toBe(true);
    gsm.setEndGameActive('g1', false);
    expect(gsm.isEndGameActive('g1')).toBe(false);
  });

  it('setEndGameActive returns false for unknown game', () => {
    expect(gsm.setEndGameActive('unknown', true)).toBe(false);
  });

  it('isEndGameActive returns false for unknown game', () => {
    expect(gsm.isEndGameActive('unknown')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getPlayerRole
  // -------------------------------------------------------------------------

  it('getPlayerRole returns role for a known player', () => {
    gsm.addPlayerToGame('g1', 'p1', 'hider');
    gsm.addPlayerToGame('g1', 'p2', 'seeker');
    expect(gsm.getPlayerRole('g1', 'p1')).toBe('hider');
    expect(gsm.getPlayerRole('g1', 'p2')).toBe('seeker');
  });

  it('getPlayerRole returns null for unknown game', () => {
    expect(gsm.getPlayerRole('unknown', 'p1')).toBeNull();
  });

  it('getPlayerRole returns null for unknown player in known game', () => {
    gsm.createGame('g1');
    expect(gsm.getPlayerRole('g1', 'ghost')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // getHiderId
  // -------------------------------------------------------------------------

  it('getHiderId returns null when no hider has joined', () => {
    gsm.createGame('g1');
    expect(gsm.getHiderId('g1')).toBeNull();
  });

  it('getHiderId returns null for unknown game', () => {
    expect(gsm.getHiderId('unknown')).toBeNull();
  });

  it('getHiderId returns the hider playerId once a hider joins', () => {
    gsm.addPlayerToGame('g1', 'p1', 'hider');
    gsm.addPlayerToGame('g1', 'p2', 'seeker');
    expect(gsm.getHiderId('g1')).toBe('p1');
  });

  // -------------------------------------------------------------------------
  // Single-hider enforcement in addPlayerToGame
  // -------------------------------------------------------------------------

  it('throws HIDER_SLOT_TAKEN when a second different player tries to join as hider', () => {
    gsm.addPlayerToGame('g1', 'p1', 'hider');
    expect(() => gsm.addPlayerToGame('g1', 'p2', 'hider')).toThrow('HIDER_SLOT_TAKEN');
  });

  it('does not throw when the same hider player rejoins as hider (idempotent)', () => {
    gsm.addPlayerToGame('g1', 'p1', 'hider');
    expect(() => gsm.addPlayerToGame('g1', 'p1', 'hider')).not.toThrow();
  });

  it('allows unlimited seekers to join even when a hider exists', () => {
    gsm.addPlayerToGame('g1', 'p1', 'hider');
    expect(() => {
      gsm.addPlayerToGame('g1', 'p2', 'seeker');
      gsm.addPlayerToGame('g1', 'p3', 'seeker');
      gsm.addPlayerToGame('g1', 'p4', 'seeker');
    }).not.toThrow();
    expect(Object.keys(gsm.getGameState('g1').players)).toHaveLength(4);
  });
});
