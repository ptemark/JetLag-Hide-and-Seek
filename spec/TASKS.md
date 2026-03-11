# TASKS

Track implementation progress for the Jet Lag project. Each task is one RALPH loop iteration.
See `RALPH.md` for the loop process and `DESIGN.md` for all design decisions.

---

## Current Task

_Task 58 complete. Progressive Web App; 1012 tests pass._

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
| 34 | 2026-03-10 | Document cost-saving strategies in DESIGN.md | spec/DESIGN.md | Added section 16: 8 numbered strategies covering static frontend, serverless functions, serverless Postgres, on-demand container + shutdown, auto-scaling, OSM maps, throttled location, and metrics-driven alerting; cost decision reference table included |
| 39 | 2026-03-10 | Wire Vercel API adapters to real Postgres | api/players.js, api/games/[id].js, api/scores.js, api/api.test.js | Lazy pool singleton (createPool + createTables on cold start) in each adapter; null fallback when DATABASE_URL unset; try/catch → 500; 13 new tests; 655 total pass; build clean |
| 35 | 2026-03-10 | Finalize DESIGN.md with architecture diagrams | spec/DESIGN.md | Added sections 17–21: detailed component diagram, 3 request-flow diagrams (game setup / real-time gameplay / end-game), game state machine, key file reference table, deployment topology; 655 tests pass; build clean |
| 36 | 2026-03-10 | Update README.md with setup, API endpoints, and deployment | README.md | Full rewrite: prerequisites, local setup, env var table, all REST + WS API endpoints, project structure, Vercel + Docker + CI/CD deployment, GitHub secrets reference; 655 tests pass; build clean |
| 38 | 2026-03-10 | Write onboarding guide for new developers | docs/ONBOARDING.md | 13-section guide: prerequisites, first-time setup, dev commands, project map, 90-second architecture, testing conventions, step-by-step for adding endpoints and WS messages, env var rules, RALPH loop, deployment checklist, help reference; 655 tests pass; build clean |
| 40 | 2026-03-10 | Implement zone calculation service | functions/zones.js, functions/zones.test.js, api/zones.js, functions/router.js, functions/router.test.js | GET /zones?bounds=&scale= fetches transit stations from OSM Overpass API and returns hiding zones (500 m small/medium, 1 km large); injectable fetch for test isolation; router updated with query param parsing; 32 new tests; 687 total pass; build clean |
| 41 | 2026-03-10 | Implement question system API | db/schema.sql, db/gameStore.js, functions/questions.js, functions/questions.test.js, functions/router.js, api/questions.js, api/answers/[questionId].js, server/index.js | POST /questions, GET /questions?playerId=, POST /answers/:questionId; questions+answers tables; DB store functions; fire-and-forget WS notify via POST /internal/notify on managed server; injectable fetch for test isolation; 35 new tests; 722 total pass; build clean |
| 42 | 2026-03-10 | Implement challenge card system | db/schema.sql, db/gameStore.js, functions/cards.js, functions/cards.test.js, functions/questions.js, functions/router.js, api/cards.js, api/cards/[cardId]/play.js | Hider Deck (time_bonus/powerup/curse); cards table; dbDrawCard/dbGetPlayerHand/dbPlayCard; GET /cards?gameId=&playerId= returns hand (max 6); POST /cards/:cardId/play applies effect; card draw triggered on answer submit (in-process + DB); 29 new tests; 751 total pass; build clean |
| 43 | 2026-03-10 | Implement proximity / capture detection | server/captureDetector.js, server/captureDetector.test.js, server/gameState.js, server/index.js | haversineDistance + checkCapture pure functions; GameStateManager.setGameZones/getGameZones; POST /internal/games/:gameId/zones endpoint; seeking-phase StateDispatcher task checks capture each tick; broadcasts capture event; optional store for DB status+score persistence; re-entrancy guard; 20 new tests; 771 total pass; build clean |
| 44 | 2026-03-10 | Build frontend game lobby | src/api.js, src/components/PlayerForm.jsx, src/components/GameForm.jsx, src/components/WaitingRoom.jsx, src/components/Lobby.jsx, src/components/Lobby.test.jsx, src/App.jsx, functions/games.js, api/games/index.js | 3-step lobby flow (register → create/join → waiting room); PlayerForm calls POST /api/players; GameForm create tab has scale selector + 4-field bounds picker; join tab validates via GET /api/games/:id; handleCreateGame HTTP handler + Vercel adapter api/games/index.js; 32 new tests; 803 total pass; build clean |
| 45 | 2026-03-10 | Build frontend map view | src/components/GameMap.jsx, src/components/GameMap.test.jsx, src/components/Lobby.jsx, src/components/WaitingRoom.jsx, package.json | Leaflet+OSM map; game bounds rectangle; hiding zone circles; live player markers; WS connection (player_location/game_state/phase_change/capture); GPS polling throttled to 10 s; WaitingRoom gets Start Game button; Lobby transitions to GameMap in playing state; 18 new tests; 813 total pass; build clean |
| 46 | 2026-03-10 | Build frontend question/answer UI | src/api.js, src/components/QuestionPanel.jsx, src/components/AnswerPanel.jsx, src/components/GameMap.jsx, src/components/QA.test.jsx, src/components/GameMap.test.jsx | Seeker QuestionPanel (category selector, targetId field, optimistic question list); Hider AnswerPanel (fetches inbox, per-question answer form, answered-count feedback); GameMap handles question_answered WS event via qaRefresh counter; 20 new tests; 833 total pass; build clean |
| 47 | 2026-03-10 | Build frontend hider card panel | src/api.js, src/components/CardPanel.jsx, src/components/CardPanel.test.jsx, src/components/GameMap.jsx, src/components/GameMap.test.jsx | fetchCards/playCardApi API fns; CardPanel (hand display max 6, tap-to-play, effect confirmation, load/play errors, refreshTrigger); wired into GameMap for hiders below AnswerPanel; 15 new tests; 848 total pass; build clean |
| 48 | 2026-03-11 | Fix Vercel 12-function limit | vercel.json, spec/DESIGN.md | Individual api/ adapters already deleted (commit feddf74); updated vercel.json functions glob from api/**/*.js to api/[...path].js; updated DESIGN.md sections 16, 17, 18, 20 to remove stale adapter file references; 848 tests pass; build clean |
| 49 | 2026-03-11 | Hider zone selection | db/schema.sql, db/gameStore.js, functions/gameZone.js, functions/gameZone.test.js, functions/router.js, src/api.js, src/components/ZoneSelector.jsx, src/components/ZoneSelector.test.jsx, src/components/GameMap.jsx, src/components/GameMap.test.jsx | game_zones table; dbSetGameZone/dbGetGameZone; POST /games/:gameId/zone handler; ZoneSelector component (tap-to-select + confirm dialog); GameMap shows ZoneSelector for hiders in hiding phase + handles zone_locked WS event; 880 tests pass; build clean |
| 50 | 2026-03-11 | Question timing enforcement | db/schema.sql, db/gameStore.js, db/gameStore.test.js, functions/questions.js, functions/questions.test.js, server/index.js, server/server.test.js | expires_at column + 'expired' status on questions; dbCreateQuestion enforces one-pending-at-a-time (409 conflict); dbExpireStaleQuestions marks overdue questions; seeking-phase StateDispatcher task expires questions + broadcasts question_expired WS event; 19 new tests; 899 total pass; build clean |
| 52 | 2026-03-11 | Game timer display | server/index.js, functions/questions.js, src/components/GameMap.jsx, server/server.test.js, src/components/GameMap.test.jsx, functions/questions.test.js | timer_sync WS broadcast on phase change + 30 s periodic; question_pending WS notify from submitQuestion; GameMap countdown banner (MM:SS); 16 new tests; 938 total pass; build clean |
| 51 | 2026-03-11 | Photo question support | db/schema.sql, db/gameStore.js, functions/questions.js, functions/questions.test.js, functions/router.js, src/api.js, src/components/AnswerPanel.jsx, src/components/QA.test.jsx | question_photos table; dbSaveQuestionPhoto/dbGetQuestionPhoto; POST+GET /questions/:questionId/photo handlers with in-process store; router updated; AnswerPanel shows file-input for photo questions, reads as base64 via FileReader, uploads before text answer; 23 new tests; 922 total pass; build clean |
| 53 | 2026-03-11 | Post-game results screen | db/schema.sql, db/gameStore.js, db/gameStore.test.js, db/lifecycle.test.js, functions/scores.js, src/api.js, src/components/ResultsScreen.jsx, src/components/ResultsScreen.test.jsx, src/components/CardPanel.jsx, src/components/GameMap.jsx, src/components/Lobby.jsx | bonus_seconds column on scores; ResultsScreen full-screen overlay (winner, elapsed, bonus, final score, Play Again); CardPanel onTimeBonusPlayed callback; GameMap tracks hidingStartedAt + captureWinnerRef; submitScore API fn; Lobby Play Again resets game/playing but keeps player; 15 new tests; 953 total pass; build clean |
| 54 | 2026-03-11 | Leaderboard | db/gameStore.js, functions/scores.js, functions/scores.test.js, functions/router.js, src/api.js, src/components/Leaderboard.jsx, src/components/Leaderboard.test.jsx, src/components/Lobby.jsx | dbGetLeaderboard JOIN query (scores+players+games); GET /scores endpoint with limit+gameId query params; fetchLeaderboard API fn; Leaderboard component (rank, player, scale, MM:SS hiding time); Leaderboard toggle button in Lobby; 24 new tests; 977 total pass; build clean |
| 55 | 2026-03-11 | Two-teams seeker variant | db/schema.sql, db/gameStore.js, db/gameStore.test.js, db/lifecycle.test.js, functions/games.js, server/gameState.js, server/wsHandler.js, server/wsHandler.test.js, server/captureDetector.js, server/captureDetector.test.js, server/index.js, server/gameState.test.js, server/server.test.js, src/api.js, src/components/GameForm.jsx, src/components/WaitingRoom.jsx, src/components/GameMap.jsx, src/components/Lobby.jsx | seeker_teams on games (0=off, 2=two teams); team on game_players (auto-balanced A/B for seekers); team-scoped pending question check; WsHandler team auto-assignment + team-scoped location broadcasts; checkCapture two-team mode (first team all in zone wins); GameMap join_game on open + team-colored markers; GameForm seeker_teams selector; WaitingRoom team display; 15 new tests; 992 total pass; build clean |
| 56 | 2026-03-11 | WebSocket reconnection | server/wsHandler.js, server/wsHandler.test.js, server/index.js, server/server.test.js, server/connection.test.js, server/integration.test.js, src/components/GameMap.jsx, src/components/GameMap.test.jsx | WsHandler 30 s grace period on disconnect; broadcasts player_disconnected immediately then player_left after expiry; cancels timer on rejoin; sends game_state to reconnecting player; broadcasts player_reconnected; reconnectGraceMs createServer param; GameMap exponential backoff (1 s→30 s, 6 attempts); Reconnecting… banner via wsStatus; 12 new tests; 1004 total pass; build clean |
| 57 | 2026-03-11 | Game invite URL | src/components/WaitingRoom.jsx, src/components/GameForm.jsx, src/components/Lobby.jsx, src/components/Lobby.test.jsx | WaitingRoom shows invite link (?gameId=xxx); GameForm accepts initialTab/initialGameId props; Lobby reads ?gameId from URL and activates join tab with pre-filled ID; 3 new tests; 1007 total pass; build clean |
| 58 | 2026-03-11 | Progressive Web App | public/manifest.json, public/sw.js, public/icon-192.svg, public/icon-512.svg, index.html, src/registerSW.js, src/main.jsx, src/pwa.test.js | manifest.json (name, icons, theme colour, standalone); minimal SW (install cache app shell, runtime cache assets, navigate fallback); registerServiceWorker module registered in main.jsx; 5 new tests; 1012 total pass; build clean |

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
- [x] **34** — Document cost-saving strategies in `DESIGN.md` for future reference.

### Phase 10 — Documentation & Knowledge Transfer

- [x] **35** — Finalize `DESIGN.md` with architecture diagrams and explanations.
- [x] **36** — Update `README.md` with setup instructions, API endpoints, and deployment notes.
- [x] **37** — Create `RALPH.md` instructions for future task execution using RALPH loops.
- [x] **38** — Write onboarding guide for new developers to run and extend the project.

### Phase 11 — Production Wiring

- [x] **39** — Wire Vercel API adapters to real Postgres: update `api/players.js`, `api/games/[id].js`, and `api/scores.js` to create a `pg.Pool` from `DATABASE_URL` and pass it to each handler. Use `createPool` from `db/db.js` and call `createTables` on cold start. Handlers already accept an optional pool argument and fall back to in-memory when omitted.

### Phase 12 — Core Gameplay Features

- [x] **40** — Implement zone calculation service: given game bounds and scale, fetch transit stations from the OSM Overpass API and compute hiding zones (circles of 500 m for small/medium, 1 km for large). Expose as `GET /api/zones?bounds=&scale=`. Pure handler in `functions/zones.js`, Vercel adapter in `api/zones.js`.
- [x] **41** — Implement question system API: `POST /api/questions` (submit question), `GET /api/questions?playerId=` (list questions for a player), `POST /api/answers/:questionId` (submit answer). Persist questions/answers in new DB tables. Trigger seeker-notification broadcast via managed server when answer is submitted.
- [x] **42** — Implement challenge card system: Hider Deck with time-bonus, powerup, and curse cards. `GET /api/cards?gameId=&playerId=` returns current hand (max 6). `POST /api/cards/:cardId/play` applies effect. Card draws triggered by question answers via DB layer.
- [x] **43** — Implement proximity / capture detection in the game loop: every tick check all seeker locations against hider hiding zone; when all seekers are within zone radius and off transit, transition phase to `finished`, broadcast winner, persist result, update scores.
- [x] **44** — Build frontend game lobby: player registration form, create/join game form with scale selector and map bounds picker. Wire to existing `/api/players` and `/api/games` endpoints.
- [x] **45** — Build frontend map view: Leaflet + OSM map showing game bounds, hiding zones overlay, live player positions. Location updates throttled to 10–20 s via WebSocket. Redraw only on state changes.
- [x] **46** — Build frontend question/answer UI: seekers see question form with category selector and submit button; hider sees pending questions with answer form and optional photo upload.
- [x] **47** — Build frontend hider card panel: display hand of up to 6 cards; tap to play; show effect confirmation. Wire to `/api/cards` endpoints.

### Phase 13 — Gameplay Completeness

- [x] **48** — Fix Vercel 12-function limit: `api/[...path].js` catch-all was already created and `functions/router.js` already accepts `opts.pool`. Delete the 13 individual `api/` adapter files (`api/players.js`, `api/games/[id].js`, `api/scores.js`, `api/sessions.js`, `api/liveState.js`, `api/admin.js`, `api/zones.js`, `api/questions.js`, `api/answers/[questionId].js`, `api/cards.js`, `api/cards/[cardId]/play.js`, `api/games/index.js`, `api/api.test.js`). Update `vercel.json` functions glob from `api/**/*.js` to `api/[...path].js`. Update DESIGN.md section 17 and 20 to remove stale adapter file references. This is a deployment blocker.

- [x] **49** — Hider zone selection: during the hiding phase the hider must tap a transit station on the map to lock their hiding zone. Add `POST /api/games/:gameId/zone` serverless endpoint (body: `{ stationId, lat, lon, radius }`); persist in a new `game_zones` table column or extend `games`; broadcast `zone_locked` WS event so the game server's `captureDetector` uses the chosen zone instead of a default. Frontend: highlight selectable stations during hiding phase, tap-to-select with confirm dialog, disable re-selection once confirmed.

- [x] **50** — Question timing enforcement: the rules require seekers to wait for the current question to be answered before asking a new one, and the hider must answer within time limits (5 min standard, 10–20 min photo). Add `status` (`pending|answered|expired`) and `expires_at` columns to the `questions` table. `POST /questions` rejects with 409 if a pending question exists for that game. A game-loop StateDispatcher task (or serverless cron) marks questions `expired` when deadline passes and broadcasts a `question_expired` WS event. `GET /questions` returns `status` and `expires_at` so the frontend can show a countdown.

- [x] **51** — Photo question support: photo questions require the hider to upload a photo. Add `POST /api/questions/:questionId/photo` endpoint accepting a base64-encoded image in the JSON body; store in a new `question_photos` table (or a `photo_data` column on `questions`). Add `GET /api/questions/:questionId/photo` to retrieve it. Frontend `AnswerPanel`: when `category === 'photo'`, show a file-input that reads the file as base64 and calls the upload endpoint before submitting the text answer.

- [x] **52** — Game timer display: players need to see how much hiding time remains and, during seeking, how long until each question expires. The game server should broadcast a `timer_sync` WS message on phase change (and periodically, at most every 30 s) containing `{ phaseEndsAt: <ISO timestamp> }`. Frontend `GameMap` receives `timer_sync` and shows a countdown banner: "Hiding ends in 23:47" during hiding, "Question expires in 4:12" when a pending question exists. Derive phase duration from game scale (small: 30 min, medium: 60 min, large: 180 min).

- [x] **53** — Post-game results screen: when the frontend receives `phase_change` → `finished`, display a full-screen results overlay showing: winner (Hider or Seekers), elapsed hiding time, card time-bonuses applied, and final score. Score calculation: base = elapsed seconds hidden; bonus = sum of time_bonus card values played. `POST /api/scores` should accept and persist `bonus_seconds`. Add a "Play Again" button that resets state to the lobby (re-uses same `playerId`).

- [x] **54** — Leaderboard: add `GET /api/scores?limit=20&gameId=` serverless endpoint returning ranked scores with player name and scale; backed by a JOIN across `scores`, `players`, and `games`. Add a leaderboard tab/modal to the lobby frontend showing top scores across all games with columns: rank, player name, scale, hiding time (formatted mm:ss).

- [x] **55** — Two-teams seeker variant: optional gameplay mode where seekers are split into two competing teams. Add a `seeker_teams` config field to game creation (0 = off, 2 = two teams). Game server tracks team membership; questions and location updates are scoped per team; capture is credited to the first team to spot the hider. Frontend lobby shows team assignment on game join.

### Phase 14 — Reliability & UX Polish

- [x] **56** — WebSocket reconnection: when a player's WS connection drops mid-game, the frontend should automatically attempt to reconnect with exponential backoff (1 s, 2 s, 4 s … up to 30 s). Show a "Reconnecting…" banner while disconnected. On reconnect, re-send `join_game` to restore server-side game membership. Server-side: give disconnected players a 30 s grace period before removing them from game state, and broadcast `player_disconnected` (not `player_left`) during the grace window; cancel the timer if the player reconnects. This prevents mid-game reconnects from appearing as a full leave+rejoin to other players.

- [x] **57** — Game invite URL: after a game is created, display a shareable link (e.g. `?gameId=xxx`) that pre-fills the Join tab in the lobby. Parse `?gameId` on page load and activate the Join tab automatically. No backend changes needed — purely frontend.

- [x] **58** — Progressive Web App: add `public/manifest.json` (name, icons, theme colour, `display: standalone`) and a minimal service worker that caches the app shell. Register the service worker in `src/main.jsx`. Allows players to add the game to their home screen on iOS/Android.

- [ ] **59** — Question history: seekers should see all previous Q&A pairs (question text, category, answer, timestamp) above the current question form in `QuestionPanel`. Fetch from `GET /api/questions?gameId=` on mount and refresh after each `question_answered` WS event. No new backend endpoint needed — extend the existing `listQuestions` API fn to accept `gameId`.