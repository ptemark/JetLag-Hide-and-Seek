# JetLag: The Game

A mobile-first, serverless hide-and-seek game using zones around transit stations, challenge cards, and real-time location updates.

## Overview

JetLag is a real-world transit hide-and-seek game where:
- **Hiders** travel via public transit and hide within a zone around their final station.
- **Seekers** ask questions to deduce the hider's location and find them before time runs out.

See [`spec/RULES.md`](spec/RULES.md) for the full rulebook and [`spec/DESIGN.md`](spec/DESIGN.md) for architecture decisions.

## Architecture

```
Frontend SPA (React + Vite) → static hosting ($0 idle)
      |
      v
Serverless Functions (game creation, questions, zones, leaderboards)
      |
      v
Database (serverless Postgres, $0 idle)
      ^
      |
Managed Game Loop / WebSocket Container (on-demand, shuts down when idle)
```

- **Idle cost:** $0 (serverless + paused DB + spun-down container)
- **Maps:** OpenStreetMap (OSM) preferred
- **Location updates:** throttled 10–20s for battery efficiency

## Project Structure

```
src/           # Frontend SPA (React + Vite)
functions/     # Serverless endpoint handlers
docs/          # Additional documentation
config/        # Environment and deployment configuration
spec/          # Design docs, task list, and rulebook
```

## Development

```bash
npm install      # Install dependencies
npm run dev      # Start development server
npm run build    # Production build
npm run test     # Run tests
```

## Game Scales

| Scale  | Area              | Hiding Period | Zone Radius |
|--------|-------------------|---------------|-------------|
| Small  | City/town         | 30–60 min     | 500 m       |
| Medium | Large city/metro  | 60–180 min    | 500 m       |
| Large  | Region/country    | 180+ min      | 1 km        |

## Contributing

This project is built incrementally using **RALPH** (Recursive Autonomous Loop for Project Handling). See [`RALPH.md`](RALPH.md) for the development process and [`spec/TASKS.md`](spec/TASKS.md) for the task backlog.

## License

MIT — see [LICENSE](LICENSE).
