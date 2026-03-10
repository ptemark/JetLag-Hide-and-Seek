# JetLag: The Game

A mobile-first, serverless hide-and-seek game using zones around transit stations, challenge cards, and real-time location updates.

## Overview

JetLag is a real-world transit hide-and-seek game where:
- **Hiders** travel via public transit and hide within a zone around their final station.
- **Seekers** ask questions to deduce the hider's location and find them before time runs out.

See [`spec/RULES.md`](spec/RULES.md) for the full rulebook and [`spec/DESIGN.md`](spec/DESIGN.md) for architecture decisions.

---

## Architecture

```
Frontend SPA (React + Vite) → Vercel static hosting ($0 idle)
      |
      v
Serverless API Functions → Vercel Functions ($0 idle)
      |
      v
Serverless Postgres (Neon — pauses when idle, $0 idle compute)
      ^
      |
Managed Game Loop / WebSocket Container (Docker, on-demand)
  — spins up on first player, shuts down after last game ends
```

- **Idle cost:** $0 (static SPA + serverless functions + paused DB + stopped container)
- **Maps:** OpenStreetMap (OSM) — free tile API, no per-request cost
- **Location updates:** throttled 10–20 s for battery efficiency

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Docker** (for the managed game server)
- **Vercel CLI** (`npm i -g vercel`) for deployment
- A **Neon** (or other serverless Postgres) account for the database

---

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in values
cp .env.example .env.development

# 3. Start the frontend dev server (Vite, port 5173)
npm run dev

# 4. Run all tests
npm test

# 5. Production build
npm run build

# 6. Full local CI (install + test + build)
npm run ci:local
```

### Key environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (prod) | Neon / Postgres connection string |
| `VITE_API_BASE_URL` | Yes | Base URL for serverless API (e.g. `https://your-app.vercel.app`) |
| `VITE_WS_URL` | Yes | WebSocket server URL (e.g. `wss://game.your-host.com`) |
| `GAME_SERVER_URL` | Server only | Internal URL of managed container (used by `/api/liveState` and `/api/admin` to proxy) |
| `ADMIN_API_KEY` | Optional | Bearer token for admin dashboard. Generate: `openssl rand -hex 32` |
| `IDLE_SHUTDOWN_DELAY_MS` | Optional | Grace period (ms) before container exits when idle. Default `0`. |
| `ALERT_WEBHOOK_URL` | Optional | Webhook for failure alerts (Slack, PagerDuty, etc.) |
| `SCALE_WEBHOOK_URL` | Optional | Webhook for auto-scale events |

See [`.env.example`](.env.example) for the full list.

---

## API Endpoints

All serverless endpoints are served from `/api/*` via Vercel Functions.

### Players

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/players` | Register a new player. Body: `{ name }`. Returns `{ playerId }`. |
| `GET` | `/api/players?playerId=<id>` | Fetch player by ID. |

### Games

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/games` | Create a new game. Body: `{ hostId, size }`. Returns `{ gameId, status }`. |
| `GET` | `/api/games/<gameId>` | Get game state. |
| `PATCH` | `/api/games/<gameId>` | Update game status. Body: `{ status }`. |
| `POST` | `/api/games/<gameId>/join` | Join a game. Body: `{ playerId, role }`. |

### Scores

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scores` | Submit a score. Body: `{ gameId, playerId, score }`. |
| `GET` | `/api/scores?gameId=<id>` | Get all scores for a game. |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions` | Initiate a WebSocket session. Returns `{ sessionId }`. |
| `DELETE` | `/api/sessions/<sessionId>` | Terminate a WebSocket session. |

### Live State & Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/liveState?gameId=<id>` | None | Proxy to managed server for live in-memory game state. |
| `GET` | `/api/admin` | Bearer token | Admin dashboard: active sessions, players, metrics. |

### Managed Server Internal Endpoints (not public)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/internal/state/<gameId>` | In-memory game state (used by `/api/liveState`). |
| `GET` | `/internal/admin` | Metrics snapshot (used by `/api/admin`). |

### WebSocket Protocol

Connect: `wss://<GAME_SERVER_URL>?playerId=<id>&gameId=<id>`

Outbound messages from client:

| Type | Payload | Description |
|------|---------|-------------|
| `join_game` | `{ gameId, playerId }` | Join a game room on the server. |
| `leave_game` | `{ gameId, playerId }` | Leave a game room. |
| `location_update` | `{ lat, lon }` | Send throttled GPS location (10–20 s). |
| `request_state` | `{}` | Request full game state snapshot. |

Inbound messages to client:

| Type | Payload | Description |
|------|---------|-------------|
| `connected` | `{ gameId, phase }` | Confirmed connection and current phase. |
| `player_location` | `{ playerId, lat, lon }` | Another player's location update. |
| `phase_change` | `{ phase, winner? }` | Game phase transitioned. |
| `game_state` | `{ ...fullState }` | Full game state snapshot. |
| `player_disconnected` | `{ playerId }` | A player left or disconnected. |

---

## Project Structure

```
src/                    # Frontend SPA (React + Vite)
api/                    # Thin Vercel adapter functions (≤6 lines each)
functions/              # Pure serverless handler logic
  ├─ router.js          # HTTP routing + rate limiting
  ├─ auth.js            # Bearer-token admin auth
  ├─ rateLimiter.js     # Fixed-window rate limiter (100 req/60 s per IP)
  ├─ players.js         # Player registration & lookup
  ├─ games.js           # Game CRUD & join
  ├─ scores.js          # Score submission & retrieval
  ├─ sessions.js        # Session initiate/terminate
  ├─ liveState.js       # Live state proxy
  └─ admin.js           # Admin dashboard proxy
server/                 # Managed game-loop container (Node.js + WebSocket)
  ├─ index.js           # Server factory
  ├─ start.js           # Container entry point
  ├─ wsHandler.js       # WebSocket message routing
  ├─ gameLoopManager.js # Per-game phase lifecycle & tick loop
  ├─ gameState.js       # In-memory game state
  ├─ shutdown.js        # SIGTERM/SIGINT + idle shutdown
  └─ ...                # heartbeat, autoScaler, monitoring, alerting, logger
db/                     # Database layer
  ├─ schema.sql         # DDL (players, games, game_players, scores)
  ├─ db.js              # Pool creation + table init
  └─ gameStore.js       # CRUD operations
config/                 # Typed ENV config
scripts/                # Smoke tests and utilities
docs/                   # Additional documentation
spec/                   # DESIGN.md, TASKS.md, RULES.md
```

---

## Deployment

### Serverless (Vercel)

```bash
# Deploy to preview
vercel deploy --prebuilt

# Deploy to production
vercel deploy --prebuilt --prod
```

Set all required environment variables in the Vercel project settings dashboard.

### Managed Game Server (Docker)

```bash
# Build
docker build -t jetlag-server .

# Run (set env vars for your environment)
docker run -e DATABASE_URL=... -e ADMIN_API_KEY=... -p 3002:3002 jetlag-server
```

The container exits automatically when there are no active games (after `IDLE_SHUTDOWN_DELAY_MS`). Your orchestrator (ECS, Fly.io, Kubernetes) should restart it on demand when a player connects.

### CI/CD (GitHub Actions)

The pipeline in `.github/workflows/ci.yml` runs:

1. **test** — `npm ci && npm test && npm run build`
2. **deploy-staging-serverless** — Vercel preview URL
3. **deploy-staging-server** — Docker `:staging` tag → GHCR + staging webhook
4. **smoke-test** — `scripts/smoke.js` (SPA 200 / admin 401 / 404 checks)
5. **deploy-serverless** — Vercel production
6. **deploy-server** — Docker `:latest` tag → GHCR + production webhook

Required GitHub secrets:

| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `GHCR_TOKEN` | GitHub Container Registry token |
| `DEPLOY_WEBHOOK_STAGING` | Webhook URL to start the staging container |
| `DEPLOY_WEBHOOK_PROD` | Webhook URL to start the production container |

---

## Game Scales

| Scale  | Area              | Hiding Period | Zone Radius |
|--------|-------------------|---------------|-------------|
| Small  | City/town         | 30–60 min     | 500 m       |
| Medium | Large city/metro  | 60–180 min    | 500 m       |
| Large  | Region/country    | 180+ min      | 1 km        |

---

## Contributing

This project is built incrementally using **RALPH** (Recursive Autonomous Loop for Project Handling). See [`RALPH.md`](RALPH.md) for the development process and [`spec/TASKS.md`](spec/TASKS.md) for the task backlog.

---

## License

MIT — see [LICENSE](LICENSE).
