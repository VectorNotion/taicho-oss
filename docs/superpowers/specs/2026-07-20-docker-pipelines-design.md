# Docker pipelines for content-automation — design

Date: 2026-07-20 · Status: **implemented and deployed** (2026-07-20; end-to-end verified: CI → registry → watchtower rollout of a single service, workers untouched) · Branch: `docker-pipelines`

> Amended same day: the Relay port landed after the design was first approved, adding a third production service (`content-automation-publisher`). The design now covers five images and three deployed app services.

## Context

Production (app.vectornotion.com on graph-server) currently deploys by SSH: `git pull`, `pnpm build:unified`, restart three systemd units (`content-automation-unified` on :3003, `content-automation-cascade-worker` on :3010, `content-automation-publisher` — the Relay-port publishing worker, no HTTP port). Postgres already runs in a container; nginx runs on the host and proxies both ports. Migrations are never run by the deploy procedure — they're manual and easy to forget. Builds compete with runtime for the box's 8GB RAM.

## Goal

Push to `main` ⇒ tested images built in CI ⇒ production updates itself. No builds on the server, migrations run automatically, rollback is a tag pin.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Scope of images | unified, nurture-worker, content-worker, outreach, content-generator (graph **deleted**, see below) |
| Build location | GitHub Actions → GHCR |
| Deploy mechanism | Watchtower auto-pull on the server |
| Services running in prod | Unchanged: unified + nurture-worker + content-worker (+ postgres, watchtower) |
| nginx | Stays on host, config untouched (containers bind the same loopback ports) |
| Image structure | Per-deployable multi-stage Dockerfiles using `turbo prune` |

### Implementation amendments (2026-07-20, during planning)

- **Registry: `registry.vectornotion.com` (existing private registry), not GHCR.** Discovered during fact-checking: the server already runs `registry:2` behind nginx TLS and root's docker config is already authenticated. GHCR would require minting a `read:packages` PAT interactively. CI authenticates via repo Actions secrets `REGISTRY_USERNAME`/`REGISTRY_PASSWORD`. Trade-off (accepted): registry lives on the same box; watchtower cleanup + ~26GB free disk make this workable. Revisit if the box becomes a reliability concern.
- **Web runtime: `next start` from a pruned prod install, not `output: 'standalone'`.** Standalone tracing excludes the migrate scripts + tsx that migrate-on-boot needs; `next start` matches exactly how prod runs today under systemd and keeps one image pattern for web + workers. Standalone is a future size optimization, not a correctness need.
- Server box facts corrected: 30GB RAM / 8 cores / 75GB disk (26GB free), x86_64, Compose v5.

## 1. Images

Published as `ghcr.io/rkumar1310/content-automation/<service>`, tagged `latest` + git SHA (SHA tags are the rollback mechanism).

| Image | Source | Runtime |
|---|---|---|
| `unified` | `apps/unified` | Next.js standalone server, non-root |
| `nurture-worker` | `products/cascade` | `tsx engine/worker.ts` |
| `content-worker` | `products/content-generator` | `tsx publishing/worker.ts` (Relay port: publish loop + 30s OAuth token-refresh heartbeat; no HTTP) |
| `outreach` | `apps/outreach` | Next.js standalone server (image only, not deployed) |
| `content-generator` | `apps/content-generator` | Next.js standalone server (image only, not deployed) |

Shared multi-stage pattern for all four (one thin Dockerfile per deployable):

1. **base** — `node:22-alpine`, corepack-pinned `pnpm@10.34.5`. The Dockerfile is the repo's first Node version pin.
2. **prune** — `turbo prune <pkg> --docker` (the repo already has prune scripts for outreach/content-generator; add equivalents for unified and the worker).
3. **build** — `pnpm install --frozen-lockfile` against the pruned lockfile, then `turbo build --filter=<pkg>`.
4. **runtime** — web apps: Next `output: 'standalone'` (config change required in each app's `next.config`; none set it today) run as non-root. Worker: pruned production `node_modules` including `tsx` (verify it's a prod dep of `products/cascade`; move it if not).

Root `.dockerignore`: `node_modules`, `.next`, `.git`, `test-results`, worktrees.

AI note: all agent code (`products/*/agent/`) is ordinary package code and ships inside these images. It activates via `ANTHROPIC_API_KEY` in the server `.env` (deliberately unset in demo prod today; same for `RESEND_API_KEY` → LogMailer).

## 2. Production compose, watchtower, migrations

`docker-compose.prod.yml` checked into the repo (replaces the server-local copy):

- **postgres** — as today: `postgres:16`, `127.0.0.1:15432`, healthcheck, 512M limit. Data volume referenced as `external` using the volume name verified on the box (expected `content-automation_pg_data`) so existing data is adopted, not recreated. Neo4j is *not* in this file — prod uses the shared instance at `10.10.0.1:7687`.
- **unified** — `.../unified:latest`, `127.0.0.1:3003`, `env_file: .env`, `depends_on: postgres: condition: service_healthy`, healthcheck on HTTP, mem limit.
- **nurture-worker** — same pattern on `127.0.0.1:3010`. If the worker lacks a health route, add a trivial one (it already serves HTTP for tracking/unsub/webhooks).
- **content-worker** — `.../content-worker:latest`, no published port (pure poll loop: publish pass + token-refresh heartbeat every 30s). Naming: like `nurture-worker`, named for the *product*, not the feature — publishing is its first capability; the plan is for it to also trigger lightweight content workflows later (funnel-like, deliberately below make.com complexity), so the image/service name must not bake in "publishing". The legacy `content-automation-publisher` systemd unit name only survives until cutover. `env_file: .env` (needs `RELAY_R2_*` for media; degrades gracefully without). No HTTP healthcheck possible — restart policy + verify liveness strategy during implementation. Already migrates its own `publishing` schema on boot in code today.
- **watchtower** — `WATCHTOWER_LABEL_ENABLE` with the enable label on unified + worker only (never postgres), 5-minute poll, `WATCHTOWER_CLEANUP=true`, GHCR auth from root's docker config.

**Migrate-on-boot.** Each app image's entrypoint runs its idempotent ensure-migrations before starting, serialized with a Postgres advisory lock (two containers restarting after the same pull must not race DDL):

- unified → auth migrate + cascade ensure + publishing ensure (its `/api/cascade/*` and `/api/content/channels|publish` routes touch all three)
- nurture-worker → cascade ensure
- content-worker → publishing ensure (already in its `main()` today)

This closes today's gap where deploys never run migrations, and makes a fresh box self-bootstrapping. Existing per-package migration ownership (each package ships its own idempotent migrations, disjoint Postgres schemas, no cross-schema FKs) is unchanged and is what makes this safe.

## 3. CI workflow

`.github/workflows/docker.yml`, on push to `main` + `workflow_dispatch`:

1. **Test gate** — because watchtower auto-deploys, CI is the only gate before production. Job runs with a `postgres:16` service container: `turbo typecheck`, architecture tests, auth tests, cascade tests, plus the new content-generator tests (ported Relay adapter fixtures) — the root `test` script should grow to include them.
2. **Matrix build** — one job per image via `docker/build-push-action`, pushing `latest` + SHA to GHCR using the workflow's `GITHUB_TOKEN` (no extra secrets). GHA-backed layer cache.
3. **Change filtering** — per-image path filters (own app dir + `products/`, `packages/`, lockfile) so an unchanged service isn't rebuilt and watchtower doesn't restart it.
4. **Platform** — `linux/amd64` (verify server arch during implementation; add arm64 only if real).

## 4. Graph service deletion

Confirmed 2026-07-20: the Python LangGraph service is fully superseded by TypeScript agents living in the products (Mastra in outreach; custom Anthropic agents in cascade/content-generator) — deliberately on the same surface as the UI for streaming. Nothing calls it at runtime.

Delete in this project (early, per Rajesh):

- `graph/` directory
- `/api/langgraph/[...path]` proxy routes in `apps/unified` and `apps/content-generator` (dead code — only generated `.next` artifacts reference them)
- `dev:graph` root script; `LANGGRAPH_URL` / `LANGGRAPH_API_URL` from `.env.example`
- Final `grep -ri langgraph` sweep; **Neo4j stays** — it's the runtime datastore, only the dead agent service goes.

Low collision risk with the other agent's in-flight work (`products/content-generator/publishing/` — disjoint paths).

## 5. Cutover plan

1. One-time server prep (zero impact): `docker login ghcr.io` with `read:packages` PAT; confirm Compose v2.
2. Merge branch → CI pushes images. Nothing changes on the box (no watchtower yet).
3. Verify the existing Postgres volume name on the box; set it in the compose file (`external`).
4. Switch: `systemctl stop && disable` all three app units (unified, cascade-worker, publisher) → `git pull` → `docker compose -f docker-compose.prod.yml up -d`. Entrypoint migrations no-op against live schema; same loopback ports ⇒ nginx untouched.
5. Verify: `curl 127.0.0.1:3003`, curl the worker health route on `127.0.0.1:3010`, full pass via https://app.vectornotion.com, watchtower logs.
6. Rollback net: systemd units stay installed-but-disabled for one week (`docker compose down` + `systemctl start` restores the old world exactly). Delete them after a quiet week.
7. Rewrite deploy docs + deployment memory: deploying = `git push` to main; cheat sheet for pinning a SHA tag (rollback), tailing logs, one-off migrate.

## Out of scope

- Deploying outreach / content-generator apps or any graph successor to production (images build, nothing new runs)
- Winding down Python Relay (still running in parallel at relay.vectornotion.com pending platform-by-platform cutover — separate project)
- Containerizing nginx or certbot
- Staging environment
- Multi-arch images (until proven needed)

## Risks & mitigations

- **Auto-deploy with no human gate** — accepted trade-off (chosen deliberately); mitigated by the CI test gate and SHA-tag rollback.
- **Concurrent boot migrations** — advisory lock around the ensure scripts.
- **Postgres data loss at cutover** — volume verified and marked `external` before first `up`; postgres never under watchtower.
- **RAM pressure on the 8GB box** — per-service mem limits; runtime images are slim (standalone/pruned); builds happen in CI, never on the box.

## Verify during implementation

- Server CPU arch (assumed amd64) and Compose v2 availability
- Exact Postgres volume + container names on the box
- `tsx` as production dependency of `products/cascade`
- Worker health route existence
- Content-worker liveness strategy (no HTTP — process-level check or none) + exact legacy `content-automation-publisher` unit name on the box
- `RELAY_R2_*` and publishing env vars present in the server `.env`
- GHCR package visibility (private) + PAT scope for watchtower pulls
