# Graph backend

FalkorDB is the platform's sole graph store. Content, research, topics, prospects,
Intelligence workflows, Chat context, and the Brain all access it through the shared graph seam.

## Configuration

| Variable | Local | Production |
|---|---|---|
| `FALKORDB_URL` | `redis://localhost:6380` | `redis://falkordb:6379` |
| `FALKORDB_GRAPH` | `content` | `content` |

`packages/platform/data/graph.ts` exposes `getSession()` and `closeDriver()`.
It delegates to `packages/platform/data/falkordb-adapter.ts`, which presents the
small record/session interface repositories use on top of the native FalkorDB
client.

## Cypher rules

FalkorDB implements openCypher 9. Repository queries must follow these rules:

- Use `localdatetime()`, not `datetime()`.
- Do not use `COUNT {}`, `EXISTS {}`, or `CALL {}` subqueries.
- Pass integer literals to `LIMIT`.
- Use `indegree(n) + outdegree(n)` for node degree.
- Keep multi-stage writes as separate queries.

## Local development

```bash
docker compose up -d
pnpm dev
```

This starts PostgreSQL and FalkorDB. The FalkorDB browser is available at
`http://localhost:3002`; RESP is exposed at `localhost:6380`.

The `dev:*`, `test:content`, and `test:atlas` scripts default to the local
FalkorDB connection.

## CI and production

CI runs `falkordb/falkordb:latest` alongside PostgreSQL. Production uses the
`falkordb` service in `docker-compose.prod.yml` with append-only persistence.
Application containers connect over the Compose network at
`redis://falkordb:6379`.
