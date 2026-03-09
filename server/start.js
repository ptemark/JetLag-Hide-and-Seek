/**
 * Managed game-server entrypoint.
 *
 * Reads PORT from the environment (default 3002) and starts the HTTP +
 * WebSocket server.  This file is the CMD target for the Docker container;
 * the server shuts itself down when the last game finishes (onIdle hook).
 */
import { createServer } from './index.js';
import { Logger, LogLevel } from './logger.js';

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();

const levelMap = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};
const level = levelMap[LOG_LEVEL] ?? LogLevel.INFO;

const server = createServer({ logger: new Logger({ level }) });

server.onIdle(() => {
  // Graceful shutdown when the last game ends — keeps idle cost at $0.
  server.stop().then(() => process.exit(0));
});

server.start(PORT).then(() => {
  process.stdout.write(
    JSON.stringify({ event: 'server_ready', port: PORT }) + '\n',
  );
});
