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

