// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg before importing db.js so the test never needs a real Postgres server.
// ---------------------------------------------------------------------------
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  const Pool = vi.fn(() => ({ query: mockQuery, end: mockEnd }));
  return { default: { Pool } };
});

import { createPool, createTables, SCHEMA_SQL } from './db.js';
import pkg from 'pg';

const { Pool } = pkg;

// ---------------------------------------------------------------------------
// SCHEMA_SQL content
// ---------------------------------------------------------------------------

describe('SCHEMA_SQL', () => {
  it('is a non-empty string', () => {
    expect(typeof SCHEMA_SQL).toBe('string');
    expect(SCHEMA_SQL.length).toBeGreaterThan(0);
  });

  it('defines the players table', () => {
    expect(SCHEMA_SQL).toMatch(/CREATE TABLE IF NOT EXISTS players/);
  });

  it('defines the games table', () => {
    expect(SCHEMA_SQL).toMatch(/CREATE TABLE IF NOT EXISTS games/);
  });

  it('defines the game_players table', () => {
    expect(SCHEMA_SQL).toMatch(/CREATE TABLE IF NOT EXISTS game_players/);
  });

  it('defines the scores table', () => {
    expect(SCHEMA_SQL).toMatch(/CREATE TABLE IF NOT EXISTS scores/);
  });

  it('players table has id, name, and created_at columns', () => {
    const playersBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS players'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS players')) + 2
    );
    expect(playersBlock).toMatch(/\bid\b/);
    expect(playersBlock).toMatch(/\bname\b/);
    expect(playersBlock).toMatch(/\bcreated_at\b/);
  });

  it('games table has id, size, bounds, status, created_at, updated_at columns', () => {
    const gamesBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS games'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS games')) + 2
    );
    expect(gamesBlock).toMatch(/\bid\b/);
    expect(gamesBlock).toMatch(/\bsize\b/);
    expect(gamesBlock).toMatch(/\bbounds\b/);
    expect(gamesBlock).toMatch(/\bstatus\b/);
    expect(gamesBlock).toMatch(/\bcreated_at\b/);
    expect(gamesBlock).toMatch(/\bupdated_at\b/);
  });

  it('games status column constrains valid values', () => {
    expect(SCHEMA_SQL).toMatch(/waiting.*hiding.*seeking.*finished/s);
  });

  it('games size column constrains valid values', () => {
    expect(SCHEMA_SQL).toMatch(/small.*medium.*large/s);
  });

  it('game_players table has game_id, player_id, and role columns', () => {
    const gpBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS game_players'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS game_players')) + 2
    );
    expect(gpBlock).toMatch(/\bgame_id\b/);
    expect(gpBlock).toMatch(/\bplayer_id\b/);
    expect(gpBlock).toMatch(/\brole\b/);
  });

  it('game_players role column constrains hider and seeker', () => {
    const gpBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS game_players'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS game_players')) + 2
    );
    expect(gpBlock).toMatch(/hider/);
    expect(gpBlock).toMatch(/seeker/);
  });

  it('game_players has a composite PRIMARY KEY', () => {
    const gpBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS game_players'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS game_players')) + 2
    );
    expect(gpBlock).toMatch(/PRIMARY KEY \(game_id, player_id\)/);
  });

  it('scores table has id, game_id, player_id, score_seconds, captured_at columns', () => {
    const scoresBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS scores'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS scores')) + 2
    );
    expect(scoresBlock).toMatch(/\bid\b/);
    expect(scoresBlock).toMatch(/\bgame_id\b/);
    expect(scoresBlock).toMatch(/\bplayer_id\b/);
    expect(scoresBlock).toMatch(/\bscore_seconds\b/);
    expect(scoresBlock).toMatch(/\bcaptured_at\b/);
  });

  it('scores table has a UNIQUE constraint on (game_id, player_id)', () => {
    const scoresBlock = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS scores'),
      SCHEMA_SQL.indexOf(');', SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS scores')) + 2
    );
    expect(scoresBlock).toMatch(/UNIQUE \(game_id, player_id\)/);
  });

  it('uses ON DELETE CASCADE for foreign key references', () => {
    expect(SCHEMA_SQL.match(/ON DELETE CASCADE/g).length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// createPool
// ---------------------------------------------------------------------------

describe('createPool', () => {
  beforeEach(() => {
    Pool.mockClear();
  });

  it('throws when called without a connection string', () => {
    expect(() => createPool('')).toThrow('connectionString is required');
    expect(() => createPool(undefined)).toThrow('connectionString is required');
  });

  it('creates a Pool with the provided connection string', () => {
    createPool('postgresql://user:pass@host/db');
    expect(Pool).toHaveBeenCalledTimes(1);
    const [config] = Pool.mock.calls[0];
    expect(config.connectionString).toBe('postgresql://user:pass@host/db');
  });

  it('enables SSL with rejectUnauthorized false', () => {
    createPool('postgresql://user:pass@host/db');
    const [config] = Pool.mock.calls[0];
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('returns the Pool instance', () => {
    const pool = createPool('postgresql://user:pass@host/db');
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// createTables
// ---------------------------------------------------------------------------

describe('createTables', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('calls pool.query exactly once', async () => {
    const pool = createPool('postgresql://user:pass@host/db');
    await createTables(pool);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('passes the full SCHEMA_SQL to pool.query', async () => {
    const pool = createPool('postgresql://user:pass@host/db');
    await createTables(pool);
    expect(mockQuery).toHaveBeenCalledWith(SCHEMA_SQL);
  });

  it('resolves without error on success', async () => {
    const pool = createPool('postgresql://user:pass@host/db');
    await expect(createTables(pool)).resolves.toBeUndefined();
  });

  it('propagates query errors to the caller', async () => {
    const pool = createPool('postgresql://user:pass@host/db');
    mockQuery.mockRejectedValue(new Error('connection refused'));
    await expect(createTables(pool)).rejects.toThrow('connection refused');
  });
});
