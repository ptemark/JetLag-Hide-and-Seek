# Onboarding Guide — JetLag: The Game

Welcome to the project. This guide gets a new developer from zero to a running local environment, explains the codebase structure, and shows how to add new features safely.

---

## 1. What You Are Working On

JetLag is a mobile-first, real-world hide-and-seek game built on a **$0 idle cost** serverless stack:

| Tier | Technology | Cost when idle |
|------|-----------|---------------|
| Frontend SPA | React + Vite → Vercel CDN | $0 |
| API endpoints | Vercel Serverless Functions | $0 |
| Database | Neon serverless Postgres | $0 (pauses) |
| Game loop + WebSocket | Docker container (on-demand) | $0 (stops) |

The managed container spins up when the first player connects and shuts itself down when the last game ends. Everything else is stateless.

Before reading further, skim these three documents:

- [`spec/DESIGN.md`](../spec/DESIGN.md) — architecture, data model, cost rules
- [`spec/RULES.md`](../spec/RULES.md) — game rules (important for game logic tasks)
- [`README.md`](../README.md) — setup commands, API endpoint reference

---

## 2. Prerequisites

Install these before starting:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org or `nvm install 18` |
| npm | ≥ 9 (bundled with Node 18) | — |
| Git | any recent | — |
| Docker | any recent | https://docs.docker.com/get-docker/ |
| Vercel CLI | latest | `npm i -g vercel` |

Optional but recommended:

- [Neon](https://neon.tech) account for a real Postgres database
- [GitHub CLI](https://cli.github.com) (`gh`) for watching CI runs

---

## 3. First-Time Local Setup

```bash
# Clone the repo
git clone https://github.com/ptemark/JetLag-Hide-and-Seek.git
cd JetLag-Hide-and-Seek

# Install all dependencies
npm install

# Copy the environment template
cp .env.example .env.development
# Edit .env.development — the only required change for local dev is leaving
# DATABASE_URL empty (tests use in-memory fakes) and VITE_API_BASE_URL as-is.

# Verify everything works
npm run ci:local
# Expected output: 655 tests pass, build succeeds
```

If `npm run ci:local` is green you are ready to develop.

---

## 4. Day-to-Day Development Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Vite dev server at http://localhost:5173 |
| `npm test` | Run all tests once (Vitest) |
| `npm run test -- --watch` | Re-run tests on file change |
| `npm run build` | Production build to `dist/` |
| `npm run ci:local` | Full CI gate: `npm ci && npm test && npm run build` |

**Always run `npm run ci:local` before pushing.** The GitHub Actions pipeline runs the same checks; catching failures locally is faster.

---

## 5. Project Map

Understanding which directory owns which concern prevents misplaced code.

```
src/            Frontend React SPA (not yet implemented beyond scaffold)
api/            Thin Vercel adapter files — one per route, ≤ 6 lines each
                These just create a DB pool and delegate to functions/
functions/      All serverless handler logic (pure functions, easily testable)
server/         Managed game-loop container (Node.js + ws)
db/             Database schema, pool factory, and all CRUD operations
config/         Typed ENV object validated at startup
scripts/        Utility scripts (smoke tests for staging)
spec/           Source of truth: DESIGN.md, TASKS.md, RULES.md
docs/           Long-form documentation (you are here)
.github/        CI/CD workflow
```

### Where does my new code go?

| What you are adding | Where |
|--------------------|-------|
| New REST endpoint | `functions/<name>.js` (handler) + `api/<name>.js` (adapter) + route in `functions/router.js` |
| New real-time feature | `server/wsHandler.js` (message type) + `server/gameState.js` if state changes |
| New game phase logic | `server/gameLoopManager.js` |
| New DB table or query | `db/schema.sql` (DDL) + `db/gameStore.js` (query functions) |
| New frontend page | `src/` |
| New environment variable | `config/env.js` + `.env.example` |

---

## 6. Architecture in 90 Seconds

### Serverless tier (stateless, $0 idle)

The browser calls REST endpoints at `/api/*`. Each `api/*.js` file is a Vercel adapter (≤ 6 lines) that creates a Postgres pool on cold start and delegates to a pure handler in `functions/`. The pure handler does the work and returns a plain object. The router (`functions/router.js`) handles HTTP method dispatch and applies rate limiting.

```
Browser → POST /api/players
              └── api/players.js          (Vercel adapter, creates pool)
                    └── functions/players.js → registerPlayer()
                          └── db/gameStore.js → dbCreatePlayer()
                                └── Neon Postgres
```

### Managed container (stateful, on-demand)

The game loop runs in a Docker container (`server/`). It starts when the first player opens a WebSocket connection and stops itself after the last game ends. In-memory state lives in `GameStateManager`; durable state lives in Postgres.

```
Browser ──WSS──► server/wsHandler.js
                    ├── server/gameState.js    (in-memory hot state)
                    ├── server/gameLoopManager.js (phase ticks)
                    └── db/gameStore.js         (durable writes)
```

The serverless tier can proxy live state from the container via `/internal/state/:gameId` and `/internal/admin` when `GAME_SERVER_URL` is set.

### Key lifecycle rule

`GameLoopManager` fires `onIdle()` when the last active game is removed. This triggers `ShutdownManager`, which waits `IDLE_SHUTDOWN_DELAY_MS` milliseconds and then calls `process.exit(0)`. The orchestrator restarts the container on the next WebSocket connection.

---

## 7. Testing Conventions

- **Framework:** [Vitest](https://vitest.dev)
- **Every new file must have a corresponding `*.test.js`** covering the public interface.
- Tests must not make real network or database calls. Use the injectable dependency pattern already established in the codebase (pass a mock pool/store/logger as a parameter).
- Integration tests in `server/integration.test.js` spin up a real in-process server on a random port — this is the only acceptable place for real I/O in tests.

### Running a single test file

```bash
npx vitest run server/gameLoopManager.test.js
```

### Inspecting test coverage gaps

```bash
npx vitest run --coverage
```

---

## 8. Adding a New Serverless Endpoint — Step by Step

Example: adding `GET /api/zones?gameId=<id>`.

1. **Write the pure handler** in `functions/zones.js`:

   ```js
   export async function getZones(pool, gameId) {
     // query db or return computed zones
   }
   ```

2. **Write tests** in `functions/zones.test.js` using a mock pool.

3. **Add the route** in `functions/router.js`:

   ```js
   if (method === 'GET' && path === '/zones') {
     return getZones(pool, query.gameId);
   }
   ```

4. **Create the Vercel adapter** in `api/zones.js` (copy the pattern from `api/players.js`):

   ```js
   import { router } from '../functions/router.js';
   import { getPool } from './_pool.js'; // shared pool helper
   export default (req, res) => router(req, res, getPool());
   ```

5. **Run** `npm run ci:local` — all tests must pass before committing.

---

## 9. Adding a New WebSocket Message Type — Step by Step

Example: adding a `ping_location` message that the server broadcasts back.

1. **Add the handler** in `server/wsHandler.js` inside `handleMessage()`:

   ```js
   case 'ping_location':
     this.broadcastToGame(data.gameId, { type: 'pong_location', ...data });
     break;
   ```

2. **Write tests** in `server/wsHandler.test.js` using the existing mock ws pattern.

3. **Document the message type** in `README.md` under the WebSocket Protocol section.

4. **Run** `npm run ci:local`.

---

## 10. Environment Variables

All variables are defined in `.env.example` with descriptions. The typed `ENV` object in `config/env.js` validates required variables at startup — if a required variable is missing the server refuses to start with a clear error.

To add a new variable:

1. Add it to `config/env.js` with a type cast and default.
2. Add it to `.env.example` with a comment.
3. Add a test in `config/env.test.js` for the new field.
4. Document it in `README.md` if it affects deployment.

Never hard-code configuration values. Never commit `.env.*` files (they are gitignored).

---

## 11. The RALPH Development Loop

This project is built one task at a time by the RALPH agent (see [`RALPH.md`](../RALPH.md)). If you are contributing manually:

1. Pick the next `[ ]` task from `spec/TASKS.md`.
2. Mark it `[~]` (in progress).
3. Implement it, including tests.
4. Run `npm run ci:local` — fix any failures.
5. Mark it `[x]` and append a row to the Completed Tasks Log.
6. Commit with the format: `<type>(scope): description`.

Do not skip tasks out of order unless you understand the dependency graph. Do not modify `spec/DESIGN.md` without an explicit spec-change task.

---

## 12. Deployment Checklist

Before asking for a review or merging:

- [ ] `npm run ci:local` passes (655+ tests, clean build)
- [ ] No secrets in staged files (`git diff --staged`)
- [ ] New env vars added to `.env.example` and `config/env.js`
- [ ] New endpoints documented in `README.md`
- [ ] Commit message follows `<type>(scope): description` format

The GitHub Actions pipeline (`.github/workflows/ci.yml`) runs automatically on push and must stay green before any further work starts.

---

## 13. Getting Help

| Resource | Location |
|----------|----------|
| Architecture overview | [`spec/DESIGN.md`](../spec/DESIGN.md) |
| Game rules | [`spec/RULES.md`](../spec/RULES.md) |
| Task backlog | [`spec/TASKS.md`](../spec/TASKS.md) |
| API reference | [`README.md`](../README.md) |
| Database schema | [`docs/DATABASE.md`](DATABASE.md) |
| Architecture deep-dive | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| RALPH agent config | [`RALPH.md`](../RALPH.md) |
