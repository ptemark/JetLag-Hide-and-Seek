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
import { Logger, LogLevel } from './logger.js';
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

const server   = createServer({ logger });
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
