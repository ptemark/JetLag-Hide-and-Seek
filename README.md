# JetLag: The Game

[![CI](https://github.com/ptemark/JetLag-Hide-and-Seek/actions/workflows/ci.yml/badge.svg)](https://github.com/ptemark/JetLag-Hide-and-Seek/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org/)

A mobile-first, serverless hide-and-seek game using zones around transit stations, challenge cards, and real-time location updates.

## Gameplay Overview

JetLag is a real-world transit hide-and-seek game played across a city or region.

- **Hiders** travel via public transit during a configurable hiding period. When they reach their final station they lock a hiding zone (a circle around that station) and must remain inside it for the rest of the game.
- **Seekers** chase the hider. Once the hiding period ends, they may ask **one question at a time** drawn from six categories (thermometer, transit, measuring, matching, tentacle, photo). Each answered question awards the seeker a **challenge card** from the hider deck.
- **End Game** begins when seekers physically enter the hider's zone (and are off transit). The hider's GPS freezes; seekers have a short window to spot them.
- **Win conditions:**
  - **Seekers win** by reaching the hider's zone and confirming a spot before the End Game timer expires.
  - **Hider wins** by surviving until the seeking-phase timer expires, or by evading the spot during End Game.

See [`spec/RULES.md`](spec/RULES.md) for the full rulebook and [`spec/DESIGN.md`](spec/DESIGN.md) for architecture decisions.

### Question Types

| Category | What the seeker learns |
|----------|------------------------|
| `thermometer` | Whether the hider is getting warmer (closer) or colder (further) relative to recent seeker movement. |
| `transit` | Whether the hider's station lies on a specified transit route the seeker is travelling. |
| `measuring` | Whether the hider is closer or further from a named feature than the seekers are. |
| `matching` | Whether a nearest feature (airport, river, landmark) matches between hider and seekers. |
| `tentacle` | Whether the hider is within a given radius of a specified point. |
| `photo` | Hider must send a photo matching the asked criteria. Longer expiry window than other categories. |

### Challenge Cards

Answering a question awards the seeker exactly one challenge card drawn from the **Hider Deck**. Three card types exist: **time bonus** (extends the hiding/seeking timer), **powerup** (e.g. false-zone decoy broadcast to mislead seekers), and **curse** (temporarily blocks the cursed side from acting, e.g. submitting questions).

Per-category draw probabilities are defined in [`config/gameRules.js`](config/gameRules.js) — for example, `photo` answers favour time-bonus draws, while `tentacle` answers favour curses. A hider may hold at most 6 cards at a time.

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

# 3. Run all unit tests (Vitest, no DB required)
npm test

# 4. Production build
npm run build

# 5. Full local CI (install + unit tests + integration tests + build)
npm run ci:local
```

### Dev workflow

Day-to-day development uses two long-running processes (frontend SPA + serverless function runner) and one test loop.

#### Start the app locally

`npm run dev` starts the Vite dev server on port 5173. Its `server.proxy` configuration forwards all `/api/*` requests to `http://localhost:3000`, where the Vercel function runner must be listening.

Run these two commands in separate terminals:

```bash
# Terminal 1 — Vercel function runner (serves /api/* on port 3000)
vercel dev --listen 3000

# Terminal 2 — Vite dev server (serves the React SPA on port 5173)
npm run dev
```

Then open `http://localhost:5173` in your browser. API calls from the React app
will be proxied to the local function runner automatically.

> **Note:** `vercel dev` requires the [Vercel CLI](https://vercel.com/docs/cli)
> (`npm i -g vercel`) and a linked Vercel project (`vercel link`). For
> database-backed routes you also need a valid `DATABASE_URL` in your
> `.env.development` (or `.env.local`) file.

#### Run tests

```bash
# Unit tests only (fast, no DB required)
npm test

# Unit tests in watch mode
npm run test:watch

# Integration tests (require a real Postgres URL)
DATABASE_URL=postgresql://user:pass@host:5432/db npm run test:integration

# A single test file
npx vitest run src/components/GameMap.test.jsx
npx vitest run --reporter=verbose functions/games.test.js
```

Integration tests live in `integration/*.test.js` and exercise serverless handlers against a real Postgres database. The suite skips itself if `DATABASE_URL` is not set, so it is safe to omit when iterating on frontend or pure-logic changes. CI provisions a disposable Postgres service and runs the integration job before any deploy.

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
| `RATE_LIMIT_WINDOW_MS` | Optional | Rate limiter window in ms. Default `60000` (60 s). See `functions/rateLimiter.js`. |
| `RATE_LIMIT_MAX_REQUESTS` | Optional | Max requests per IP per window. Default `100`. See `functions/rateLimiter.js`. |

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

| Scale  | Area              | Hiding Period | Zone Radius | Photo question timeout |
|--------|-------------------|---------------|-------------|------------------------|
| Small  | City/town         | 30–60 min     | 500 m       | 10 min                 |
| Medium | Large city/metro  | 60–180 min    | 500 m       | 15 min                 |
| Large  | Region/country    | 180+ min      | 1 km        | 20 min                 |

Photo question expiry values are defined per scale in `functions/questions.js` (`PHOTO_EXPIRY_MS_BY_SCALE`).

---

## Troubleshooting

**Vite proxy is not forwarding API calls (404 from `/api/*` in dev).**
Confirm `vercel dev --listen 3000` is running in a second terminal. Vite's `server.proxy` forwards every `/api/*` request to `http://localhost:3000`; without the function runner on that port, requests fall through to the SPA and return the index HTML or 404. Re-check the port matches in `vite.config.js`.

**`DATABASE_URL must be set to run integration tests`.**
The integration suite (`integration/*.test.js`) connects to a real Postgres database — there is no mock fallback. Provide a live URL: `DATABASE_URL=postgresql://user:pass@host:5432/db npm run test:integration`. A local Postgres container works (`docker run -e POSTGRES_PASSWORD=jetlag -p 5432:5432 postgres:16`). Unit tests (`npm test`) do not require Postgres.

**WebSocket connection refused (browser console: `WebSocket connection to 'ws://…' failed`).**
Confirm `VITE_WS_URL` points at a reachable URL and that the managed game-server container is running. In local dev that means starting the server with `npm start` (or `docker run … jetlag-server`) on the port referenced by `VITE_WS_URL` — by default `ws://localhost:3002` per `.env.example`. The browser must be able to reach it; check firewall / port forwarding for non-localhost hosts.

---

## Contributing

This project is built incrementally using **RALPH** (Recursive Autonomous Loop for Project Handling). See [`RALPH.md`](RALPH.md) for the development process and [`spec/TASKS.md`](spec/TASKS.md) for the task backlog.

---

## License

MIT — see [LICENSE](LICENSE).
