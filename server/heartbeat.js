/**
 * HeartbeatManager — keeps WebSocket connections alive and detects stale clients.
 *
 * Uses the native WebSocket ping/pong protocol (not application-level messages):
 *  - On each tick, clients that haven't responded to the previous ping are terminated.
 *  - Surviving clients are marked as awaiting a pong, then pinged.
 *  - A pong response (handled via ws 'pong' event) resets the client's liveness flag.
 *
 * Usage:
 *   const hbm = new HeartbeatManager(wss, { interval: 30_000 });
 *   hbm.track(ws);   // call for every new connection
 *   hbm.start();
 *   // ...
 *   hbm.stop();
 */
export class HeartbeatManager {
  /**
   * @param {import('ws').WebSocketServer} wss
   * @param {{ interval?: number }} options
   *   interval — ms between heartbeat ticks (default 30 000)
   */
  constructor(wss, { interval = 30_000 } = {}) {
    this.wss = wss;
    this.interval = interval;
    this._timer = null;
  }

  /** Begin periodic heartbeat ticks. Idempotent. */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this.interval);
  }

  /** Stop periodic ticks. */
  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /**
   * Register a newly connected WebSocket for heartbeat tracking.
   * Must be called once per connection before the first tick fires.
   * @param {import('ws').WebSocket} ws
   */
  track(ws) {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }

  _tick() {
    for (const ws of this.wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }
}
