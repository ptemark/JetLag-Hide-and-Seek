# Architecture — JetLag: The Game

This document describes the hybrid architecture of JetLag: The Game, clarifying which
components are **serverless** (stateless, $0 idle) and which are **managed** (long-running,
on-demand, auto-shutdown).

---

## Component Overview

```
Client (Browser/Mobile)
    |  HTTPS REST            |  WebSocket (wss://)
    v                        v
Serverless Functions     Managed Game Server
  functions/               server/
  - players.js             - index.js      (HTTP + WS entrypoint)
  - games.js               - gameLoop.js   (tick loop, auto start/stop)
  - scores.js              - wsHandler.js  (connection & broadcast)
  - router.js (adapter)
    |
    v
Database (serverless Postgres — future Tasks 8-10)
    ^
    |
    (also read/written by Managed Game Server for persistent state)
```

---

## Serverless Tier (`functions/`)

**What it is:** Stateless HTTP handlers deployed as serverless functions
(e.g., AWS Lambda, Vercel Functions, Cloudflare Workers). Each invocation is
independent — no shared memory between calls.

**Idle cost:** $0. Functions only run when called.

### Endpoints

| Method | Path         | Handler               | Purpose                              |
|--------|--------------|-----------------------|--------------------------------------|
| POST   | /players     | `registerPlayer`      | Create a new player record           |
| GET    | /games/:id   | `getGame`             | Fetch game state by ID               |
| POST   | /scores      | `submitScore`         | Submit a player score                |

### Key files

| File                          | Role                                                     |
|-------------------------------|----------------------------------------------------------|
| `functions/players.js`        | Player registration logic and validation                 |
| `functions/games.js`          | Game lookup logic                                        |
| `functions/scores.js`         | Score submission logic                                   |
| `functions/router.js`         | HTTP adapter: parses `IncomingMessage`, routes to handler|

### Rules for serverless handlers
- Pure functions: `(req) => { status, body }` — no I/O side effects yet.
- No long-lived state; in-memory stores are placeholders until Tasks 8–10 wire up the DB.
- Each handler is independently testable without a running server.

---

## Managed Game Server (`server/`)

**What it is:** A persistent Node.js process hosting HTTP health-check and WebSocket
endpoints. It maintains real-time game state in memory and syncs to the DB at checkpoints.

**Lifecycle:** Starts on first player WebSocket connection; shuts down automatically when
the last player disconnects (`GameLoop.stop()` + server close).

**Idle cost:** $0 — the container is stopped when no players are active.

### Components

| File                  | Role                                                                     |
|-----------------------|--------------------------------------------------------------------------|
| `server/index.js`     | Creates HTTP + WebSocket server; wires `GameLoop` and `WsHandler`        |
| `server/gameLoop.js`  | Tick-based loop; auto-starts on `addPlayer`, auto-stops when empty       |
| `server/wsHandler.js` | Manages WebSocket connections, player registration, and broadcast         |

### GameLoop lifecycle

```
First player connects
  -> WsHandler.handleConnection()
  -> GameLoop.addPlayer()
  -> GameLoop.start()     [if IDLE]
  -> setInterval(tick)

Last player disconnects
  -> WsHandler._handleDisconnect()
  -> GameLoop.removePlayer()
  -> activePlayers.size === 0
  -> GameLoop.stop()      [clearInterval; status = IDLE]
```

### WebSocket message flow

```
Client  --connect?playerId=X-->  WsHandler.handleConnection()
                                   -> gameLoop.addPlayer(X)
                                   -> send { type: 'connected', playerId }

Client  --{ type: 'foo' }-->  WsHandler._handleMessage()
                                -> send { type: 'ack', received: 'foo' }

Client  --disconnect-->  WsHandler._handleDisconnect()
                           -> gameLoop.removePlayer(X)
                           -> [auto-stop if last player]
```

---

## Frontend SPA (`src/`)

**What it is:** React + Vite single-page application deployed to static hosting ($0 idle).

**Communication:**
- REST calls → Serverless Functions (game setup, player registration, scores)
- WebSocket → Managed Game Server (real-time location updates, game events)

**Mobile constraints:**
- Location updates throttled to every 10–20 seconds
- Map redraws only on state change
- All heavy logic runs server-side

---

## Configuration (`config/env.js`)

Runtime configuration bridges all tiers via environment variables:

| Variable                    | Default                    | Used by          |
|-----------------------------|----------------------------|------------------|
| `VITE_API_BASE_URL`         | `http://localhost:3001`    | Frontend → Serverless |
| `VITE_WS_URL`               | `ws://localhost:3002`      | Frontend → Managed server |
| `VITE_MAPS_PROVIDER`        | `osm`                      | Frontend map tiles |
| `VITE_GOOGLE_MAPS_API_KEY`  | _(empty)_                  | Frontend (optional) |
| `VITE_ENV`                  | `development`              | All tiers |
| `VITE_FEATURE_GPS_TRACKING` | `true`                     | Frontend feature flag |
| `VITE_FEATURE_TWO_TEAMS`    | `false`                    | Frontend feature flag |
| `VITE_FEATURE_ADMIN_DASHBOARD` | `false`                 | Frontend feature flag |

See `.env.example` for a complete list with descriptions.

---

## Decision Rationale

| Concern              | Serverless                          | Managed                              |
|----------------------|-------------------------------------|--------------------------------------|
| Game CRUD / queries  | Yes — stateless, infrequent         | No — unnecessary always-on cost      |
| Real-time updates    | No — no persistent connections      | Yes — WebSocket requires long-lived process |
| Game loop / timers   | No — invocations are short-lived    | Yes — `setInterval` needs a process  |
| Score submission     | Yes — one-shot write                | No                                   |
| Zone enforcement     | No — needs game state in memory     | Yes — state lives in managed container |

---

## Pending Work

- **Tasks 8–10:** Serverless DB integration (replace in-memory stores)
- **Tasks 12–15:** Full WebSocket game state protocol
- **Tasks 16–19:** Complete game loop with zone enforcement and timers
- **Task 21:** Admin dashboard for monitoring active sessions

---

*See `spec/DESIGN.md` for architecture goals and cost constraints.*
*See `spec/TASKS.md` for the implementation roadmap.*
