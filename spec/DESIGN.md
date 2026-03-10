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
- SPA React + Vite
- Mobile-first, battery optimized
- Maps: OSM/Google Maps; redraw only on state changes
- Location updates throttled 10–20s

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
- **Optimization implemented (Task 32):** Vercel adapter files in `api/` are kept as thin pass-throughs
  (≤ 6 lines) that delegate immediately to pure handler functions in `functions/`. This minimises
  cold-start bundle size and memory footprint, reducing both latency cost and billed GB-seconds.

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

