# Database Decision — JetLag: The Game

## Decision

**Chosen database: PostgreSQL via [Neon](https://neon.tech) (serverless)**

---

## Rationale

| Criterion              | Requirement                              | Neon Postgres                                   |
|------------------------|------------------------------------------|-------------------------------------------------|
| Idle cost              | $0 when no games are active              | Compute autoscales to zero; storage billed only |
| Serverless-compatible  | Works from stateless functions           | Yes — standard `pg` driver, connection pooling  |
| Schema / relational    | Players, sessions, game state, scores    | Full PostgreSQL — relations, constraints, JSON  |
| $0 local dev           | No always-on local server required       | Free tier; local dev via connection string      |
| Standard SQL           | Interoperable, easy to migrate           | Standard PostgreSQL 16                          |
| Scaling                | Handle concurrent games without ops work | Neon auto-scales compute per branch/project     |

### Why not DynamoDB?
- NoSQL requires denormalized design for the relational game model (players ↔ games ↔ scores).
- Costs more to query at low volume than Postgres at zero compute.

### Why not Supabase?
- Supabase Postgres is good but the free tier does not scale to zero compute.
- Neon's autoscale-to-zero is a better fit for the $0 idle requirement.

### Why not Aurora Serverless v2?
- Aurora is production-grade but has a minimum ACU (cost even at idle) unless paused manually.
- Neon provides equivalent serverless semantics with zero ops overhead for this project scale.

---

## Connection

All tiers connect via a single `DATABASE_URL` environment variable:

```
DATABASE_URL=postgresql://user:password@host/jetlag?sslmode=require
```

- **Serverless functions** (`functions/`) read `process.env.DATABASE_URL`.
- **Managed game server** (`server/`) reads the same variable for checkpoint writes.
- **Browser SPA** never has access to `DATABASE_URL` (no `VITE_` prefix).

See `.env.example` for the full template.

---

## Connection Pooling

Serverless functions create a new connection per invocation. To avoid exhausting Postgres
connection limits, use Neon's built-in **PgBouncer pooler endpoint** in production:

```
DATABASE_URL=postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/jetlag?sslmode=require
```

The managed game server holds a persistent pool (implemented in Task 10).

---

## Schema

Defined in Task 9. Tables: `players`, `games`, `game_players`, `scores`.

---

## Driver

Standard `pg` npm package. Installed in Task 9 when the schema migration is implemented.

---

*See `spec/DESIGN.md` for cost and architecture constraints.*
*See `spec/TASKS.md` tasks 9–10 for schema and query implementation.*
