# DESIGN.md v1.1 — JetLag: The Game

## 1️⃣ Overview
- **Name:** JetLag: The Game
- **Goal:** Enable casual Hide + Seek gameplay with minimal development, maintenance, and hosting cost.
- **Critical:** Mobile performance and battery life prioritized. Idle cost should be ~$0.
- **Deployment:**
  - Frontend SPA (React + Vite) → static hosting ($0 idle)
  - Serverless functions → stateless endpoints, $0 when unused
  - Managed game loop/WebSocket container → spins up on first player, shuts down on last player, $0 idle
  - Database/Storage: pauseable serverless Postgres or Aurora

## 2️⃣ Architecture
```
Frontend SPA
  |
  v
Serverless Functions
  - Game creation/deletion
  - Question handling
  - Challenge cards
  - Stats/leaderboards
  - Map/zone queries
  |
  v
Database/Storage (serverless, persistent)
  ^
  |
Trigger on first player joins
  v
Managed Game Loop / WebSocket Container
  - Player tracking, zone enforcement, capture logic
  - Real-time updates
  - Shuts down automatically
```
**Notes:** Serverless $0 idle, managed server runs only when active, frontend updates throttled 10–20s.

## 3️⃣ RALPH Priorities
1. Prefer serverless stateless implementation.
2. Managed game loop: on-demand start/stop, minimal resources, DB persistent state.
3. Optimize simplicity, modular code for future modes.
4. Default maps: OSM; throttle/batch updates.
5. Maintain mobile efficiency (CPU, battery).

## 4️⃣ Cost Rules
- Idle: $0 compute (frontend + serverless + paused DB + spun-down container)
- Active: minimal, scaled containers; serverless scales automatically
- Map API: prefer OSM
- Low operational complexity: automated deployment, minimal maintenance

## 5️⃣ Task Prioritization
1. Implement serverless endpoints first.
2. Managed game loop/WebSocket second (on-demand, minimal resources).
3. Frontend tasks: throttle updates, simple SPA.
4. Modular features for future modes without always-on costs.

## 6️⃣ Gameplay Mode — Hide & Seek
- Extensible for future modes
- Hiding zones around transit stations, radius by game size
- Hiders free within zones, seekers see possible hider zones only
- Questions: matching, thermometer, photo, tentacle; challenge cards as allowed
- Endgame: seeker enters zone, server updates and broadcasts outcome
- Timers managed server-side

## 7️⃣ Frontend

### Core Stack

| Concern | Technology | Why |
|---------|-----------|-----|
| SPA framework | **React 18 + Vite** | Minimal runtime, fast HMR, static output |
| Map rendering | **Leaflet** | Lightweight, mobile-optimised, free OSM tiles; no paid API |
| Map tiles | **CartoDB dark_all** (OSM) | Dark palette matches brand; free, no key required |
| Styling | **CSS Modules** + CSS custom properties | Scoped styles, zero runtime overhead, works with Vite |
| Fonts | **Google Fonts** — Oswald, Inter, JetBrains Mono | Loaded via `<link>` in HTML, not JS import |
| Icons | **Inline SVG only** | No icon-font payload; full colour control |
| State management | **React `useState` / `useReducer`** | No external store library; keep bundle lean |
| Testing | **Vitest** + **@testing-library/react** + **userEvent** | Already in CI; tests user behaviour not internals |

### Hard Constraints

- **No CSS-in-JS** (no Styled Components, Emotion, etc.) — runtime cost unacceptable on mid-range mobile.
- **No Redux / Zustand / MobX** — global state is unnecessary given the single-game-at-a-time data model.
- **No additional map libraries** (Google Maps JS SDK, Mapbox GL) unless explicitly approved in TASKS.md; they carry per-request cost.
- **No heavy date/utility libraries** (moment.js, lodash) — use native APIs.
- Location updates throttled **10–20 s** — no continuous GPS streaming.
- Map redraws only on meaningful state changes — never on every render cycle.

## 8️⃣ Backend
- Node.js with WebSocket or Supabase Realtime
- Responsibilities: game state, move validation, timers, challenge cards, zone enforcement, real-time updates
- Database: serverless Postgres, persistent state

## 9️⃣ State Model
```json
{
  "game_id": "UUID",
  "size": "small|medium|large",
  "bounds": {"lat_min":0,"lat_max":0,"lon_min":0,"lon_max":0},
  "status": "waiting|hiding|seeking|finished",
  "players": [...],
  "zones": [...],
  "questions": [...],
  "challenge_deck": [...]
}
```
- Active state in managed container memory; persistent state in DB.

## 🔟 Gameplay Loop
1. Hiders move; server updates zones.
2. Seekers receive possible zones; submit questions.
3. Server handles challenges, timers, captures.
4. Clients render map efficiently; location throttled.

## 1️⃣1️⃣ Question System API
- POST /questions → submit
- GET /questions/:player_id → fetch
- POST /answers/:question_id → submit; triggers server events
- Supports photo validation and card draws

## 1️⃣2️⃣ Transit & Zones
- Stations from OSM/Google
- Zones server-calculated, polygons sent to client
- Hiders cannot leave; seekers restricted
- Server calculates proximity capture

## 1️⃣3️⃣ Mobile Optimization
- Location updates throttled 10–20s
- Batched map redraws
- Server handles heavy logic

## 1️⃣4️⃣ Extensibility
- Modular for future modes
- Zone, question, challenge logic reusable
- RALPH can create tasks for new modes

## 1️⃣5️⃣ Cost Summary
- Idle: $0
- Active games: minimal containers; serverless scales automatically
- Map API: OSM preferred
- Mobile-first; low maintenance

## 1️⃣6️⃣ Cost-Saving Strategies

### Strategy 1 — Static Frontend ($0 Idle)
- React + Vite SPA compiled to static HTML/JS/CSS.
- Hosted on Vercel free tier or any CDN; no compute while no player is loading the page.
- **Key rule:** never move game logic into the frontend that requires a server to stay alive.

### Strategy 2 — Serverless API Functions ($0 Idle)
- All short-lived operations (player registration, score submission, game queries, session management, admin)
  run as Vercel serverless functions in `api/` + `functions/`.
- Functions are billed per-invocation; idle cost is exactly $0.
- **Optimization implemented (Tasks 32 + 48):** All `/api/*` traffic is handled by a single
  catch-all Vercel function `api/[...path].js`, keeping the deployment within the Hobby plan's
  12-function limit. The catch-all strips the `/api` prefix and delegates to `functions/router.js`.
  One DB pool is created lazily on cold start and reused across warm invocations, minimising
  cold-start latency and billed GB-seconds.

### Strategy 3 — Serverless Postgres ($0 Idle)
- Database: Neon serverless Postgres (or equivalent autoscale-to-zero provider).
- Neon pauses compute after a period of inactivity; storage costs only; $0 compute while idle.
- `db/db.js` manages pool creation; `db/gameStore.js` provides all read/write operations.
- **Key rule:** never rely on a persistent Postgres connection — always use a pool that can reconnect
  after the compute node wakes from pause.

### Strategy 4 — On-Demand Managed Container ($0 Idle)
- The game loop and WebSocket server run in a Docker container that is started only when the first
  player joins and stopped when the last game ends.
- Implemented in `server/gameLoopManager.js` via `onActive` / `onIdle` callbacks wired to
  `server/shutdown.js` (`ShutdownManager`).
- **Grace period:** `IDLE_SHUTDOWN_DELAY_MS` (default `0`) adds a configurable buffer before shutdown,
  preventing unnecessary restarts when games start back-to-back.
  ```
  IDLE_SHUTDOWN_DELAY_MS=30000  # keep alive 30 s after last game ends
  ```
- **Key rule:** the container must cleanly handle `SIGTERM` / `SIGINT` so the orchestrator can stop it
  instantly rather than waiting for a hard-kill timeout. `ShutdownManager.watchSignals()` ensures this.

### Strategy 5 — Activity-Based Auto-Scaling
- `server/autoScaler.js` watches active game count and WebSocket connection count on every game tick.
- Fires a scale-up or scale-down webhook when thresholds are crossed (with cooldown hysteresis to
  prevent flapping).
- Thresholds are configurable via env vars so they can be tuned to the cheapest instance size:
  ```
  SCALE_UP_GAMES=5          # start a second replica at 5 concurrent games
  SCALE_UP_CONNECTIONS=20   # or at 20 WebSocket connections
  SCALE_DOWN_GAMES=0        # scale back when no games remain
  SCALE_DOWN_CONNECTIONS=0
  SCALE_COOLDOWN_MS=60000   # minimum 60 s between events in the same direction
  ```
- Decoupled from the orchestrator: the webhook payload (JSON) is compatible with ECS, Fly.io,
  Kubernetes HPA, or any custom scaling script.

### Strategy 6 — OSM Maps (Free Tile API)
- Default map provider is OpenStreetMap (`VITE_MAPS_PROVIDER=osm`), which has no per-request cost.
- Google Maps is supported as an optional fallback (`VITE_GOOGLE_MAPS_API_KEY`) but is disabled by
  default.
- **Key rule:** never add map features that require a paid tile or Distance Matrix API without
  explicitly documenting the cost impact and making it opt-in via env var.

### Strategy 7 — Throttled Location Updates
- Client-side location polling is throttled to 10–20 s intervals (not continuous GPS streaming).
- Reduces both client battery drain and server-side WebSocket message volume, keeping managed
  container CPU low and extending the idle window.

### Strategy 8 — Metrics-Driven Alerting (Catch Runaway Costs Early)
- `server/monitoring.js` tracks active connections, loop iterations/min, DB reads/writes, and errors.
- `server/alerting.js` fires webhook alerts on `ERROR_RATE_HIGH`, `LOOP_STALL`, `DB_ERROR`, and
  `SERVER_CRASH` — catching runaway loops or connection leaks before they become costly.
- Alert threshold is configurable: `ALERT_ERROR_THRESHOLD=10`.

### Cost Decision Reference

| Situation | Recommendation |
|-----------|---------------|
| No active games | All costs $0 (static site + serverless + paused DB + stopped container) |
| 1–4 concurrent games | Single container instance; serverless handles all API calls |
| 5+ concurrent games | Auto-scaler fires scale-up webhook; add container replicas |
| Maps needed | Use OSM; add Google Maps key only if a specific feature requires it |
| Container slow to start | Increase `IDLE_SHUTDOWN_DELAY_MS` to reduce cold-start frequency |
| Container idling too long | Decrease `IDLE_SHUTDOWN_DELAY_MS` or set to `0` for immediate shutdown |
| DB connection errors on resume | Verify pool reconnect logic in `db/db.js`; Neon wakes in ~500 ms |

---

## 1️⃣7️⃣ Detailed Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENT  (Mobile Browser / PWA)                                  │
│                                                                  │
│  React + Vite SPA  ──── Leaflet / OSM map tiles                 │
│  Throttled GPS (10–20 s)  │  Location updates via WebSocket      │
└───────────┬───────────────┴──────────────┬───────────────────────┘
            │  HTTPS REST                  │  WSS
            ▼                              ▼
┌───────────────────────┐    ┌─────────────────────────────────────┐
│  SERVERLESS TIER      │    │  MANAGED GAME SERVER (on-demand)    │
│  Vercel Functions     │    │  Docker container – Node.js         │
│                       │    │                                     │
│  api/[...path].js ────┼────►  server/stateDispatcher.js          │
│  (catch-all, 1 fn)    │◄───┼──  GET /internal/admin              │
│                       │    │  GET /internal/state/:gameId        │
│  functions/           │    │  server/index.js          (boot)    │
│  ├─ router.js         │    │  server/wsHandler.js      (WS)      │
│  ├─ rateLimiter.js    │    │  server/gameLoopManager.js(ticks)   │
│  ├─ auth.js           │    │  server/gameState.js      (memory)  │
│  ├─ players.js        │    │  server/heartbeat.js    (ping/pong) │
│  ├─ games.js          │    │  server/autoScaler.js   (webhooks)  │
│  ├─ scores.js         │    │  server/shutdown.js     (SIGTERM)   │
│  ├─ liveState.js      │    │  server/monitoring.js   (metrics)   │
│  └─ admin.js          │    │  server/alerting.js     (alerts)    │
└───────────┬───────────┘    └──────────────┬──────────────────────┘
            │  SQL (pg pool)                │  SQL (pg pool)
            ▼                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  DATABASE  (Neon serverless Postgres — pauses when idle)         │
│                                                                  │
│  Tables:  players · games · game_players · scores               │
│  Module:  db/db.js (pool) · db/gameStore.js (CRUD)             │
│  Schema:  db/schema.sql                                          │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decisions illustrated above:**

- The serverless tier has no persistent WebSocket connections; it proxies real-time reads from
  the managed server's `/internal/*` endpoints when needed (via `functions/liveState.js` and
  `functions/admin.js`, routed through `api/[...path].js`).
- Both tiers share the same Postgres database; the managed server holds the hot in-memory copy
  and syncs durable state to DB on phase transitions and player events.
- `functions/` contains pure handler logic; `api/[...path].js` is the single Vercel entry point
  that creates a DB pool on cold start and delegates all routing to `functions/router.js`.

---

## 1️⃣8️⃣ Request Flow Diagrams

### 18a — Game Setup (REST)

```
Player (browser)
  │
  ├─ POST /api/players          ─► api/[...path].js (catch-all)
  │                                  └─ functions/router.js → players.js → registerPlayer()
  │                                       └─ db/gameStore.js → dbCreatePlayer()
  │                                            └─ Postgres: INSERT players
  │  ◄─ { playerId }
  │
  ├─ POST /api/games            ─► api/[...path].js (catch-all)
  │                                  └─ functions/router.js → games.js → createGame()
  │                                       └─ db/gameStore.js → dbCreateGame()
  │                                            └─ Postgres: INSERT games
  │  ◄─ { gameId, status: 'waiting' }
  │
  └─ WS connect  wss://server?playerId=X&gameId=Y
                   └─ server/wsHandler.js → handleConnection()
                        └─ server/gameLoopManager.js → addGame() [starts loop if first game]
                             └─ send { type: 'connected', gameId, phase: 'waiting' }
```

### 18b — Real-Time Gameplay (WebSocket)

```
Hider (browser)                    Game Server                    Seeker (browser)
     │                                  │                               │
     ├── { type: 'location_update',     │                               │
     │    lat, lon }  ──────────────►   │                               │
     │                       wsHandler.handleMessage()                  │
     │                       gameState.updatePlayerLocation()           │
     │                                  ├── broadcast({ type:          │
     │                                  │   'player_location', ... }) ──►
     │                                  │                               │
     │                            [every tick]                          │
     │                       stateDispatcher.dispatch()                 │
     │                       gameLoopManager.onPhaseChange()            │
     │                                  ├── broadcast({ type:          │
     │                                  │   'phase_change',            │
     │                                  │   phase: 'seeking' }) ───────►
     │                                  │                               │
     │                                  │ ◄── { type: 'request_state' }─┤
     │                       gameState.getGameState()                   │
     │                                  ├── send({ type: 'game_state', │
     │                                  │   ...fullState }) ───────────►
```

### 18c — End Game Capture

```
Seekers enter hiding zone (detected server-side via proximity check)
  │
  ├─ gameLoopManager: phase → 'finished'
  ├─ broadcast({ type: 'phase_change', phase: 'finished', winner: 'seekers' })
  ├─ db/gameStore.js → dbUpdateGameStatus(gameId, 'finished')
  ├─ gameLoopManager.removeGame(gameId)
  │    └─ [if last active game] → onIdle() → ShutdownManager.onIdle()
  │         └─ [after IDLE_SHUTDOWN_DELAY_MS] → process.exit(0)
  │
  └─ Client: POST /api/scores  (final score submission via serverless)
```

---

## 1️⃣9️⃣ Game State Machine

```
                ┌─────────┐
    game created │ WAITING │ all players joined
                 └────┬────┘
                      │  host starts game
                      ▼
                ┌─────────┐
    hiders move │ HIDING  │ hiding period timer (30–180 min by scale)
   freely; no   └────┬────┘
   seeker Q's        │  hiding period expires
                      ▼
                ┌─────────┐
  seekers ask   │SEEKING  │ seekers submit questions; hider answers
  questions;    └────┬────┘
  hider stays        │  seekers enter hiding zone  OR  time limit expires
                      ▼
                ┌──────────┐
                │ FINISHED │ scores recorded; container may shut down
                └──────────┘
```

**Phase transitions** are managed by `server/gameLoopManager.js`. Each phase has a configured
duration; when the timer expires the manager fires `onPhaseChange`, which broadcasts the new
phase to all connected clients and writes the updated `status` to Postgres.

---

## 2️⃣0️⃣ Key File Reference

### Serverless tier

| File | Purpose |
|------|---------|
| `api/[...path].js` | Single Vercel catch-all — creates DB pool on cold start, strips `/api` prefix, delegates to `functions/router.js` |
| `functions/router.js` | HTTP adapter: routes `IncomingMessage` to handlers, applies rate-limiter |
| `functions/rateLimiter.js` | Fixed-window rate limiter (100 req/60 s per IP) |
| `functions/auth.js` | Bearer-token auth (constant-time compare) for admin routes |
| `functions/players.js` | Pure handler: `registerPlayer`, `getPlayer` |
| `functions/games.js` | Pure handler: `createGame`, `getGame`, `updateGameStatus`, `joinGame` |
| `functions/scores.js` | Pure handler: `submitScore`, `getGameScores` |
| `functions/sessions.js` | Pure handler: `initiateSession`, `terminateSession` |
| `functions/liveState.js` | Pure handler: `getLiveState` (in-process GSM or HTTP proxy) |
| `functions/admin.js` | Pure handler: `getAdminDashboard` (in-process or HTTP proxy) |

### Managed game server

| File | Purpose |
|------|---------|
| `server/index.js` | Creates HTTP + WebSocket server; wires all components |
| `server/start.js` | Container entry point; calls `createServer`, hooks `ShutdownManager` |
| `server/wsHandler.js` | WebSocket connections, message routing, broadcast |
| `server/gameState.js` | In-memory per-game state (`GameStateManager`) |
| `server/gameLoopManager.js` | Per-game phase lifecycle; tick loop; onActive/onIdle callbacks |
| `server/stateDispatcher.js` | Phase-keyed task registry; concurrent async dispatch per tick |
| `server/heartbeat.js` | Native WS ping/pong; terminates unresponsive clients |
| `server/autoScaler.js` | Scale-up/down webhook on threshold crossing (with cooldown) |
| `server/shutdown.js` | `ShutdownManager`: idle timer + SIGTERM/SIGINT handling |
| `server/monitoring.js` | `MetricsCollector` + `RateTracker`; stdout JSON-line sink |
| `server/alerting.js` | `AlertManager`: webhook alerts for crashes, DB errors, stalls |
| `server/logger.js` | Levelled logger with injectable sink; `nullLogger` for tests |

### Persistence

| File | Purpose |
|------|---------|
| `db/schema.sql` | DDL: `players`, `games`, `game_players`, `scores` tables |
| `db/db.js` | `createPool()` + `createTables()` (idempotent on cold start) |
| `db/gameStore.js` | All CRUD operations: `dbCreatePlayer`, `dbCreateGame`, `dbJoinGame`, `dbSubmitScore`, … |

### Configuration

| File | Purpose |
|------|---------|
| `config/env.js` | Typed `ENV` object; validates required vars at startup |
| `.env.example` | Full reference of all supported environment variables |

---

## 2️⃣1️⃣ Deployment Architecture

```
GitHub Repository
      │
      └─ .github/workflows/ci.yml
            │
            ├─ [test job]
            │    npm ci && npm test && npm run build
            │
            ├─ [deploy-staging-serverless]  ──► Vercel Preview URL
            │    vercel deploy --prebuilt
            │
            ├─ [deploy-staging-server]      ──► GHCR :staging tag
            │    docker build + push         ──► deploy webhook (staging)
            │
            ├─ [smoke-test]
            │    scripts/smoke.js  (SPA 200 / admin 401 / 404 checks)
            │
            ├─ [deploy-serverless]           ──► Vercel Production
            │    vercel deploy --prebuilt --prod
            │
            └─ [deploy-server]              ──► GHCR :latest tag
                 docker build + push         ──► deploy webhook (production)
```

**Runtime topology:**

```
Internet
    │
    ├─── cdn.vercel.com ──── src/ (static SPA)
    │
    ├─── api.vercel.com ──── api/[...path].js (1 catch-all fn, $0 idle)
    │                            └── Neon Postgres (pauses when idle)
    │
    └─── game.your-host.com ──── Docker container (on-demand)
              starts on first WS connection
              shuts down after last game ends + IDLE_SHUTDOWN_DELAY_MS
```

### Vercel Routing Rules (non-negotiable)

Vercel evaluates **`rewrites` after serverless functions**. A catch-all rewrite will never intercept `/api/*` requests — the function `api/[...path].js` always takes priority.

**The only permitted `vercel.json` routing configuration is:**

```json
"rewrites": [
  { "source": "/(.*)", "destination": "/index.html" }
]
```

This routes all SPA paths to `index.html` for client-side routing, while all `/api/*` paths continue to reach `api/[...path].js` unchanged because Vercel routes functions before applying rewrites.

**What not to use:**

- **`routes` with `{ "handle": "filesystem" }`** — the filesystem phase only serves files from `outputDirectory` (`dist/`). It does NOT route to serverless functions in `api/`. Any `/api/*` path that has no matching static file falls through to the SPA catch-all, returning 200 HTML instead of the expected JSON response. This breaks the smoke tests (admin returns 200 instead of 401/503; unknown route returns 200 instead of 404).
- **`rewrites` with negative lookaheads** (e.g. `/((?!api/).*)`) — Vercel's `path-to-regexp` does not reliably support lookaheads and may silently ignore the lookahead, treating the pattern as `/(.*)`  and rewriting all paths including `/api/*`.

**Vercel function entry point:** `api/[...path].js` is the single catch-all for all `/api/*` traffic. It strips the `/api` prefix from `req.url` before delegating to `functions/router.js`. Any change to this stripping logic must be tested against paths with two or more segments (e.g. `/api/games/:id/join`, `/api/games/:id/zone`) — not just root-level paths like `/api/games`.

---

## 2️⃣2️⃣ Frontend Visual Design

### Brand Identity

The JetLag visual identity is a **retro 1970s travel poster** aesthetic — dark navy backgrounds, warm sunset gradient bands, and a clean airplane silhouette. Every UI component should feel like it belongs on a vintage transit map.

Reference image: `images/jetlag.jpeg`

---

### Colour Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#1B2A3A` | Page background, card backgrounds |
| `--color-surface` | `#243447` | Raised surfaces: panels, modals, inputs |
| `--color-surface-2` | `#2D3F55` | Hover states, secondary surfaces |
| `--color-border` | `#3A5068` | Input borders, dividers |
| `--color-text-primary` | `#F0EAD6` | Body text, labels (warm off-white) |
| `--color-text-secondary` | `#9EB3C8` | Placeholder text, captions |
| `--color-sunset-1` | `#F5C84A` | Innermost band — warm yellow |
| `--color-sunset-2` | `#F08730` | Second band — amber orange |
| `--color-sunset-3` | `#E05828` | Third band — burnt orange |
| `--color-sunset-4` | `#C83A18` | Outermost band — deep red-orange |
| `--color-accent` | `#F08730` | Primary buttons, active states, links |
| `--color-accent-hover` | `#E05828` | Button hover |
| `--color-success` | `#4CAF82` | Positive feedback (found, joined) |
| `--color-error` | `#E05828` | Error alerts (reuses sunset-3) |
| `--color-white` | `#FDFAF4` | Inner semicircle / logo highlight |

The sunset gradient runs: `--color-white` → `--color-sunset-1` → `--color-sunset-2` → `--color-sunset-3` → `--color-sunset-4`.

---

### Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| App title (h1) | `'Oswald', sans-serif` | 700 | `2rem` |
| Section headings (h2) | `'Oswald', sans-serif` | 600 | `1.4rem` |
| Body / labels | `'Inter', sans-serif` | 400 | `1rem` |
| Monospace (game IDs, coords) | `'JetBrains Mono', monospace` | 400 | `0.9rem` |
| Button text | `'Oswald', sans-serif` | 600 | `1rem`, uppercase, letter-spacing 0.05em |

Load via Google Fonts: `Oswald`, `Inter`, `JetBrains Mono`.

---

### Logo & Icon

- **Primary mark:** airplane silhouette (from `images/jetlag.jpeg`) — dark navy `#1B2A3A` on a sunset semicircle background.
- **App icon:** `public/icon-192.svg` / `public/icon-512.svg` — update to match the retro palette.
- **Minimum clear space:** half the icon height on all sides.
- Never rotate, recolour, or add drop shadows to the airplane mark.

---

### Component Styles

#### Buttons

```
Primary button
  background:    --color-accent  (#F08730)
  color:         --color-bg      (#1B2A3A)
  font:          Oswald 600, uppercase
  border-radius: 4px
  padding:       0.6rem 1.4rem
  hover:         --color-accent-hover (#E05828)

Danger / destructive button
  background: --color-sunset-4  (#C83A18)
  color:      --color-white

Ghost button (secondary)
  background:   transparent
  border:       1px solid --color-accent
  color:        --color-accent
  hover-bg:     rgba(240,135,48,0.12)
```

#### Inputs & Selects

```
background:    --color-surface   (#243447)
border:        1px solid --color-border  (#3A5068)
color:         --color-text-primary
border-radius: 4px
padding:       0.5rem 0.75rem
focus outline: 2px solid --color-accent (no default browser ring)
placeholder:   --color-text-secondary
```

#### Cards / Panels

```
background:    --color-surface  (#243447)
border:        1px solid --color-border
border-radius: 6px
padding:       1rem 1.25rem
box-shadow:    0 2px 8px rgba(0,0,0,0.4)
```

#### Alerts / Error Messages

```
background:    rgba(200,58,24, 0.15)   (sunset-4 tinted)
border-left:   3px solid --color-error
color:         --color-text-primary
border-radius: 0 4px 4px 0
padding:       0.5rem 0.75rem
```

#### Map Overlay (GameMap)

- Base tiles: OSM dark style (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`)
- Hider zone polygon fill: `rgba(240,135,48,0.15)` / stroke `--color-sunset-2`
- Seeker position marker: `--color-accent` circle
- Hider position marker: `--color-sunset-4` circle (during End Game only)
- End Game active banner: sunset gradient bar across top of map

---

### Layout

- **Max content width:** `480px` (mobile-first; centred on desktop)
- **Page padding:** `1rem` horizontal
- **Section spacing:** `1.5rem` gap between stacked panels
- **Responsive breakpoint:** `600px` — widen to `560px` max, increase font slightly

---

### Motion & Feedback

- Button press: `transform: scale(0.97)` + `transition: 80ms`
- Panel entry: `opacity 0→1` + `translateY 8px→0`, `200ms ease-out`
- Error alert: shake keyframe `±4px` horizontal, `300ms`
- Avoid animations during gameplay map updates (battery concern)

---

### Accessibility

- All interactive elements: minimum `44×44 px` touch target
- Colour contrast: all text against its background ≥ 4.5:1 (WCAG AA)
- Focus rings: `2px solid --color-accent` — never `outline: none` without a custom replacement
- `aria-label` on all icon-only buttons; `role="alert"` on error messages (already in components)

---

### CSS Architecture

- Define all tokens in `:root` in `src/index.css`
- Components use CSS custom properties — no hardcoded colour hex values in component files
- One global stylesheet (`src/index.css`) for tokens + resets; per-component `.module.css` files for layout
- No CSS-in-JS dependencies (keep bundle lean for mobile)

### Game Creation — Location Picker

After selecting a game size, the host uses an interactive location picker to define where the game will be played. The flow replaces the raw four-field bounds form with a search-first, map-centric experience.

#### 1. Geocoding search

A text input labelled "Search for a city, town or country…" calls the **Nominatim OSM API** (`https://nominatim.openstreetmap.org/search?q=…&format=json&limit=5`) on form submit or after a 500 ms debounce. Results appear in a dropdown list beneath the input; selecting a result:
- Centres and zooms the preview map to the result's bounding box.
- Sets `center` to the result's `lat`/`lon`.
- Recomputes `radiusKm` to the scale default (see table below) and updates the `bounds` fields.

Nominatim is free, requires no API key, and must be rate-limited to ≤ 1 request/second (debounce handles this). No new paid APIs are introduced.

#### 2. Preview map

A Leaflet OSM map (same dark CartoDB `dark_all` tiles as `GameMap`) renders inside the Create Game form directly below the search bar. The map is hidden until a location is chosen (to avoid blank-map confusion on first load). On location select the map:
- Flies to the result bounding box.
- Draws a `L.circle` centred on the result, radius = scale default, styled with `rgba(240,135,48,0.15)` fill and `--color-sunset-2` stroke — matching the in-game zone style.
- Shows a draggable centre marker so the host can nudge the zone without re-searching.

#### 3. Draggable radius resize

The host can resize the zone circle by dragging a **resize handle** — a small accent-coloured circle marker placed at the east edge of the zone circle. Dragging it updates `radiusKm` live and redraws the circle. A read-only numeric display (or editable input) shows the current radius in km. The drag handle is keyboard-accessible (arrow keys ±1 km).

#### 4. Lat/lon fields

The four `lat_min / lat_max / lon_min / lon_max` fields are retained in a collapsible **"Advanced"** disclosure section below the map. They are auto-populated whenever the map changes (centre + radius → axis-aligned bounding box). Manual edits to any field update the map circle accordingly (centre = midpoint of bounds, radius = half the shorter dimension). This gives power users a direct numeric override and preserves API compatibility.

#### Data flow

```
State: { center: { lat, lon }, radiusKm, bounds: { lat_min, lat_max, lon_min, lon_max } }

Geocoding result selected  →  set center + radiusKm (scale default)  →  recompute bounds
Map centre marker dragged  →  update center  →  recompute bounds
Resize handle dragged      →  update radiusKm  →  recompute bounds
Manual field edited        →  update bounds  →  recompute center + radiusKm (best-fit)
Form submit                →  send bounds to POST /api/games (API unchanged)
```

#### Default radii by scale

| Scale | Default radius | Approx. area |
|-------|---------------|--------------|
| small | 5 km | ~78 km² |
| medium | 15 km | ~707 km² |
| large | 50 km | ~7 854 km² |

The host may resize freely; there is no enforced minimum/maximum beyond what the game rules imply.

#### Library constraints

- Geocoding: Nominatim REST — no new dependency.
- Map: existing `react-leaflet` + `leaflet` already in bundle — no new map library.
- Resize handle: implemented as a standard Leaflet `L.marker` with a custom icon dragged via `dragend` event — no `leaflet-editable` or other plugin needed.
- Map height in form: `260px` fixed on mobile, `320px` at ≥ 600 px breakpoint — consistent with mobile-first layout.

---

### Technology Selection Rationale

| Decision | Chosen | Rejected alternatives | Reason |
|----------|--------|-----------------------|--------|
| Map library | Leaflet | Google Maps SDK, Mapbox GL | Free, ~40 KB gzipped, first-class OSM support, no API key |
| Dark tile provider | CartoDB dark_all | Mapbox dark, Stamen toner | Free with attribution, aligns with navy brand palette |
| Styling approach | CSS Modules + custom properties | Tailwind, Styled Components, Emotion | Zero runtime, Vite native, no class-name memorisation overhead |
| Icon strategy | Inline SVG | Font Awesome, Heroicons JS | No payload; full colour/animation control without extra dependency |
| Font loading | `<link rel="preconnect">` + Google Fonts stylesheet | Self-hosted, `@fontsource` npm | Google CDN caching; preconnect eliminates render-blocking penalty |
| State management | React built-ins | Redux, Zustand | Single-game data model fits component state; extra library = dead weight |
| Build tool | Vite | CRA, webpack | Fast cold start, native ES modules, minimal config |

