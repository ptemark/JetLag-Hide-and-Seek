/**
 * Managed game-server entrypoint.
 *
 * Reads PORT from the environment (default 3002) and starts the HTTP +
 * WebSocket server.  This file is the CMD target for the Docker container.
 *
 * Shutdown paths:
 *  • Idle: when the last game ends the server waits IDLE_SHUTDOWN_DELAY_MS
 *    (default 0) then exits.  If a new game starts within the grace period the
 *    countdown is cancelled so the container stays alive.
 *  • Signal: SIGTERM / SIGINT are caught for graceful container stop.
 */
import { createServer } from './index.js';
import { createStore } from './store.js';
import { createPool, createTables } from '../db/db.js';
import { Logger, LogLevel, LogCategory } from './logger.js';
import { ShutdownManager } from './shutdown.js';

const PORT                  = parseInt(process.env.PORT                  ?? '3002', 10);
const LOG_LEVEL             = (process.env.LOG_LEVEL                     ?? 'info').toLowerCase();
const IDLE_SHUTDOWN_DELAY_MS = parseInt(process.env.IDLE_SHUTDOWN_DELAY_MS ?? '0',    10);

const levelMap = {
  debug: LogLevel.DEBUG,
  info:  LogLevel.INFO,
  warn:  LogLevel.WARN,
  error: LogLevel.ERROR,
};
const level  = levelMap[LOG_LEVEL] ?? LogLevel.INFO;
const logger = new Logger({ level });

// Wire a DB-backed store when DATABASE_URL is available so the managed server
// can: (a) write phase transitions to Postgres (Task 191 — non-host lobby exit
// depends on this; without the store wired the write silently no-ops, leaving
// every non-host player stuck on "waiting" forever), (b) validate hider/seeker
// counts via the same source the serverless `handleStartGame` uses, and
// (c) persist scores + expire stale questions on tick.
// See DESIGN.md §19a "Authority of games.status".
let store = null;
if (process.env.DATABASE_URL) {
  const pool = createPool(process.env.DATABASE_URL);
  createTables(pool).catch((err) => {
    // Migration races are recoverable — the next query that needs the table
    // will either succeed (table created by a parallel cold start) or surface
    // a real 500. Log and continue so the WS server still boots.
    logger.error(LogCategory.LOOP, 'managed_server_db_init_failed', { error: err?.message });
  });
  store = createStore(pool);
}

// Make store-wiring status loud at boot so an operator scanning startup logs
// can immediately diagnose "non-host stuck on waiting" — the symptom of a
// missing DATABASE_URL in the managed server's runtime env. See DESIGN.md
// §19a "Managed server must be wired with a DB-backed store".
logger.info(
  LogCategory.LOOP,
  store ? 'managed_server_store_wired' : 'managed_server_store_unwired',
  { databaseUrlPresent: !!process.env.DATABASE_URL },
);

const server   = createServer({ logger, store });
const shutdown = new ShutdownManager({
  stopFn:      () => server.stop(),
  idleDelayMs: IDLE_SHUTDOWN_DELAY_MS,
  logger,
});

shutdown.watchSignals();

server.onIdle(()   => shutdown.onIdle());
server.onActive(() => shutdown.onActive());

server.start(PORT).then(() => {
  process.stdout.write(
    JSON.stringify({ event: 'server_ready', port: PORT }) + '\n',
  );
});
