// @vitest-environment node
/**
 * Task 28 — Integration tests: multiple players connecting, updating state,
 * and disconnecting against a real HTTP + WebSocket server instance.
 *
 * Each describe block spins up a fresh server on an OS-assigned port and tears
 * it down after all tests in that block complete.
 *
 * Scenarios:
 *  1. Player connection handshake — server sends 'connected' on join
 *  2. Multi-player game join — all players receive joined_game / player_joined
 *  3. Location updates — broadcast to every member of the game
 *  4. State request via WebSocket — server returns current game_state
 *  5. State request via HTTP  — GET /internal/state/:gameId returns JSON
 *  6. Player disconnect — remaining players receive player_left
 *  7. Disconnect cleanup — server tracks correct connected count
 *  8. Broadcast isolation — messages stay within the target game
 *  9. Admin HTTP endpoint — reflects connected players and active games
 * 10. Full lifecycle — hide-and-seek round: join → update → leave
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from './index.js';
import { LogLevel, Logger } from './logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Silent logger — keeps test output clean. */
function silentLogger() {
  return new Logger({ level: LogLevel.ERROR });
}

/** Resolve the OS-assigned port after httpServer.listen(0). */
function getPort(server) {
  return server.httpServer.address().port;
}

/**
 * Open a WebSocket with a built-in message buffer so that messages arriving
 * before collectMessages() is called are not lost.
 *
 * Returns a ws client with two extra properties:
 *   ws._buf   — Array of all parsed messages received so far
 *   ws._subs  — Internal list of active collectMessages waiters
 */
function connect(port, playerId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://localhost:${port}?playerId=${encodeURIComponent(playerId)}`,
    );

    ws._buf = [];
    ws._subs = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      ws._buf.push(msg);

      // Notify any active waiters.
      for (let i = ws._subs.length - 1; i >= 0; i--) {
        const sub = ws._subs[i];
        if (sub.predicate(msg)) {
          sub.collected.push(msg);
          if (sub.collected.length >= sub.count) {
            ws._subs.splice(i, 1);
            clearTimeout(sub.timer);
            sub.resolve([...sub.collected]);
          }
        }
      }
    });

    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/**
 * Wait for `count` messages matching `predicate` on a buffered ws client.
 * Messages already in ws._buf are checked first.
 */
function collectMessages(ws, count, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    // Drain matching messages from the buffer first.
    const collected = ws._buf.filter(predicate).slice(0, count);

    if (collected.length >= count) {
      resolve(collected);
      return;
    }

    const sub = {
      count,
      predicate,
      collected,
      resolve,
      timer: setTimeout(() => {
        const idx = ws._subs.indexOf(sub);
        if (idx !== -1) ws._subs.splice(idx, 1);
        reject(
          new Error(
            `Timeout: expected ${count} message(s), got ${sub.collected.length}`,
          ),
        );
      }, timeoutMs),
    };

    ws._subs.push(sub);
  });
}

/** Send a JSON message over a WebSocket. */
function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

/** Close ws and wait for the close event. */
function closeAndWait(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.once('close', resolve);
    ws.close();
  });
}

/** Terminate all open sockets before stopping the server (avoids afterAll hang). */
async function stopServer(server) {
  // Force-close any lingering clients so wss.close() resolves immediately.
  for (const client of server.wss.clients) {
    client.terminate();
  }
  await server.stop();
}

// ---------------------------------------------------------------------------
// 1. Connection handshake
// ---------------------------------------------------------------------------

describe('Integration — connection handshake', () => {
  let server;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('server sends connected message with the correct playerId', async () => {
    const port = getPort(server);
    const ws = await connect(port, 'player-handshake');
    const [msg] = await collectMessages(ws, 1, (m) => m.type === 'connected');

    expect(msg.type).toBe('connected');
    expect(msg.playerId).toBe('player-handshake');

    await closeAndWait(ws);
  });

  it('two players connecting receive independent connected confirmations', async () => {
    const port = getPort(server);
    const [ws1, ws2] = await Promise.all([
      connect(port, 'p-alpha'),
      connect(port, 'p-beta'),
    ]);

    const [[m1], [m2]] = await Promise.all([
      collectMessages(ws1, 1, (m) => m.type === 'connected'),
      collectMessages(ws2, 1, (m) => m.type === 'connected'),
    ]);

    expect(m1.playerId).toBe('p-alpha');
    expect(m2.playerId).toBe('p-beta');

    await Promise.all([closeAndWait(ws1), closeAndWait(ws2)]);
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-player game join
// ---------------------------------------------------------------------------

describe('Integration — multi-player game join', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('first player joining a game receives joined_game confirmation', async () => {
    const ws = await connect(port, 'join-p1');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    send(ws, { type: 'join_game', gameId: 'game-join-1', role: 'hider' });
    const [msg] = await collectMessages(ws, 1, (m) => m.type === 'joined_game');

    expect(msg.gameId).toBe('game-join-1');
    expect(msg.role).toBe('hider');
    expect(msg.playerId).toBe('join-p1');

    await closeAndWait(ws);
  });

  it('second player joining notifies the first with player_joined', async () => {
    const [ws1, ws2] = await Promise.all([
      connect(port, 'join-first'),
      connect(port, 'join-second'),
    ]);
    await Promise.all([
      collectMessages(ws1, 1, (m) => m.type === 'connected'),
      collectMessages(ws2, 1, (m) => m.type === 'connected'),
    ]);

    // p1 joins the game
    send(ws1, { type: 'join_game', gameId: 'game-notify', role: 'seeker' });
    await collectMessages(ws1, 1, (m) => m.type === 'joined_game');

    // p2 joins; p1 should receive player_joined
    const p1NotifyPending = collectMessages(ws1, 1, (m) => m.type === 'player_joined');
    send(ws2, { type: 'join_game', gameId: 'game-notify', role: 'hider' });
    const [[notify], [p2Joined]] = await Promise.all([
      p1NotifyPending,
      collectMessages(ws2, 1, (m) => m.type === 'joined_game'),
    ]);

    expect(notify.type).toBe('player_joined');
    expect(notify.playerId).toBe('join-second');
    expect(p2Joined.type).toBe('joined_game');

    await Promise.all([closeAndWait(ws1), closeAndWait(ws2)]);
  });

  it('three players can join the same game and are all tracked', async () => {
    const sockets = await Promise.all(
      ['t3-p1', 't3-p2', 't3-p3'].map((id) => connect(port, id)),
    );
    await Promise.all(sockets.map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    await Promise.all(
      sockets.map((ws) => {
        send(ws, { type: 'join_game', gameId: 'game-3-players', role: 'seeker' });
        return collectMessages(ws, 1, (m) => m.type === 'joined_game');
      }),
    );

    expect(server.wsHandler.getGamePlayerCount('game-3-players')).toBe(3);

    await Promise.all(sockets.map(closeAndWait));
  });
});

// ---------------------------------------------------------------------------
// 3. Location updates
// ---------------------------------------------------------------------------

describe('Integration — location updates', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('location update from one player is received by all players in the game', async () => {
    const sockets = await Promise.all(
      ['loc-p1', 'loc-p2', 'loc-p3'].map((id) => connect(port, id)),
    );
    await Promise.all(sockets.map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    // All join the same game
    await Promise.all(
      sockets.map((ws, i) => {
        send(ws, { type: 'join_game', gameId: 'loc-game', role: i === 0 ? 'hider' : 'seeker' });
        return collectMessages(ws, 1, (m) => m.type === 'joined_game');
      }),
    );

    // p1 broadcasts location; all three should receive it
    const pending = Promise.all(
      sockets.map((ws) =>
        collectMessages(ws, 1, (m) => m.type === 'location_update' && m.playerId === 'loc-p1'),
      ),
    );
    send(sockets[0], { type: 'location_update', gameId: 'loc-game', lat: 51.5, lon: -0.1 });
    const results = await pending;

    for (const [msg] of results) {
      expect(msg.lat).toBeCloseTo(51.5);
      expect(msg.lon).toBeCloseTo(-0.1);
      expect(msg.playerId).toBe('loc-p1');
    }

    await Promise.all(sockets.map(closeAndWait));
  });

  it('location update persists in game state', async () => {
    const ws = await connect(port, 'loc-state-p1');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    send(ws, { type: 'join_game', gameId: 'loc-state-game', role: 'hider' });
    await collectMessages(ws, 1, (m) => m.type === 'joined_game');

    send(ws, { type: 'location_update', gameId: 'loc-state-game', lat: 48.85, lon: 2.35 });
    await collectMessages(ws, 1, (m) => m.type === 'location_update');

    const state = server.gameStateManager.getGameState('loc-state-game');
    expect(state?.players['loc-state-p1']?.lat).toBeCloseTo(48.85);
    expect(state?.players['loc-state-p1']?.lon).toBeCloseTo(2.35);

    await closeAndWait(ws);
  });
});

// ---------------------------------------------------------------------------
// 4. State request via WebSocket
// ---------------------------------------------------------------------------

describe('Integration — WebSocket state request', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('request_state returns current game state with player data', async () => {
    const ws = await connect(port, 'state-p1');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    send(ws, { type: 'join_game', gameId: 'state-game-ws', role: 'hider' });
    await collectMessages(ws, 1, (m) => m.type === 'joined_game');

    send(ws, { type: 'request_state', gameId: 'state-game-ws' });
    const [msg] = await collectMessages(ws, 1, (m) => m.type === 'game_state');

    expect(msg.gameId).toBe('state-game-ws');
    expect(msg.state).not.toBeNull();
    expect(msg.state.players['state-p1']).toBeDefined();

    await closeAndWait(ws);
  });

  it('request_state for unknown game returns null state', async () => {
    const ws = await connect(port, 'state-p-unknown');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    send(ws, { type: 'request_state', gameId: 'nonexistent-game-999' });
    const [msg] = await collectMessages(ws, 1, (m) => m.type === 'game_state');

    expect(msg.state).toBeNull();

    await closeAndWait(ws);
  });
});

// ---------------------------------------------------------------------------
// 5. State request via HTTP
// ---------------------------------------------------------------------------

describe('Integration — HTTP /internal/state endpoint', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  async function httpGet(path) {
    const res = await fetch(`http://localhost:${port}${path}`);
    return { status: res.status, body: await res.json() };
  }

  it('GET /internal/state/:gameId returns 404 for unknown game', async () => {
    const { status } = await httpGet('/internal/state/does-not-exist');
    expect(status).toBe(404);
  });

  it('GET /internal/state/:gameId returns 200 with player data after join', async () => {
    const ws = await connect(port, 'http-state-p1');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    send(ws, { type: 'join_game', gameId: 'http-state-game', role: 'hider' });
    await collectMessages(ws, 1, (m) => m.type === 'joined_game');

    const { status, body } = await httpGet('/internal/state/http-state-game');
    expect(status).toBe(200);
    expect(body.gameId).toBe('http-state-game');
    expect(body.players['http-state-p1']).toBeDefined();

    await closeAndWait(ws);
  });

  it('state reflects location update via HTTP endpoint', async () => {
    const ws = await connect(port, 'http-loc-p1');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    send(ws, { type: 'join_game', gameId: 'http-loc-game', role: 'hider' });
    await collectMessages(ws, 1, (m) => m.type === 'joined_game');

    send(ws, { type: 'location_update', gameId: 'http-loc-game', lat: 40.71, lon: -74.0 });
    await collectMessages(ws, 1, (m) => m.type === 'location_update');

    const { body } = await httpGet('/internal/state/http-loc-game');
    expect(body.players['http-loc-p1'].lat).toBeCloseTo(40.71);
    expect(body.players['http-loc-p1'].lon).toBeCloseTo(-74.0);

    await closeAndWait(ws);
  });
});

// ---------------------------------------------------------------------------
// 6. Disconnect — player_left notification
// ---------------------------------------------------------------------------

describe('Integration — disconnect notifications', () => {
  let server, port;

  beforeAll(async () => {
    // Use a very short grace period so player_left arrives quickly in tests.
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, reconnectGraceMs: 100, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('remaining player receives player_left when a peer disconnects', async () => {
    const [ws1, ws2] = await Promise.all([
      connect(port, 'disc-p1'),
      connect(port, 'disc-p2'),
    ]);
    await Promise.all([ws1, ws2].map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    await Promise.all([ws1, ws2].map((ws, i) => {
      send(ws, { type: 'join_game', gameId: 'disc-game', role: i === 0 ? 'hider' : 'seeker' });
      return collectMessages(ws, 1, (m) => m.type === 'joined_game');
    }));

    // ws2 watches for player_left; ws1 disconnects
    const leftPending = collectMessages(ws2, 1, (m) => m.type === 'player_left');
    await closeAndWait(ws1);
    const [leftMsg] = await leftPending;

    expect(leftMsg.playerId).toBe('disc-p1');
    expect(leftMsg.gameId).toBe('disc-game');

    await closeAndWait(ws2);
  });

  it('three-player game: one disconnects, two others each receive player_left', async () => {
    const sockets = await Promise.all(
      ['disc3-p1', 'disc3-p2', 'disc3-p3'].map((id) => connect(port, id)),
    );
    await Promise.all(sockets.map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    await Promise.all(sockets.map((ws) => {
      send(ws, { type: 'join_game', gameId: 'disc3-game', role: 'seeker' });
      return collectMessages(ws, 1, (m) => m.type === 'joined_game');
    }));

    const leftPending = Promise.all(
      [sockets[1], sockets[2]].map((ws) =>
        collectMessages(ws, 1, (m) => m.type === 'player_left' && m.playerId === 'disc3-p1'),
      ),
    );
    await closeAndWait(sockets[0]);
    await leftPending;

    expect(server.wsHandler.getGamePlayerCount('disc3-game')).toBe(2);

    await Promise.all([closeAndWait(sockets[1]), closeAndWait(sockets[2])]);
  });
});

// ---------------------------------------------------------------------------
// 7. Connected count tracking
// ---------------------------------------------------------------------------

describe('Integration — connected player count', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('count rises with each connection and falls with each disconnect', async () => {
    const before = server.wsHandler.getConnectedCount();

    const [ws1, ws2] = await Promise.all([
      connect(port, 'cnt-p1'),
      connect(port, 'cnt-p2'),
    ]);
    await Promise.all([ws1, ws2].map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    expect(server.wsHandler.getConnectedCount()).toBe(before + 2);

    await closeAndWait(ws1);
    // Allow server to process close event
    await new Promise((r) => setTimeout(r, 50));
    expect(server.wsHandler.getConnectedCount()).toBe(before + 1);

    await closeAndWait(ws2);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.wsHandler.getConnectedCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 8. Broadcast isolation between games
// ---------------------------------------------------------------------------

describe('Integration — broadcast isolation', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('location update in game-A does not reach players in game-B', async () => {
    const [wsA, wsB] = await Promise.all([
      connect(port, 'iso-pA'),
      connect(port, 'iso-pB'),
    ]);
    await Promise.all([wsA, wsB].map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    await Promise.all([
      (async () => {
        send(wsA, { type: 'join_game', gameId: 'iso-game-A', role: 'hider' });
        await collectMessages(wsA, 1, (m) => m.type === 'joined_game');
      })(),
      (async () => {
        send(wsB, { type: 'join_game', gameId: 'iso-game-B', role: 'seeker' });
        await collectMessages(wsB, 1, (m) => m.type === 'joined_game');
      })(),
    ]);

    // wsA sends location update in game-A
    const locPending = collectMessages(wsA, 1, (m) => m.type === 'location_update');
    send(wsA, { type: 'location_update', gameId: 'iso-game-A', lat: 1, lon: 2 });
    await locPending;

    // Small pause — any errant messages to wsB would have arrived by now
    await new Promise((r) => setTimeout(r, 100));
    const strayLocMsgs = wsB._buf.filter((m) => m.type === 'location_update');
    expect(strayLocMsgs).toHaveLength(0);

    await Promise.all([closeAndWait(wsA), closeAndWait(wsB)]);
  });
});

// ---------------------------------------------------------------------------
// 9. Admin HTTP endpoint
// ---------------------------------------------------------------------------

describe('Integration — HTTP /internal/admin endpoint', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  async function httpGet(path) {
    const res = await fetch(`http://localhost:${port}${path}`);
    return res.json();
  }

  it('admin endpoint reports connected players and uptime', async () => {
    const ws = await connect(port, 'admin-p1');
    await collectMessages(ws, 1, (m) => m.type === 'connected');

    const admin = await httpGet('/internal/admin');

    expect(admin.connectedPlayers).toBeGreaterThanOrEqual(1);
    expect(typeof admin.uptimeMs).toBe('number');
    expect(admin.uptimeMs).toBeGreaterThan(0);

    await closeAndWait(ws);
  });

  it('admin endpoint includes metrics in response', async () => {
    const admin = await httpGet('/internal/admin');

    expect(admin.metrics).toBeDefined();
    expect(typeof admin.metrics.loopIterationsPerMinute).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 10. Full lifecycle — join → update → leave
// ---------------------------------------------------------------------------

describe('Integration — full hide-and-seek lifecycle', () => {
  let server, port;

  beforeAll(async () => {
    server = createServer({ tickInterval: 5000, heartbeatInterval: 60_000, logger: silentLogger() });
    await server.start(0);
    port = getPort(server);
  }, 15_000);

  afterAll(() => stopServer(server), 15_000);

  it('hider and seeker: join, locate, request state, explicit leave', async () => {
    const [hider, seeker] = await Promise.all([
      connect(port, 'lc-hider'),
      connect(port, 'lc-seeker'),
    ]);
    await Promise.all([hider, seeker].map((ws) => collectMessages(ws, 1, (m) => m.type === 'connected')));

    // Both join the same game
    send(hider, { type: 'join_game', gameId: 'lifecycle-game', role: 'hider' });
    send(seeker, { type: 'join_game', gameId: 'lifecycle-game', role: 'seeker' });
    const [[hJoin], [sJoin]] = await Promise.all([
      collectMessages(hider, 1, (m) => m.type === 'joined_game'),
      collectMessages(seeker, 1, (m) => m.type === 'joined_game'),
    ]);
    expect(hJoin.role).toBe('hider');
    expect(sJoin.role).toBe('seeker');

    // Hider sends location update; seeker receives it
    send(hider, { type: 'location_update', gameId: 'lifecycle-game', lat: 35.68, lon: 139.69 });
    const [locMsg] = await collectMessages(
      seeker,
      1,
      (m) => m.type === 'location_update' && m.playerId === 'lc-hider',
    );
    expect(locMsg.lat).toBeCloseTo(35.68);

    // Seeker requests game state
    send(seeker, { type: 'request_state', gameId: 'lifecycle-game' });
    const [stateMsg] = await collectMessages(seeker, 1, (m) => m.type === 'game_state');
    expect(stateMsg.state.players['lc-hider'].lat).toBeCloseTo(35.68);

    // Hider explicitly leaves; seeker is notified
    send(hider, { type: 'leave_game', gameId: 'lifecycle-game' });
    const [leftMsg] = await collectMessages(
      seeker,
      1,
      (m) => m.type === 'player_left' && m.playerId === 'lc-hider',
    );
    expect(leftMsg.playerId).toBe('lc-hider');

    expect(server.wsHandler.getGamePlayerCount('lifecycle-game')).toBe(1);

    await Promise.all([closeAndWait(hider), closeAndWait(seeker)]);
  });
});
