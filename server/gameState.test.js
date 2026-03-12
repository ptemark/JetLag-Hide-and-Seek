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
    expect(state.players['p1']).toEqual({ lat: null, lon: null, role: 'seeker', team: null, onTransit: false });
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
    gsm.addPlayerToGame('g1', 'p1');
    gsm.addPlayerToGame('g1', 'p2');
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
});
