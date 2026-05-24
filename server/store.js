/**
 * store.js — DB-backed `store` adapter for the managed game server.
 *
 * The managed server's `createServer({ store })` parameter expects an object
 * whose methods take a single argument (not the pg Pool). This module wraps
 * the lower-level `db/gameStore.js` helpers (which take pool first) so the
 * server can stay pool-agnostic.
 *
 * Pre-Task 202, `server/start.js` never built a store, so every call to
 * `store.dbUpdateGameStatus` etc. silently no-op'd — including the phase
 * transition write that drives non-host players' lobby-poll exit. See
 * DESIGN.md §19a "Authority of games.status".
 */

import {
  dbUpdateGameStatus,
  dbSubmitScore,
  dbExpireStaleQuestions,
  dbGetGamePlayerCounts,
} from '../db/gameStore.js';

/**
 * Build a `store` object backed by the given pg pool.
 *
 * Every method returns a Promise. Method signatures match what
 * `server/index.js` already calls — `store.dbUpdateGameStatus({ gameId,
 * status })`, `store.dbSubmitScore({ ... })`, etc. — so wiring this in is
 * purely additive.
 *
 * @param {import('pg').Pool} pool
 * @returns {{
 *   dbUpdateGameStatus: (args: { gameId: string, status: string }) => Promise<unknown>,
 *   dbSubmitScore: (args: object) => Promise<unknown>,
 *   dbExpireStaleQuestions: (args: { gameId: string }) => Promise<unknown>,
 *   dbGetGamePlayerCounts: (args: { gameId: string }) => Promise<{ hiderCount: number, seekerCount: number }>,
 * }}
 */
export function createStore(pool) {
  if (!pool) throw new Error('createStore: pool is required');
  return {
    dbUpdateGameStatus:     (args)            => dbUpdateGameStatus(pool, args),
    dbSubmitScore:          (args)            => dbSubmitScore(pool, args),
    dbExpireStaleQuestions: ({ gameId })      => dbExpireStaleQuestions(pool, gameId),
    dbGetGamePlayerCounts:  ({ gameId })      => dbGetGamePlayerCounts(pool, gameId),
  };
}
