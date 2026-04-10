# Integration Testing Specification

## What These Tests Are

Unit tests (`functions/*.test.js`) mock the database and test logic in isolation.
Smoke tests (`scripts/smoke.js`) verify a live deployment is reachable.
Integration tests sit between them: they call the real handler functions with a real
Postgres connection and assert the full handler → SQL → response chain works correctly.

**They must catch bugs that unit tests cannot:**
- Wrong column names or missing columns
- Constraint violations (unique, FK, check)
- SQL logic errors (wrong JOIN, missing WHERE clause)
- `createTables` schema drift from actual handler expectations

Integration tests run after unit tests and before any staging deployment.
A single failure blocks all deploys.

---

## Technology Decisions

All decisions below are final. Do not substitute alternatives without updating this document.

### Test Runner: Vitest (same as unit tests)

**Why:** Vitest is already installed. It has native ESM support matching the project's
`"type":"module"` setup. Using the same runner means one install, consistent globals
(`describe`/`it`/`expect` with no imports), and `npm run test:integration` fits naturally
alongside `npm test`.

**Not chosen:** `node:test` (different API, no watch), `jest` (ESM friction), `mocha`
(third test library when Vitest already exists).

### Invocation Style: Direct handler calls (no HTTP server)

**Why:** Each handler accepts a plain `{ method, params, query, body, headers }` object
and returns `{ status, body }`. The router (`functions/router.js`) already has its own
unit tests covering URL parsing, method routing, 404/405, and rate limiting. The
production routing bugs encountered were Vercel infrastructure bugs (`vercel.json`
rewrites) that no Node.js-level HTTP test could catch.

Direct calls are faster, require no port management, and keep each test focused on
the handler + DB layer, which is the highest-value thing to test.

**Not chosen:** `http.createServer` + fetch (tests router already covered by unit tests,
adds port management), `supertest` (same reasons, extra dependency).

### Database Provisioning: GitHub Actions service container

**Why:** A `postgres:16` service container declared in `ci.yml` is free, ephemeral,
requires zero secrets, tears down automatically, and runs in the same network namespace
as the test job. For local dev, use a local Postgres instance — no additional tooling.

**Not chosen:** `testcontainers` (dependency for what a YAML declaration already provides),
Neon branching (requires secrets, network latency), `pg-mem` (not SQL-compatible enough
to catch real constraint bugs).

### Test Data: Factory helpers (thin wrappers around real handlers)

**Why:** Helpers call the same handler functions tests are validating. If a handler
breaks the DB schema, the factory using it also breaks — surfacing the failure
immediately rather than hiding it behind raw SQL inserts.

**Not chosen:** Raw SQL inserts (verbose, breaks silently when columns change), static
fixtures (fragile when schema evolves).

### Test Isolation: TRUNCATE in `afterAll` per file

**Why:** Deleting rows by ID in `afterEach` requires knowing insertion order and
cascade relationships (games → game_players, questions, answers, cards, game_zones).
`TRUNCATE games, players CASCADE` in `afterAll` is simpler, reliable, and correct for
an ephemeral test database that no other process touches.

**Not chosen:** Per-test `DELETE … WHERE id = $1` (fragile cascade ordering), database
schema-per-test (overkill for this scale).

### Execution Order: Sequential (`maxWorkers: 1`)

**Why:** Test files share the same Postgres database. Concurrent file execution could
cause cross-file interference (e.g., file A truncates while file B is mid-test). With
`maxWorkers: 1` each file runs to completion before the next starts.

---

## Handlers NOT Covered by Integration Tests

Two handler categories cannot be tested with direct calls against the DB:

**`getLiveState` (`functions/liveState.js`)** — This handler does not accept a `pool`
argument. Its second argument is `{ serverUrl?, gsm? }`. Without a running managed
server or an in-process `GameStateManager`, it returns 503. Live state is entirely
in-memory in the managed server; there is nothing DB-backed to test here. It is
already covered by `functions/liveState.test.js` (unit tests) and smoke tests.

**`markReady` / `getReadyStatus` (`functions/games.js`)** — These handlers accept a
pool argument but **never use it**. They read and write the in-process `_readyPlayers`
Map regardless of whether a pool is passed. There is no DB persistence to test.
They are already covered by the existing unit tests.

---

## Repository Layout

```
integration/
  setup.js                       ← pool creation, schema init, teardown, truncate
  helpers.js                     ← factory functions: makePlayer, makeGame, etc.
  01-players.test.js
  02-games.test.js
  03-join-game.test.js
  04-start-game.test.js
  05-questions.test.js
  06-answers.test.js
  07-cards.test.js
  08-zone.test.js
  09-scores.test.js
  10-full-game-flow.test.js
vitest.integration.config.js     ← at project root (NOT inside integration/)
```

Test files are numbered so CI output is readable in sequence.
Each file must be independently runnable:
`vitest run --config vitest.integration.config.js integration/02-games.test.js`

---

## Vitest Config

**`vitest.integration.config.js`** (project root)

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.js'],
    environment: 'node',      // No jsdom — these are server-side tests
    globals: true,            // Same as unit tests: no import needed for describe/it/expect
    testTimeout: 30_000,      // DB calls are slower than in-memory
    maxWorkers: 1,            // Sequential: prevents cross-file interference on shared DB
  },
});
```

> The config must live at the project root so that `include: ['integration/**/*.test.js']`
> resolves correctly relative to the project root. If placed inside `integration/`,
> Vitest resolves the pattern relative to that directory, causing a path mismatch.

---

## npm Scripts

Add to `package.json` `"scripts"`:

```json
"test:integration": "vitest run --config vitest.integration.config.js"
```

Also update `"ci:local"`:

```json
"ci:local": "npm ci && npm test && npm run test:integration && npm run build"
```

---

## Setup Module

**`integration/setup.js`**

```js
import { createPool, createTables } from '../db/db.js';

/**
 * Creates a pg Pool connected to DATABASE_URL and runs createTables.
 * Call in beforeAll. Returns the pool for passing to handlers.
 *
 * @returns {Promise<import('pg').Pool>}
 */
export async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set to run integration tests');
  const pool = createPool(url);
  await createTables(pool);
  return pool;
}

/**
 * Truncates all data tables and ends the pg pool.
 * Call in afterAll. Safe to call on the ephemeral test database only.
 *
 * @param {import('pg').Pool} pool
 */
export async function teardown(pool) {
  // CASCADE drops dependent rows in questions, answers, cards, game_players,
  // game_zones, scores. Order: games first (cascades children), then players.
  await pool.query('TRUNCATE games, players CASCADE');
  await pool.end();
}
```

**Pattern every test file must follow:**

```js
import { setup, teardown } from './setup.js';

let pool;
beforeAll(async () => { pool = await setup(); });
afterAll(async () => { await teardown(pool); });
```

---

## Factory Helpers

**`integration/helpers.js`**

Helpers call the real handler functions (not raw SQL). They throw with a descriptive
message if setup fails so that test failures point to the broken handler, not a
confusing "undefined is not an object" deep in a test.

```js
import { registerPlayer }             from '../functions/players.js';
import { handleCreateGame, joinGame } from '../functions/games.js';
import { lockHiderZone }              from '../functions/gameZone.js';
import { submitQuestion }             from '../functions/questions.js';

/**
 * Register a player. Requires both name and role.
 *
 * @param {import('pg').Pool} pool
 * @param {{ name?: string, role?: 'hider'|'seeker' }} opts
 * @returns {Promise<{ playerId: string, name: string, role: string, createdAt: string }>}
 */
export async function makePlayer(pool, { name = 'Test Player', role = 'hider' } = {}) {
  const res = await registerPlayer({ method: 'POST', body: { name, role } }, pool);
  if (res.status !== 201) throw new Error(`makePlayer failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body; // { playerId, name, role, createdAt }
}

/**
 * Create a game.
 *
 * @param {import('pg').Pool} pool
 * @param {{ size?: string, seekerTeams?: number, playerId?: string|null }} opts
 * @returns {Promise<{ gameId: string, size: string, status: string, seekerTeams: number }>}
 */
export async function makeGame(pool, { size = 'medium', seekerTeams = 0, playerId = null } = {}) {
  const res = await handleCreateGame(
    { method: 'POST', body: { size, bounds: {}, seekerTeams, playerId } },
    pool,
  );
  if (res.status !== 201) throw new Error(`makeGame failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body; // { gameId, size, status, seekerTeams, ... }
}

/**
 * Join a player to a game.
 * NOTE: joinGame returns 200 (not 201) when using a DB pool.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @param {string} playerId
 * @param {'hider'|'seeker'} role
 * @param {'A'|'B'|null} [team]
 */
export async function makeJoin(pool, gameId, playerId, role, team = null) {
  const res = await joinGame(
    { method: 'POST', params: { gameId }, body: { playerId, role, team } },
    pool,
  );
  if (res.status !== 200) throw new Error(`makeJoin failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Lock a hider zone for a game.
 * Suppresses fire-and-forget game-server HTTP calls by passing fetchFn = null.
 *
 * @param {import('pg').Pool} pool
 * @param {string} gameId
 * @param {{ stationId?: string, lat?: number, lon?: number, radiusM?: number }} opts
 */
export async function makeZone(pool, gameId, opts = {}) {
  const res = await lockHiderZone(
    {
      method: 'POST',
      params: { gameId },
      body: {
        stationId: opts.stationId ?? 'test-station-1',
        lat:       opts.lat       ?? 51.5,
        lon:       opts.lon       ?? -0.1,
        radiusM:   opts.radiusM   ?? 200,
        playerId:  opts.playerId  ?? null,
      },
    },
    pool,
    '', // gameServerUrl — empty string suppresses HTTP notification
    null, // fetchFn — null suppresses HTTP notification
  );
  if (res.status !== 201) throw new Error(`makeZone failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Submit a question from one player to another.
 *
 * @param {import('pg').Pool} pool
 * @param {{ gameId: string, askerId: string, targetId: string, category?: string }} opts
 */
export async function makeQuestion(pool, { gameId, askerId, targetId, category = 'thermometer' } = {}) {
  // Pass '', null, null as gameServerUrl / fetchFn / adminApiKey to suppress all
  // managed-server HTTP calls (thermometer, tentacle, matching, transit data fetches).
  // Proximity fields will be null in the persisted question — acceptable for tests.
  const res = await submitQuestion(
    {
      method: 'POST',
      body: { gameId, askerId, targetId, category, text: 'Test question' },
    },
    pool,
    '',   // gameServerUrl
    null, // fetchFn   ← comes before adminApiKey in the actual signature
    null, // adminApiKey
  );
  if (res.status !== 201) throw new Error(`makeQuestion failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}
```

---

## How to Write a Test

Handlers accept `(req, pool)` — or `(req, pool, gameServerUrl, fetchFn)` for handlers
that call the managed server — and return `{ status, body }`. The `req` shape is
`{ method, path?, params?, query?, body?, headers? }`. Only include fields the handler
reads; omit the rest.

```js
// Good — minimal req, direct handler call, assert status + body field
it('creates a game', async () => {
  const res = await handleCreateGame(
    { method: 'POST', body: { size: 'medium', bounds: {}, seekerTeams: 0, playerId: null } },
    pool,
  );
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('waiting');
  expect(res.body.gameId).toMatch(/^[0-9a-f-]{36}$/); // response uses 'gameId', not 'id'
});

// Good — use helpers for prerequisite state
it('seeker can join a game', async () => {
  const player = await makePlayer(pool, { role: 'seeker' });
  const game   = await makeGame(pool);
  const res = await joinGame(
    { method: 'POST', params: { gameId: game.gameId }, body: { playerId: player.playerId, role: 'seeker' } },
    pool,
  );
  expect(res.status).toBe(200); // NOTE: joinGame returns 200 with pool, not 201
});

// Bad — do not mock the pool or any DB function
// Bad — do not import from pg and write raw SQL inserts
// Bad — do not start an http server
// Bad — do not use 'id' where the response shape says 'gameId' or 'playerId'
```

---

## Handler Signatures Reference

Some handlers take extra arguments beyond `(req, pool)`. Always suppress managed-server
HTTP calls in integration tests by passing the arguments below:

| Handler | Actual signature | Integration test call |
|---|---|---|
| `registerPlayer` | `(req, pool)` | No change |
| `handleCreateGame` | `(req, pool)` | No change |
| `getGame` | `(req, pool)` | No change |
| `joinGame` | `(req, pool)` | No change |
| `handleStartGame` | `(req, pool, gameServerUrl, fetchFn)` | Pass `''`, `null` — empty `gameServerUrl` makes `notifyGameStart` early-return |
| `lockHiderZone` | `(req, pool, gameServerUrl, fetchFn)` | Pass `''`, `null` — suppresses both fire-and-forget POSTs to managed server |
| `submitQuestion` | `(req, pool, gameServerUrl, fetchFn, adminApiKey)` | Pass `''`, `null`, `null` — note `fetchFn` comes **before** `adminApiKey` |
| `submitAnswer` | `(req, pool, gameServerUrl, fetchFn)` | Pass `''`, `null` |
| `playCard` | `(req, pool, gameServerUrl, fetchFn)` | Pass `''`, `null` — suppresses time_bonus, false_zone, curse_active notifications |
| `getCards` | `(req, pool)` | No change |
| `submitScore` | `(req, pool)` | No change |
| `getLeaderboard` | `(req, pool)` | No change |

---

## Response Field Names (Common Pitfalls)

The DB-backed responses use these field names. Always check `db/gameStore.js` return
values rather than assuming the field names match what the in-process fallback returns.

| Handler | Field to use | Common mistake |
|---|---|---|
| `registerPlayer` | `body.playerId` | Using `body.id` |
| `handleCreateGame` | `body.gameId` | Using `body.id` |
| `getCards` | `body.hand` (array) | Using `body.cards` — this field does not exist |
| `getCards` card item | `card.cardId` (from DB) | Using `card.id` |
| `submitScore` | `body.scoreId` | Using `body.id` |
| `getGame` | `body.gameId`, `body.players` | Using `body.id` |
| `joinGame` | returns 200 with pool | Expecting 201 |
| `submitQuestion` | 5th arg is `adminApiKey` | Swapping arg order with `fetchFn` |

---

## Test Scenarios

### 01 — Player Registration (`functions/players.js` → `registerPlayer`)

```
✓ valid name + role='hider' → 201, body has playerId (UUID), name, role, createdAt
✓ valid name + role='seeker' → 201
✓ missing name → 400
✓ missing role → 400
✓ invalid role (e.g. 'admin') → 400
✓ two registrations → unique playerId values
```

> `registerPlayer` validates both `name` and `role`. The role field is stored on the
> response body but NOT persisted to the `players` table — it is only meaningful within
> a `game_players` record created by `joinGame`. Do not assert `role` is retrievable
> by fetching the player from the DB.

---

### 02 — Game Creation & Retrieval (`functions/games.js`)

```
handleCreateGame
  ✓ defaults (no body) → 201, status='waiting', size='medium', seekerTeams=0
  ✓ size='large', seekerTeams=2 → 201, fields persisted correctly
  ✓ invalid size (e.g. 'huge') → 400
  ✓ seekerTeams=1 (not 0 or 2) → 400
  ✓ unknown playerId → 201 (host_player_id is advisory, no FK constraint)

getGame (params: { id: gameId })
  ✓ existing gameId → 200, body.gameId matches, body.status='waiting'
  ✓ non-existent gameId → 404
```

> `handleCreateGame` returns `{ gameId, size, bounds, status, seekerTeams, hostPlayerId, createdAt }`.
> Use `res.body.gameId` (not `res.body.id`) in all assertions and when passing to helpers.

---

### 03 — Join Game (`functions/games.js` → `joinGame`)

```
✓ player joins as hider → 200 (NOTE: pool path returns 200, not 201)
✓ second player joins same game as seeker → 200
✓ same player joins same game twice → 200, idempotent (returns existing record)
✓ invalid role ('referee') → 400
✓ missing playerId → 400
✓ two-team mode: seeker joins with team='A' → 200, team field persisted

Prerequisite for each test: call makePlayer + makeGame before joining.
```

> `joinGame` is explicitly documented as idempotent: calling it twice for the same
> (gameId, playerId) pair returns the existing record with 200, NOT 409.
> There is no unique constraint enforcement returning 409 — the DB upserts.

---

### 04 — Start Game (`functions/games.js` → `handleStartGame`)

```
Setup: makePlayer(hider) + makePlayer(seeker) + makeGame + makeJoin(hider) +
       makeJoin(seeker) + makeZone (zone MUST exist before calling start)

✓ all preconditions met → 204 (no body content expected)
✓ no hider in game → 400, body.error='insufficient_players'
✓ no seeker in game → 400, body.error='insufficient_players'
✓ hider zone not locked → 400, body.error='no_hider_zone'
```

> IMPORTANT: `handleStartGame` does NOT update the game's status in the database.
> The serverless function only validates preconditions and sends a fire-and-forget
> notification to the managed server. The `waiting → hiding` status transition is
> performed by the managed game server's in-memory state machine. Do NOT assert
> `getGame` returns `status='hiding'` after calling `handleStartGame`.
>
> Always call `handleStartGame(req, pool, '', null)` — the empty string suppresses
> the `notifyGameStart` HTTP call (falsy `serverUrl` → early return).
>
> The handler has no duplicate-start protection: calling it twice with all
> preconditions met returns 204 both times.

---

### 05 — Questions (`functions/questions.js` → `submitQuestion`, `listQuestions`)

```
Setup: makePlayer(seeker) + makePlayer(hider) + makeGame + makeJoin(both)

submitQuestion
  ✓ category='thermometer' → 201, question persisted with expires_at
  ✓ category='matching'    → 201
  ✓ category='measuring'   → 201
  ✓ category='transit'     → 201
  ✓ category='tentacle'    → 201
  ✓ category='photo'       → 201, expires_at is further in the future than non-photo
                             (photo expiry varies by game size; use size='medium' → 15 min)
  ✓ invalid category ('flavour') → 400
  ✓ missing gameId → 400
  ✓ missing text → 400
  ✓ second question while first is still pending → 409 (one-pending-at-a-time rule)
  ✓ question while curse is active → 409, body.error='curse_active'

listQuestions (query: { playerId })
  ✓ returns questions where target_id = playerId
  ✓ different playerId → empty list (no cross-contamination)
```

> All question categories except photo trigger fire-and-forget fetches to the managed
> server. Pass `gameServerUrl=''` and `fetchFn=null` as the 3rd and 4th args to
> suppress these. Proximity fields will be null, which is fine for integration tests.
> The question is still created and persisted.
>
> Signature (argument order matters): `submitQuestion(req, pool, gameServerUrl, fetchFn, adminApiKey)`
> Note: `fetchFn` comes **before** `adminApiKey` — the opposite of what might be expected.

---

### 06 — Answers (`functions/questions.js` → `submitAnswer`)

```
Setup: makePlayer(seeker) + makePlayer(hider) + makeGame + makeJoin(both)
       + makeQuestion (creates a pending question)

submitAnswer
  ✓ pending question → 200, question status becomes 'answered'
  ✓ answer text is persisted and visible in listQuestions response
  ✓ non-existent questionId → 404
  ✓ already-answered question → 409

Side effect: submitting an answer draws a card for the seeker (if game/player
records exist). Verify the card appears in getCards after answering.

Signature: submitAnswer(req, pool, gameServerUrl, fetchFn)
Pass '' and null to suppress game-server notification.
```

---

### 07 — Cards (`functions/cards.js` → `getCards`, `playCard`)

```
Setup: full setup through submitAnswer (cards are drawn when an answer is submitted).
       makePlayer(seeker) + makePlayer(hider) + makeGame + makeJoin(both)
       + makeQuestion + submitAnswer(pool, '', null)

getCards (query: { gameId, playerId })
  ✓ seeker who received a drawn card → 200, body.hand is a non-empty array
  ✓ player with no cards → 200, body.hand is []

NOTE: response body shape is { gameId, playerId, hand } — field is 'hand', NOT 'cards'.

playCard (params: { cardId }, body: { playerId })
  ✓ card in hand → 200, card.status='played'
  ✓ curse card played → 200, game.curse_expires_at is set in the games table
  ✓ non-existent cardId → 404
  ✓ card belonging to a different player → 404 (NOT 403 — handler returns same
    'card not found or already played' message for both wrong-player and not-found)
  ✓ already-played card → 404 (NOT 409 — handler returns 404 for all invalid
    card states: not found, wrong player, already played)
```

> Cards are NOT created independently — they are drawn as a side effect of
> `submitAnswer`. Do not insert cards via raw SQL; use the answer flow to set up state.
>
> `playCard` signature: `(req, pool, gameServerUrl, fetchFn)` — pass `''`, `null`
> to suppress time_bonus, false_zone, and curse_active notifications to managed server.

---

### 08 — Zone Locking (`functions/gameZone.js` → `lockHiderZone`)

```
Setup: makePlayer + makeGame (no special game status required — the handler
       does NOT validate game phase or player role)

lockHiderZone (params: { gameId }, body: { stationId, lat, lon, radiusM, playerId? })
  ✓ valid body → 201, zone persisted to game_zones table
  ✓ missing stationId → 400
  ✓ non-numeric lat or lon → 400
  ✓ radiusM <= 0 → 400
  ✓ second lock for same game → overwrites (game_zones has UNIQUE on game_id)

Always call: lockHiderZone(req, pool, '', null)
— the empty gameServerUrl and null fetchFn suppress both fire-and-forget HTTP calls.
```

> IMPORTANT: `lockHiderZone` does NOT check game status (waiting, hiding, etc.) and
> does NOT check whether the calling player is the hider. Both of these are enforced
> only by the managed game server, not the serverless handler. Do not write tests
> asserting 400 for 'wrong phase' or 403 for 'wrong role' — those assertions will fail.

---

### 09 — Scores (`functions/scores.js` → `submitScore`, `getLeaderboard`)

```
Setup: makePlayer + makeGame (scores have FK references to both)

submitScore (body: { playerId, gameId, hidingTimeMs, captured, bonusSeconds? })
  ✓ valid body, captured=false → 201, body has scoreId, hidingTimeMs, captured=false
  ✓ valid body, captured=true → 201, captured_at is non-null in DB
  ✓ bonusSeconds provided → 201, persisted correctly
  ✓ missing hidingTimeMs → 400
  ✓ captured is not boolean → 400
  ✓ duplicate (same playerId + gameId) → DB unique constraint violation;
    expect either 409 or a thrown error depending on dbSubmitScore error handling.
    Test by calling submitScore twice and asserting the second call does not return 201.

getLeaderboard (query: { gameId, limit? })
  ✓ after submitting scores → 200, body.scores is an array with rank, playerName, scale
  ✓ gameId filter returns only scores for that game
  ✓ limit param is respected
```

> `submitScore` body uses `hidingTimeMs` (milliseconds). The DB stores `score_seconds`
> (converted by `Math.round(hidingTimeMs / 1000)`). The response body echoes back
> `hidingTimeMs` (not converted), so assert the original value, not seconds.

---

## Full Game Flow (`integration/10-full-game-flow.test.js`)

A single sequential `describe` block. Steps share state via outer `let` variables.
This test catches state corruption across operations and verifies the overall
integration path.

```
const state = {};

Step 01: registerPlayer({ body: { name:'Alice', role:'hider'  } }, pool) → state.hider
Step 02: registerPlayer({ body: { name:'Bob',   role:'seeker' } }, pool) → state.seeker
Step 03: handleCreateGame({ body: { size:'medium', ... } }, pool)        → state.game
         // state.game.gameId is the key used in all subsequent calls
Step 04: joinGame({ params:{gameId}, body:{playerId:hider.playerId,  role:'hider'  } }, pool) → 200
Step 05: joinGame({ params:{gameId}, body:{playerId:seeker.playerId, role:'seeker' } }, pool) → 200
Step 06: lockHiderZone({ params:{gameId}, body:{stationId,lat,lon,radiusM} }, pool, '', null)
         → state.zone  (MUST precede start — handleStartGame checks for zone)
Step 07: handleStartGame({ params:{gameId}, body:{} }, pool, '', null) → 204
         assert: getGame({ params:{id:gameId} }, pool).body.status === 'waiting'
         (DB status is NOT changed by the serverless function)
Step 08: submitQuestion({ body:{gameId, askerId:seeker.playerId,
                                targetId:hider.playerId, category:'thermometer',
                                text:'Are you closer?'} }, pool, '', null, null)
         → state.question
Step 09: submitAnswer({ params:{questionId}, body:{responderId:hider.playerId, text:'Yes'} },
                      pool, '', null)
         → 200, question.status='answered'
Step 10: getCards({ method:'GET', query:{gameId, playerId:seeker.playerId} }, pool)
         → 200, body.hand non-empty → state.card = body.hand[0]
Step 11: playCard({ params:{cardId:state.card.cardId}, body:{playerId:seeker.playerId} },
                  pool, '', null)
         → 200, card.status='played'
Step 12: submitScore({ body:{playerId:hider.playerId,  gameId, hidingTimeMs:300000,
                             captured:true, bonusSeconds:0} }, pool) → 201
Step 13: submitScore({ body:{playerId:seeker.playerId, gameId, hidingTimeMs:300000,
                             captured:false, bonusSeconds:0} }, pool) → 201
Step 14: getLeaderboard({ method:'GET', query:{gameId} }, pool)
         → 200, body.scores has 2 entries, both player names present
```

Cleanup in `afterAll`: call `teardown(pool)` which truncates all tables.

---

## CI Pipeline Changes

Modify `.github/workflows/ci.yml` as follows.

**Add this job after the `test` job:**

```yaml
integration-test:
  name: Integration tests
  needs: test
  runs-on: ubuntu-latest

  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_USER: jetlag
        POSTGRES_PASSWORD: jetlag
        POSTGRES_DB: jetlag_test
      ports:
        - 5432:5432
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5

  steps:
    - uses: actions/checkout@v4

    - name: Set up Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run integration tests
      run: npm run test:integration
      env:
        DATABASE_URL: postgresql://jetlag:jetlag@localhost:5432/jetlag_test
        GAME_SERVER_URL: ''
        ADMIN_API_KEY: ''
```

**Update `deploy-staging-serverless` and `deploy-staging-server`:**

Change `needs: test` → `needs: [test, integration-test]` on both jobs.

Production deploy jobs (`deploy-serverless`, `deploy-server`) already depend on
`smoke-test` → staging deploys, so they are automatically gated by integration tests
without further changes.

---

## Out of Scope

Do not add integration tests for these:

- **`getLiveState`** — not DB-backed; requires a running managed server or in-process
  `GameStateManager`. Already covered by unit tests and smoke tests.
- **`markReady` / `getReadyStatus`** — in-memory only even when pool is passed. No DB
  persistence to test. Already covered by unit tests.
- **`cleanupStaleGames`** — admin-only; requires `Authorization` header with `ADMIN_API_KEY`.
  Functionally a DELETE with an age filter; low-risk to defer.
- **Photo upload/download** (`uploadQuestionPhoto`, `getQuestionPhoto`) — binary blob
  handling; add after text-based flow is stable.
- **WebSocket / managed game server** (`server/`) — separate process with its own state
  machine; out of scope for serverless integration tests.
- **Rate limiter under load** — belongs in a dedicated load-test suite.
- **Vercel routing** (`vercel.json` rewrites) — infrastructure config; not testable in
  a Node.js process; covered by smoke tests against the live deployment.
