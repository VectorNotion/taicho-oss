# FalkorDB POC — Findings & Verdict (2026-07-21)

## Verdict: GO for local dev. Migration cost is small and now mostly paid.

All suites green against FalkorDB (atlas 3/3, content-generator 53/53, outreach 3/3),
all repository write paths verified via a real seed (dynamic labels, UNWIND over map
params, multi-statement storeLeadResearch), and the live app validated in the browser:
the Brain renders/hops/inspects and product pages load entities — all from FalkorDB.

**Footprint measured on this machine:** FalkorDB 76 MiB idle vs Neo4j 1.2 GiB + ~99% CPU.
Brain overview query: 61 ms (vs ~400 ms warm on Neo4j). Startup ~2 s vs ~30 s.

## What changed (all on feat/falkordb-poc)

| Change | Kind | Dual-engine safe? |
|---|---|---|
| `docker-compose.yml` falkordb service (profile `falkordb`, RESP :6380, UI :3002) | infra | yes (opt-in) |
| `packages/platform/data/falkordb-adapter.ts` (~130 lines: seam contract on native client; IntLike wrapper; param normalization) | new | n/a (only active with `GRAPH_BACKEND=falkordb`) |
| `packages/platform/data/neo4j.ts` backend switch | seam | yes (default unchanged) |
| `datetime()` → `localdatetime()` — 68 sites, 10 files | mechanical | **yes — valid Neo4j 5 syntax; mergeable to main regardless** |
| `LIMIT toInteger($limit)` → client-side integer literal — 4 sites | mechanical | yes |
| Brain queries: CALL{}+UNION → sequential queries; COUNT{}/EXISTS{} → env-gated `indegree()+outdegree()` (Falkor) / `COUNT {}` (Neo4j) | rewrite | yes via env gate (the one engine fork in the codebase) |
| `serverExternalPackages: ["falkordb"]` in unified next.config | config | yes |

## Upstream walls hit (findings for the record)

1. **Bolt is unusable**: documented `FALKORDB_ARGS="BOLT_PORT 7687"` crashes module init on 4.20.1 — Path 1 (keep neo4j-driver) dead; native client required.
2. **Pattern comprehensions rejected as degree expressions** ("Unable to resolve filtered alias") — forced the env-gated degree fork.
3. **LIMIT must be a literal/plain integer** — no expressions.
4. Turbopack cannot bundle the `falkordb` package (`BigInt` interop) — must be a server external.

## To make this permanent (beyond POC)

- Merge the dual-safe pieces (datetime sweep, LIMIT fix) to main any time.
- CI: swap the neo4j:5 service for falkordb + env (`GRAPH_BACKEND=falkordb`).
- Local dev docs: `docker compose --profile falkordb up -d` + 3 env vars; Neo4j remains one env-flip away.
- Prod stays on the shared Neo4j until separately decided (data migration via FalkorDB's neo4j-to-falkordb tooling if ever needed).
- Env vars: `GRAPH_BACKEND=falkordb`, `FALKORDB_URL=redis://localhost:6380`, `FALKORDB_GRAPH=content`.
