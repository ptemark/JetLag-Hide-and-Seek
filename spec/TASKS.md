# TASKS

Track implementation progress for the Jet Lag project. Each task is one RALPH loop iteration.
See `RALPH.md` for the loop process and `DESIGN.md` for all design decisions.

---

## Current Task

_None in progress. Last completed: Task 13._

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
- [ ] **14** — Implement basic heartbeat/ping system to keep connections alive and detect disconnects.
- [ ] **15** — Write tests for connection reliability and message delivery.

### Phase 5 — Game Loop Infrastructure

- [ ] **16** — Implement skeleton game loop logic on managed servers (without specific rules yet).
- [ ] **17** — Add state update dispatcher: takes current game state and triggers serverless tasks for computation.
- [ ] **18** — Implement start/stop hooks for game loop to spin down managed servers when idle.
- [ ] **19** — Create logging mechanism to track loop iterations, errors, and performance metrics.

### Phase 6 — API & Admin Tools

- [ ] **20** — Implement serverless API endpoints for retrieving live game state.
- [ ] **21** — Build basic admin dashboard to view active sessions, connected players, and loop health.
- [ ] **22** — Add authentication/authorization for admin access.
- [ ] **23** — Add rate limiting and error handling for API endpoints.

### Phase 7 — Analytics & Monitoring

- [ ] **24** — Integrate logging/monitoring services (CloudWatch, Datadog, or equivalent) for both serverless and managed components.
- [ ] **25** — Track metrics like active connections, loop iterations per minute, and database reads/writes.
- [ ] **26** — Implement alerting for failure scenarios (server crashes, DB errors, connection drops).

### Phase 8 — Testing & CI/CD

- [ ] **27** — Add unit tests for serverless functions and managed game loop logic.
- [ ] **28** — Add integration tests to simulate multiple players connecting, updating state, and disconnecting.
- [ ] **29** — Set up CI/CD pipeline to run tests and deploy both serverless and managed components.
- [ ] **30** — Add staging environment to validate system behavior before production deployment.

### Phase 9 — Optimization & Cost Management

- [ ] **31** — Implement auto-scaling for managed servers based on activity.
- [ ] **32** — Optimize serverless functions to reduce invocation costs (minimal memory, short execution).
- [ ] **33** — Implement full shutdown option to reduce idle costs to zero.
- [ ] **34** — Document cost-saving strategies in `DESIGN.md` for future reference.

### Phase 10 — Documentation & Knowledge Transfer

- [ ] **35** — Finalize `DESIGN.md` with architecture diagrams and explanations.
- [ ] **36** — Update `README.md` with setup instructions, API endpoints, and deployment notes.
- [x] **37** — Create `RALPH.md` instructions for future task execution using RALPH loops.
- [ ] **38** — Write onboarding guide for new developers to run and extend the project.