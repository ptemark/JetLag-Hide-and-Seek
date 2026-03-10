# TASKS

Track implementation progress for the Jet Lag project. Each task is one RALPH loop iteration.
See `RALPH.md` for the loop process and `DESIGN.md` for all design decisions.

---

## Current Task

_Task 30 complete._

---

## Completed Tasks Log

| # | Date | Task | Files | Notes |
|---|------|------|-------|-------|
| 1 | 2026-03-05 | Initialize project repository | README.md, LICENSE, src/, functions/, docs/, config/ | Git initialized; MIT license; placeholder dirs with .gitkeep |
| 2 | 2026-03-05 | Set up build and deployment tools | package.json, vite.config.js, index.html, src/main.jsx, src/App.jsx, src/App.test.jsx, .gitignore, .github/workflows/ci.yml | React+Vite+Vitest; build and 2 tests pass; CI placeholder added |
| 4 | 2026-03-05 | Define environment configuration | .env.example, config/env.js, config/env.test.js | Typed ENV config module; 16 new tests; build clean; no secrets committed |
| 5 | 2026-03-05 | Set up managed server instances | server/index.js, server/gameLoop.js, server/wsHandler.js, server/server.test.js | HTTP+WebSocket server; GameLoop auto-start/stop on player lifecycle; 22 new tests; build clean |
| 6 | 2026-03-05 | Implement serverless endpoints | functions/players.js, functions/games.js, functions/scores.js, functions/router.js, functions/functions.test.js | Pure handler functions for player registration, game queries, score submission; 30 new tests; build clean |
| 7 | 2026-03-05 | Establish hybrid architecture documentation | docs/ARCHITECTURE.md | Documents serverless vs managed tiers, lifecycle, message flows, config, and decision rationale; build clean; 70 tests pass |
| 8 | 2026-03-05 | Choose database for game state | docs/DATABASE.md, config/env.js, config/env.test.js | Chose Neon serverless Postgres ($0 idle, autoscales to zero); documented rationale; DATABASE_URL config added; 72 tests pass |
| 9 | 2026-03-05 | Implement database schema | db/schema.sql, db/db.js, db/db.test.js, package.json | Tables: players, games, game_players, scores; pg driver installed; createPool + createTables module; 23 new tests; 95 total pass; build clean |
| 10 | 2026-03-05 | Add serverless functions for DB read/write | db/gameStore.js, db/gameStore.test.js, functions/players.js, functions/games.js, functions/scores.js | DB CRUD layer (dbCreatePlayer, dbGetPlayer, dbCreateGame, dbGetGame, dbUpdateGameStatus, dbJoinGame, dbSubmitScore, dbGetGameScores); handlers accept optional pool; 32 new tests; 127 total pass; build clean |
| 11 | 2026-03-05 | Add automated tests for database interactions | db/lifecycle.test.js | Lifecycle tests: player create→get, game full lifecycle (join/status transitions), score submit→retrieve/upsert, full round workflow, error propagation, SQL structure verification; 27 new tests; 154 total pass; build clean |
| 12 | 2026-03-05 | Implement WebSocket server for real-time game state updates | server/gameState.js, server/wsHandler.js, server/index.js, server/gameState.test.js, server/server.test.js | GameStateManager (in-memory per-game state); WsHandler extended with join_game, leave_game, location_update, request_state handlers; broadcastToGame routing; 36 new tests; 190 total pass; build clean |
| 13 | 2026-03-05 | Add serverless endpoints to initiate/terminate WebSocket sessions | functions/sessions.js, functions/sessions.test.js, functions/router.js | POST /sessions (initiateSession) and DELETE /sessions/:sessionId (terminateSession); in-process Map store with injectable store for testing; router updated; 14 new tests; 204 total pass; build clean |
| 14 | 2026-03-05 | Implement basic heartbeat/ping system to keep connections alive and detect disconnects | server/heartbeat.js, server/heartbeat.test.js, server/index.js, server/server.test.js | HeartbeatManager using native WS ping/pong frames; track(), start(), stop(); auto-terminates unresponsive clients; wired into createServer with heartbeatInterval option; 14 new tests; 218 total pass; build clean |
| 15 | 2026-03-05 | Write tests for connection reliability and message delivery | server/connection.test.js | 8 describe blocks covering reconnection, closed-client safety, multi-game cleanup, message ordering, broadcast isolation, GSM-less degradation, concurrent players, heartbeat integration; 23 new tests; 241 total pass; build clean |
| 16 | 2026-03-05 | Implement skeleton game loop logic on managed servers | server/gameLoopManager.js, server/index.js | GameLoopManager: per-game phase lifecycle (waiting→hiding→seeking→finished); auto-advances on timers; onPhaseChange/onTick hooks; wired into createServer with phase broadcast + GSM sync; 31 new tests; 272 total pass; build clean |
| 17 | 2026-03-05 | Add state update dispatcher | server/stateDispatcher.js, server/stateDispatcher.test.js, server/index.js | StateDispatcher: phase-keyed task registry ('*' global + per-phase); async concurrent dispatch; isolated error handling; onDispatch callback; wired to gameLoopManager.onTick; 23 new tests; 295 total pass; build clean |
| 18 | 2026-03-05 | Implement start/stop hooks for game loop to spin down managed servers when idle | server/gameLoopManager.js, server/index.js, server/gameLoopManager.test.js, server/server.test.js | onActive/onIdle callbacks on GameLoopManager; fire on 0→1 and 1→0 active game transitions; server.onActive(fn)/server.onIdle(fn) registration API; 12 new tests; 307 total pass; build clean |
| 19 | 2026-03-05 | Create logging mechanism to track loop iterations, errors, and performance metrics | server/logger.js, server/logger.test.js, server/gameLoopManager.js, server/stateDispatcher.js, server/index.js, server/server.test.js | Logger class with level filtering and injectable sink; nullLogger no-op; startTimer perf helper; wired into GameLoopManager (tick/phase/start/stop) and StateDispatcher (task errors + dispatch perf); server lifecycle logs (start/stop/active/idle); 23 new tests; 330 total pass; build clean |
| 20 | 2026-03-05 | Implement serverless API endpoints for retrieving live game state | functions/liveState.js, functions/liveState.test.js, functions/router.js, server/index.js, server/server.test.js | GET /live/:gameId serverless handler (gsm or serverUrl proxy); GET /internal/state/:gameId HTTP endpoint on managed server; router updated with new route and async-aware dispatch; 15 new tests; 345 total pass; build clean |
| 21 | 2026-03-05 | Build basic admin dashboard to view active sessions, connected players, and loop health | functions/admin.js, functions/admin.test.js, functions/router.js, server/index.js, server/server.test.js | GET /admin serverless handler (in-process or serverUrl proxy); GET /internal/admin HTTP endpoint on managed server returns connectedPlayers, activeGameCount, uptimeMs, games[]; router updated; 18 new tests; 363 total pass; build clean |
| 22 | 2026-03-05 | Add authentication/authorization for admin access | functions/auth.js, functions/auth.test.js, functions/admin.js, functions/admin.test.js, functions/router.js, config/env.js, .env.example | Bearer token auth via Authorization header; constant-time comparison (timingSafeEqual); ADMIN_API_KEY env var; 401 for missing/wrong token, 503 if unconfigured; router passes headers to handlers; 23 new tests; 386 total pass; build clean |
| 23 | 2026-03-05 | Add rate limiting and error handling for API endpoints | functions/rateLimiter.js, functions/rateLimiter.test.js, functions/router.test.js, functions/router.js | Fixed-window rate limiter (100 req/60s per client IP); X-Forwarded-For extraction; 429 with Retry-After + X-RateLimit-Remaining headers; try/catch in router → 500 on handler throw; injectable limiter for test isolation; 31 new tests; 417 total pass; build clean |
| 24 | 2026-03-09 | Integrate logging/monitoring services | server/monitoring.js, server/monitoring.test.js, api/*.js, vercel.json, .env.example, .github/workflows/ci.yml | MetricsCollector (loop iterations, connections, DB reads/writes, errors); createMonitoringSink (stdout JSON-line for CloudWatch/Datadog, HTTP sink for Datadog Logs API); Vercel serverless adapters in api/; CI Vercel deploy step; GAME_SERVER_URL env var; 26 new tests; 443 total pass; build clean |
| 25 | 2026-03-09 | Track metrics: active connections, loop iterations/min, DB reads/writes | server/monitoring.js, server/monitoring.test.js, server/index.js, server/server.test.js, db/gameStore.js, db/gameStore.test.js | RateTracker (sliding-window per-minute rate); MetricsCollector wired into createServer (ACTIVE_CONNECTIONS on WS connect/close, LOOP_ITERATIONS + RateTracker on tick, ERRORS on WS error); /internal/admin includes metrics snapshot + loopIterationsPerMinute; createInstrumentedStore wraps all DB fns to auto-increment DB_READS/DB_WRITES/ERRORS; 23 new tests; 466 total pass; build clean |
| 26 | 2026-03-09 | Implement alerting for failure scenarios | server/alerting.js, server/alerting.test.js, server/index.js, server/server.test.js, config/env.js, config/env.test.js, .env.example | AlertManager (SERVER_CRASH, DB_ERROR, CONNECTION_DROP, ERROR_RATE_HIGH, LOOP_STALL); fire-and-forget HTTP webhook; logger + onAlert callback; watchProcess() for uncaughtException/unhandledRejection; nullAlertManager no-op; ALERT_WEBHOOK_URL + ALERT_ERROR_THRESHOLD env vars; wired into createServer (onTick checkMetrics + ws error alert); 39 new tests; 505 total pass; build clean |
| 27 | 2026-03-09 | Add unit tests for serverless functions and managed game loop logic | server/wsHandler.test.js | Dedicated WsHandler unit tests: handleConnection, broadcast, broadcastToGame, getGamePlayerCount, message routing (join_game, leave_game, location_update, request_state, unknown type, invalid JSON), disconnect; mock ws objects; 47 new tests; 552 total pass; build clean |
| 28 | 2026-03-09 | Add integration tests to simulate multiple players connecting, updating state, and disconnecting | server/integration.test.js | Real HTTP+WebSocket server; buffered message queue; 10 describe blocks: handshake, multi-player join, location updates, WS state request, HTTP state endpoint, disconnect notifications, count tracking, broadcast isolation, admin endpoint, full lifecycle; 19 new tests; 571 total pass; build clean |
| 29 | 2026-03-09 | Set up CI/CD pipeline to run tests and deploy both serverless and managed components | .github/workflows/ci.yml, server/start.js, Dockerfile, package.json | Multi-job pipeline: test → deploy-serverless (Vercel) + deploy-server (Docker → GHCR + webhook); concurrency cancel-in-progress; Docker layer cache via GHA; server/start.js container entrypoint with onIdle shutdown; npm start script; 571 tests pass; build clean |
| 30 | 2026-03-09 | Add staging environment to validate system behavior before production deployment | .github/workflows/ci.yml, scripts/smoke.js, scripts/smoke.test.js, .env.staging.example, package.json | 6-job CI pipeline: test → deploy-staging-serverless + deploy-staging-server → smoke-test → deploy-serverless + deploy-server; Vercel preview URL captured as job output; Docker :staging tag separate from :latest; smoke.js checks SPA 200 / admin 401 / unknown-route 404 / optional game-server; 11 new tests; 582 total pass; build clean |
| 31 | 2026-03-09 | Implement auto-scaling for managed servers based on activity | server/autoScaler.js, server/autoScaler.test.js, server/index.js, server/server.test.js, config/env.js, config/env.test.js, .env.example | AutoScaler class: UP/DOWN thresholds on activeGames + activeConnections; cooldown hysteresis; fire-and-forget webhook; onScale callback; nullAutoScaler no-op; wired into createServer onTick via nullAutoScaler default; env vars SCALE_WEBHOOK_URL/SCALE_UP_GAMES/SCALE_UP_CONNECTIONS/SCALE_DOWN_GAMES/SCALE_DOWN_CONNECTIONS/SCALE_COOLDOWN_MS; 36 new tests; 618 total pass; build clean |
| 33 | 2026-03-10 | Implement full shutdown option to reduce idle costs to zero | server/shutdown.js, server/shutdown.test.js, server/start.js, .env.example | ShutdownManager: idle-triggered shutdown with configurable IDLE_SHUTDOWN_DELAY_MS grace period; SIGTERM/SIGINT signal handlers; async cleanup hooks; re-entrancy guard; onActive() cancels pending idle countdown; 16 new tests; 642 total pass; build clean |

---

## Next Up

Tasks are ordered by dependency. Complete them top to bottom.

### Phase 1 — Project Scaffolding

- [x] **1** — Initialize project repository: set up Git, README, LICENSE, and basic folder structure (`src/`, `functions/`, `docs/`, `config/`).
- [x] **2** — Set up project build and deployment tools (Node.js, npm scripts, CI/CD placeholder).
- [x] **3** — Create `DESIGN.md` and `TASKS.md` files to track design decisions and tasks.

### Phase 2 — Core Infrastructure

- [x] **4** — Define environment configuration: dev, staging, prod with environment variables for API keys, DB endpoints, and feature toggles.
- [x] **5** — Set up managed server instances for persistent components (game loop, WebSocket handling).
- [x] **6** — Implement serverless endpoints for short-lived tasks (player registration, score submission, basic queries).
- [x] **7** — Establish hybrid architecture documentation showing which services are serverless and which are managed.

### Phase 3 — Persistence Layer

- [x] **8** — Choose database(s) for game state: e.g., DynamoDB or PostgreSQL.
- [x] **9** — Implement basic schema or table structure for players, sessions, and game states.
- [x] **10** — Add serverless functions to read/write game state to the database.
- [x] **11** — Add automated tests for database interactions, verifying correct read/write.

### Phase 4 — WebSocket & Real-Time Tracking

- [x] **12** — Implement WebSocket server on managed backend for real-time game state updates.
- [x] **13** — Add serverless endpoints to initiate/terminate WebSocket sessions.
- [x] **14** — Implement basic heartbeat/ping system to keep connections alive and detect disconnects.
- [x] **15** — Write tests for connection reliability and message delivery.

### Phase 5 — Game Loop Infrastructure

- [x] **16** — Implement skeleton game loop logic on managed servers (without specific rules yet).
- [x] **17** — Add state update dispatcher: takes current game state and triggers serverless tasks for computation.
- [x] **18** — Implement start/stop hooks for game loop to spin down managed servers when idle.
- [x] **19** — Create logging mechanism to track loop iterations, errors, and performance metrics.

### Phase 6 — API & Admin Tools

- [x] **20** — Implement serverless API endpoints for retrieving live game state.
- [x] **21** — Build basic admin dashboard to view active sessions, connected players, and loop health.
- [x] **22** — Add authentication/authorization for admin access.
- [x] **23** — Add rate limiting and error handling for API endpoints.

### Phase 7 — Analytics & Monitoring

- [x] **24** — Integrate logging/monitoring services (CloudWatch, Datadog, or equivalent) for both serverless and managed components.
- [x] **25** — Track metrics like active connections, loop iterations per minute, and database reads/writes.
- [x] **26** — Implement alerting for failure scenarios (server crashes, DB errors, connection drops).

### Phase 8 — Testing & CI/CD

- [x] **27** — Add unit tests for serverless functions and managed game loop logic.
- [x] **28** — Add integration tests to simulate multiple players connecting, updating state, and disconnecting.
- [x] **29** — Set up CI/CD pipeline to run tests and deploy both serverless and managed components.
- [x] **30** — Add staging environment to validate system behavior before production deployment.

### Phase 9 — Optimization & Cost Management

- [x] **31** — Implement auto-scaling for managed servers based on activity.
- [x] **32** — Optimize serverless functions to reduce invocation costs (minimal memory, short execution).
- [x] **33** — Implement full shutdown option to reduce idle costs to zero.
- [ ] **34** — Document cost-saving strategies in `DESIGN.md` for future reference.

### Phase 10 — Documentation & Knowledge Transfer

- [ ] **35** — Finalize `DESIGN.md` with architecture diagrams and explanations.
- [ ] **36** — Update `README.md` with setup instructions, API endpoints, and deployment notes.
- [x] **37** — Create `RALPH.md` instructions for future task execution using RALPH loops.
- [ ] **38** — Write onboarding guide for new developers to run and extend the project.

### Phase 11 — Production Wiring

- [ ] **39** — Wire Vercel API adapters to real Postgres: update `api/players.js`, `api/games/[id].js`, and `api/scores.js` to create a `pg.Pool` from `DATABASE_URL` and pass it to each handler. Use `createPool` from `db/db.js` and call `createTables` on cold start. Handlers already accept an optional pool argument and fall back to in-memory when omitted.