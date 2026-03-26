# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test              # Run all tests once (Vitest)
npm run test:watch   # Run tests in watch mode
npm run dev          # Start Vite dev server (frontend only)
npm start            # Start managed game server (server/start.js)
npm run build        # Production build (Vite → dist/)
npm run smoke        # Run basic smoke tests against a live URL
npm run ci:local     # Full CI check: npm ci && npm test && npm run build
```

To run a single test file:
```bash
npx vitest run src/components/GameMap.test.jsx
npx vitest run --reporter=verbose functions/games.test.js
```

## Architecture

JetLag is a mobile-first hide-and-seek game with a **hybrid serverless + managed server** architecture designed for $0 idle cost.

```
React SPA (Vite)
    │
    ├── REST calls ──→ Vercel Serverless Functions (/api/[...path].js → /functions/)
    │                        │
    │                        └── Postgres (Neon) — pauses when idle
    │
    └── WebSocket ──→ Managed Game Server (Docker container, /server/)
                             │
                             └── In-memory game state + DB sync at checkpoints
```

### Four Distinct Layers

**1. Frontend SPA (`/src`)** — React 18 + Vite
- React hooks only (no Redux/Zustand)
- CSS Modules + CSS custom properties (no CSS-in-JS, hard constraint)
- Leaflet + react-leaflet + OpenStreetMap for maps (free, no per-request cost)
- Component tests use `@testing-library/react` (behavior-focused, not implementation)

**2. Serverless Functions (`/functions` + `/api`)** — Node.js, deployed to Vercel
- `/api/[...path].js` is the Vercel catch-all adapter; it lazy-initializes the DB pool and delegates to `/functions/router.js`
- Handles REST API: player registration, game CRUD, scores, questions, cards, zone queries
- Fixed-window rate limiting (100 req/60s per IP) in `/functions/rateLimiter.js`
- Token auth middleware in `/functions/auth.js`

**3. Managed Game Server (`/server`)** — Long-running Node.js WebSocket server in Docker
- Starts on first WebSocket connection; auto-shuts down after idle timeout (saves cost)
- Tick-based game loop per game instance (`/server/gameLoop.js`)
- In-memory game state (`/server/gameState.js`) — multiple active games managed by `gameLoopManager.js`
- Zone capture and proximity math (Thermometer, Tentacle, Measuring questions) in `captureDetector.js`
- State broadcast via `stateDispatcher.js`

**4. Database (`/db`)** — Serverless Postgres (Neon recommended)
- Schema: `players`, `games`, `game_players`, `questions`, `scores`
- `/db/db.js` — pool creation + table initialization
- `/db/gameStore.js` — CRUD wrapper
- `/db/schema.sql` — DDL source of truth

### Key Configuration

- **`/config/env.js`** — typed env vars for both browser (Vite) and Node.js contexts; single source for all environment access
- **`/config/gameRules.js`** — game constants (scale durations, card draw weights, zone radii)
- **`/.env.example`** — comprehensive template with all variables documented

### Development Specification

- **`/spec/DESIGN.md`** — architecture decisions and hard constraints
- **`/spec/TASKS.md`** — task backlog (RALPH-driven incremental development)
- **`/spec/RULES.md`** — game rulebook
- **`/RALPH.md`** — autonomous development agent configuration; all new work should be task-driven and match the spec

### Test Setup

Vitest with jsdom; global `describe`/`it`/`expect` (no imports needed). Setup file at `/src/test-setup.js` provides a working localStorage mock (jsdom's built-in is broken). DB tests create temporary tables for isolation; server tests mock WebSocket and DB.

### CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs: test → build → deploy staging (Vercel preview + Docker → GHCR) → smoke test → deploy production.
