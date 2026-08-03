# Docker Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push to `main` ⇒ CI tests + builds five images ⇒ private registry ⇒ watchtower updates production on graph-server, with migrate-on-boot and rollback via SHA tags.

**Architecture:** Two parameterized multi-stage Dockerfiles (web via `turbo prune` → build → prod-deps runtime running `next start`; worker via prune → prod-deps runtime running `tsx`). A checked-in `docker-compose.prod.yml` (postgres + unified + nurture-worker + content-worker + watchtower) replaces three systemd units; nginx and its ports are untouched. CI = test gate (real Postgres service) → path-filtered matrix build → push to `registry.vectornotion.com` (existing private registry; server already authenticated — chosen over GHCR to avoid an interactive PAT).

**Tech Stack:** Docker BuildKit, node:24-alpine, pnpm 10.34.5, turbo 2.5.8, dorny/paths-filter, docker/build-push-action, containrrr/watchtower, registry:2.

## Global Constraints

- Registry namespace: `registry.vectornotion.com/content-automation/<service>`; tags `latest` + `${{ github.sha }}`.
- Services/images named for the product: `unified`, `nurture-worker`, `content-worker`, `outreach`, `content-generator`. Never "publisher"/"publishing" in image/service names.
- Containers bind loopback host ports only: unified `127.0.0.1:3003→3000`, nurture-worker `127.0.0.1:3010→3010`, postgres `127.0.0.1:15432→5432`. content-worker publishes no port. nginx config is never edited.
- Postgres data: compose project name must be `content-automation` so the existing volume `content-automation_pg_data` is adopted. postgres is never watchtower-managed.
- Every migrate path takes a Postgres advisory lock before DDL: cascade key `72711001`, publishing `72711002`, auth `72711003`.
- `.env` never enters a build context or an image; runtime env comes from `env_file: .env` on the server.
- Worktree: all work in `content-automation-worktrees/docker-pipelines` (branch `docker-pipelines`); the main checkout belongs to another agent.
- Server: ssh alias `graph-server` (root). Units to retire: `content-automation-unified`, `content-automation-cascade-worker`, `content-automation-publisher` (stop+disable at cutover, delete after a quiet week — record date, don't delete now).

---

### Task 1: Amend spec (registry + runtime decisions)

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-docker-pipelines-design.md`

- [ ] **Step 1: Append an "Implementation amendments" section** after the `## Decisions` table:

```markdown
### Implementation amendments (2026-07-20, during planning)

- **Registry: `registry.vectornotion.com` (existing private registry), not GHCR.** Discovered during fact-checking: the server already runs `registry:2` behind nginx TLS and root's docker config is already authenticated. GHCR would require minting a `read:packages` PAT interactively. CI authenticates via repo Actions secrets `REGISTRY_USERNAME`/`REGISTRY_PASSWORD`. Trade-off (accepted): registry lives on the same box; watchtower cleanup + ~26GB free disk make this workable. Revisit if the box becomes a reliability concern.
- **Web runtime: `next start` from a pruned prod install, not `output: 'standalone'`.** Standalone tracing excludes the migrate scripts + tsx that migrate-on-boot needs; `next start` matches exactly how prod runs today under systemd and keeps one image pattern for web + workers. Standalone is a future size optimization, not a correctness need.
- Server box facts corrected: 30GB RAM / 8 cores / 75GB disk (26GB free), x86_64, Compose v5.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-20-docker-pipelines-design.md
git commit -m "Spec: registry.vectornotion.com over GHCR; next start over standalone"
```

---

### Task 2: Advisory locks + content-generator migrate script + tsx as prod dep

**Files:**
- Modify: `products/cascade/data/schema.ts` (wrap DDL in lock)
- Modify: `products/content-generator/publishing/schema.ts` (wrap DDL in lock)
- Modify: `packages/auth/scripts/migrate.ts` (wrap in lock)
- Create: `products/content-generator/scripts/migrate.ts`
- Modify: `products/cascade/package.json`, `products/content-generator/package.json`, `packages/auth/package.json` (move `tsx` devDeps→deps; add `db:migrate` to content-generator)
- Modify: `package.json` (root: `test` grows content-generator; add `content:migrate` convenience)
- Test: `products/cascade/tests/schema.test.ts`, `products/content-generator/tests/publishing-engine.test.ts`

**Interfaces:**
- Produces: `pnpm --filter @content-automation/content-generator db:migrate` (used by Task 3 entrypoints); lock-safe `ensureCascadeSchema(pool)` / `ensurePublishingSchema(pool)` signatures unchanged.

- [ ] **Step 1: Write failing concurrency test** — append to `products/cascade/tests/schema.test.ts`:

```ts
test("ensureCascadeSchema is safe to run concurrently", async () => {
  const pool = await freshSchema();
  await pool.query(`DROP SCHEMA IF EXISTS ${schemaName()} CASCADE`);
  await Promise.all(
    Array.from({ length: 8 }, () => ensureCascadeSchema(pool)),
  );
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
    [schemaName()],
  );
  assert.ok(res.rows[0].n >= 15, "tables exist after concurrent ensure");
});
```

- [ ] **Step 2: Run it** — `pnpm test:cascade` (from worktree root; needs local dev Postgres from `docker compose up -d postgres`). Without the lock this is *flaky-fail* (duplicate pg_type errors under contention); with it, deterministic pass. Treat as regression guard.

- [ ] **Step 3: Add the lock to `ensureCascadeSchema`** (`products/cascade/data/schema.ts`) — acquire on a dedicated client, DDL continues on pool:

```ts
export async function ensureCascadeSchema(pool: Pool): Promise<void> {
  const lock = await pool.connect();
  await lock.query("SELECT pg_advisory_lock(72711001)");
  try {
    // ...existing DDL statements unchanged...
  } finally {
    await lock.query("SELECT pg_advisory_unlock(72711001)");
    lock.release();
  }
}
```

- [ ] **Step 4: Same pattern in `ensurePublishingSchema`** (`products/content-generator/publishing/schema.ts`) with key `72711002`; add an equivalent concurrency test to `publishing-engine.test.ts` (8 × `ensurePublishingSchema` after dropping the schema, assert `channels`+`posts` exist).

- [ ] **Step 5: Wrap auth migrate** (`packages/auth/scripts/migrate.ts`):

```ts
import { getMigrations } from "better-auth/db/migration";
import { auth, ensureAuthorizationSchema } from "../server";
import { authPool } from "../database";

const lock = await authPool.connect();
await lock.query("SELECT pg_advisory_lock(72711003)");
try {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  await ensureAuthorizationSchema();
} finally {
  await lock.query("SELECT pg_advisory_unlock(72711003)");
  lock.release();
}
await authPool.end();
console.log("Better Auth and authorization schema are current.");
```

- [ ] **Step 6: Create `products/content-generator/scripts/migrate.ts`:**

```ts
import { getPublishingPool, publishingSchemaName } from "../publishing/pool";
import { ensurePublishingSchema } from "../publishing/schema";

const pool = getPublishingPool();
await ensurePublishingSchema(pool);
console.log(`Publishing schema '${publishingSchemaName()}' is current.`);
await pool.end();
```

- [ ] **Step 7: package.json changes** — in `products/cascade`, `products/content-generator`, `packages/auth`: move `"tsx": "^4.20.6"` from `devDependencies` to `dependencies`. In `products/content-generator` scripts add `"db:migrate": "tsx scripts/migrate.ts"`. Root `package.json`: `"content:migrate": "set -a; . ./.env; set +a; POSTGRES_HOST=localhost pnpm --filter @content-automation/content-generator db:migrate"` and extend `"test"` with `&& pnpm --filter @content-automation/content-generator test`. Run `pnpm install` to update the lockfile.

- [ ] **Step 8: Run** `pnpm test` (root) — expect all suites pass. **Commit:** `feat: advisory-locked migrations, content-generator migrate script, tsx as runtime dep`

---

### Task 3: Dockerfiles, entrypoints, .dockerignore

**Files:**
- Create: `.dockerignore`, `docker/web.Dockerfile`, `docker/worker.Dockerfile`, `docker/entrypoints/{unified,nurture-worker,content-worker,outreach,content-generator}.sh`

**Interfaces:**
- Produces: `docker build -f docker/web.Dockerfile --build-arg PKG=<pkg> --build-arg APP_DIR=<dir> --build-arg SERVICE=<name>` and same for worker.Dockerfile — consumed by Task 4 compose and Task 5 CI.

- [ ] **Step 1: `.dockerignore`** (repo root):

```
.git
node_modules
**/node_modules
.next
**/.next
.turbo
**/.turbo
test-results
docs
graph
extension
extension-react
.env
.env.*
out
**/tsconfig.tsbuildinfo
```

- [ ] **Step 2: `docker/web.Dockerfile`:**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.5
WORKDIR /repo

FROM base AS pruner
ARG PKG
COPY . .
RUN pnpm dlx turbo@2.5.8 prune ${PKG} --docker

FROM base AS builder
ARG PKG
COPY --from=pruner /repo/out/json/ ./
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
RUN pnpm dlx turbo@2.5.8 build --filter=${PKG}

FROM base AS runner
ARG APP_DIR
ARG SERVICE
ENV NODE_ENV=production
COPY --chown=node:node --from=pruner /repo/out/json/ ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node --from=pruner /repo/out/full/ ./
COPY --chown=node:node --from=builder /repo/${APP_DIR}/.next ./${APP_DIR}/.next
COPY --chown=node:node docker/entrypoints/${SERVICE}.sh /entrypoint.sh
USER node
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
```

- [ ] **Step 3: `docker/worker.Dockerfile`** (no build stage — tsx runs source):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.5
WORKDIR /repo

FROM base AS pruner
ARG PKG
COPY . .
RUN pnpm dlx turbo@2.5.8 prune ${PKG} --docker

FROM base AS runner
ARG SERVICE
ENV NODE_ENV=production
COPY --chown=node:node --from=pruner /repo/out/json/ ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node --from=pruner /repo/out/full/ ./
COPY --chown=node:node docker/entrypoints/${SERVICE}.sh /entrypoint.sh
USER node
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
```

- [ ] **Step 4: Entrypoints** (all `#!/bin/sh` + `set -e`, `cd /repo`):
  - `unified.sh`: `pnpm --filter @content-automation/auth db:migrate && pnpm --filter @content-automation/cascade db:migrate && pnpm --filter @content-automation/content-generator db:migrate && exec pnpm --filter @content-automation/unified-app start`
  - `nurture-worker.sh`: `pnpm --filter @content-automation/cascade db:migrate && exec pnpm --filter @content-automation/cascade worker`
  - `content-worker.sh`: `exec pnpm --filter @content-automation/content-generator publishing:worker` (self-migrates under lock)
  - `outreach.sh`: `exec pnpm --filter @content-automation/outreach-app start`
  - `content-generator.sh`: `exec pnpm --filter @content-automation/content-generator-app start`

- [ ] **Step 5: Build all five locally** (verify each exits 0):

```bash
docker build -f docker/web.Dockerfile --build-arg PKG=@content-automation/unified-app --build-arg APP_DIR=apps/unified --build-arg SERVICE=unified -t ca/unified:dev .
docker build -f docker/worker.Dockerfile --build-arg PKG=@content-automation/cascade --build-arg SERVICE=nurture-worker -t ca/nurture-worker:dev .
docker build -f docker/worker.Dockerfile --build-arg PKG=@content-automation/content-generator --build-arg SERVICE=content-worker -t ca/content-worker:dev .
docker build -f docker/web.Dockerfile --build-arg PKG=@content-automation/outreach-app --build-arg APP_DIR=apps/outreach --build-arg SERVICE=outreach -t ca/outreach:dev .
docker build -f docker/web.Dockerfile --build-arg PKG=@content-automation/content-generator-app --build-arg APP_DIR=apps/content-generator --build-arg SERVICE=content-generator -t ca/content-generator:dev .
```

- [ ] **Step 6: Commit** — `feat: parameterized Dockerfiles + per-service entrypoints`

---

### Task 4: docker-compose.prod.yml + local stack smoke test

**Files:**
- Create: `docker-compose.prod.yml`

- [ ] **Step 1: Write the file** (image refs use `${TAG:-latest}` so cutover can pin):

```yaml
name: content-automation
services:
  postgres:
    image: postgres:16
    container_name: content-automation-postgres
    ports: ["127.0.0.1:15432:5432"]
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB:-langgraph}
    volumes: [pg_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB:-langgraph}"]
      interval: 30s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  unified:
    image: registry.vectornotion.com/content-automation/unified:${TAG:-latest}
    ports: ["127.0.0.1:3003:3000"]
    env_file: .env
    environment: [POSTGRES_HOST=postgres, POSTGRES_PORT=5432]
    depends_on:
      postgres: { condition: service_healthy }
    labels: [com.centurylinklabs.watchtower.enable=true]
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 90s
    restart: unless-stopped

  nurture-worker:
    image: registry.vectornotion.com/content-automation/nurture-worker:${TAG:-latest}
    ports: ["127.0.0.1:3010:3010"]
    env_file: .env
    environment: [POSTGRES_HOST=postgres, POSTGRES_PORT=5432]
    depends_on:
      postgres: { condition: service_healthy }
    labels: [com.centurylinklabs.watchtower.enable=true]
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:3010/healthz || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 60s
    restart: unless-stopped

  content-worker:
    image: registry.vectornotion.com/content-automation/content-worker:${TAG:-latest}
    env_file: .env
    environment: [POSTGRES_HOST=postgres, POSTGRES_PORT=5432]
    depends_on:
      postgres: { condition: service_healthy }
    labels: [com.centurylinklabs.watchtower.enable=true]
    restart: unless-stopped

  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /root/.docker/config.json:/config.json:ro
    environment:
      - WATCHTOWER_LABEL_ENABLE=true
      - WATCHTOWER_POLL_INTERVAL=300
      - WATCHTOWER_CLEANUP=true
    restart: unless-stopped

volumes:
  pg_data:
```

- [ ] **Step 2: Validate** — `docker compose -f docker-compose.prod.yml config --quiet` and confirm `docker compose -f docker-compose.prod.yml config --volumes` yields `pg_data` under project `content-automation` (→ `content-automation_pg_data`).

- [ ] **Step 3: Local smoke test** — retag dev images as registry names, run stack against a scratch env file (never the real `.env`), verify: unified serves on :3003 (login page HTTP 200), `curl :3010/healthz` = 200, `docker logs` of content-worker shows `[publishing-worker] starting`, all three migrations logged. Then `docker compose -f docker-compose.prod.yml down` (keep local volumes: no `-v` flag concerns locally).

- [ ] **Step 4: Commit** — `feat: production compose stack (postgres, unified, workers, watchtower)`

---

### Task 5: CI workflow + repo secrets

**Files:**
- Create: `.github/workflows/docker.yml`

- [ ] **Step 1: Set repo secrets** from the server's existing registry auth (never echo the password):

```bash
ssh graph-server "python3 -c \"import json,base64;a=json.load(open('/root/.docker/config.json'))['auths']['registry.vectornotion.com']['auth'];print(base64.b64decode(a).decode())\"" \
  | { IFS=: read -r u p; gh secret set REGISTRY_USERNAME -R rkumar1310/content-automation -b"$u"; gh secret set REGISTRY_PASSWORD -R rkumar1310/content-automation -b"$p"; }
```

- [ ] **Step 2: Workflow** — jobs: `test` (postgres:16 service; steps: checkout, pnpm/action-setup@v4 `version: 10.34.5`, setup-node@v4 `node-version: 24` `cache: pnpm`, `pnpm install --frozen-lockfile`, write a minimal CI `.env` (`POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=ci POSTGRES_PASSWORD=ci POSTGRES_DB=langgraph BETTER_AUTH_SECRET=ci-secret BETTER_AUTH_URL=http://localhost:3000`), `pnpm turbo typecheck`, `pnpm test`); `changes` (dorny/paths-filter@v3, one filter per image: own app/product dir + `packages/**` + `pnpm-lock.yaml` + `docker/**` + this workflow file; output the matched-filter JSON list); `build` (needs both, `if: needs.changes.outputs.images != '[]'`, matrix `image: ${{ fromJSON(needs.changes.outputs.images) }}` mapping name→dockerfile/build-args, docker/login-action with the two secrets, docker/build-push-action pushing `latest` + `${{ github.sha }}`, `cache-from/to: type=gha,scope=<image>`).

- [ ] **Step 3: Commit** — `feat: CI pipeline — test gate, path-filtered image builds, registry push`

---

### Task 6: Delete graph/ + langgraph references

**Files:**
- Delete: `graph/`, `apps/unified/app/api/langgraph/`, `apps/content-generator/app/api/langgraph/`
- Modify: root `package.json` (drop `dev:graph`), `.env.example` (drop `LANGGRAPH_URL`, `LANGGRAPH_API_URL`, `NEXT_PUBLIC_LANGGRAPH_API_URL`, `NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID`), `turbo.json` (drop `LANGGRAPH_URL` from globalEnv), `CLAUDE.md` (rewrite the three graph/LangGraph passages: proxy-route mention, `@graph/CLAUDE.md` pointer, checkpoint note)

- [ ] **Step 1:** `git rm -r graph apps/unified/app/api/langgraph apps/content-generator/app/api/langgraph` + the file edits above. Neo4j references stay untouched.
- [ ] **Step 2:** Sweep: `grep -ri langgraph --include='*.ts' --include='*.tsx' --include='*.json' . | grep -v node_modules | grep -v .next | grep -v POSTGRES_DB` — remaining hits must only be the `langgraph` Postgres DB name and docs history.
- [ ] **Step 3:** `pnpm turbo typecheck && pnpm run test:architecture` — pass. **Commit:** `chore: delete superseded LangGraph service and dead proxy routes`

---

### Task 7: Merge to main, CI green

- [ ] **Step 1:** `git fetch origin && git rebase origin/main` (other agent may have pushed), rerun `pnpm test`, push branch.
- [ ] **Step 2:** `gh pr create --fill && gh pr merge --merge` → `gh run watch` the `docker` workflow on main to completion. Fix any red inline (commit to main via PR again if needed).
- [ ] **Step 3:** Verify all five tags exist: `curl -u <creds> https://registry.vectornotion.com/v2/content-automation/unified/tags/list` etc.

---

### Task 8: Server cutover

- [ ] **Step 1 (prep, zero impact):** on `graph-server`: `docker login` already valid (config.json); back up server-local compose: `mv /root/content-automation/docker-compose.prod.yml /root/content-automation/docker-compose.prod.yml.pre-pipelines` (it's untracked and our pull adds a tracked file at that path); `cd /root/content-automation && git pull`; `docker compose -f docker-compose.prod.yml pull` (images arrive while systemd still serves).
- [ ] **Step 2 (switch):** `systemctl stop content-automation-unified content-automation-cascade-worker content-automation-publisher && systemctl disable` same three; `docker compose -f docker-compose.prod.yml up -d`.
- [ ] **Step 3 (verify):** `curl -sf -o /dev/null -w '%{http_code}' 127.0.0.1:3003/` (200/3xx), `curl -sf 127.0.0.1:3010/healthz`, `https://app.vectornotion.com` through nginx from local machine, `docker logs` all three app containers (migrations ran, loops ticking), `docker logs content-automation-watchtower-1` clean, postgres volume is `content-automation_pg_data` (`docker inspect content-automation-postgres`).
- [ ] **Step 4 (rollback net):** units left installed-but-disabled; note deletion date (+7 days) in `docs/deployment.md`.

---

### Task 9: End-to-end pipeline verification

- [ ] **Step 1:** Record current image digest: `ssh graph-server "docker inspect --format '{{index .RepoDigests 0}}' \$(docker ps -qf name=unified)"`.
- [ ] **Step 2:** Push a trivial-but-visible change to main via PR (e.g., a comment line in `apps/unified/next.config.ts` — inside unified's path filter). Watch CI green.
- [ ] **Step 3:** Within ~6 min of the registry push, confirm watchtower restarted unified with a new digest (repeat Step 1, digests differ; `docker logs` watchtower shows the update). Site still healthy.
- [ ] **Step 4:** Confirm nurture-worker/content-worker were NOT restarted (path filter worked — their digests unchanged).

---

### Task 10: Documentation + memory

- [ ] **Step 1:** Create `docs/deployment.md`: deploy = push to main; cheat sheet (pin rollback: `TAG=<sha> docker compose -f docker-compose.prod.yml up -d unified`; logs; one-off migrate; systemd deletion date). Update `CLAUDE.md` deploy notes if present. Spec status line → "implemented".
- [ ] **Step 2:** Update memory `content-automation-deployment.md` (compose-based procedure, watchtower, registry) — outside repo.
- [ ] **Step 3:** Final commit + PR merge of docs.

## Self-review

Spec coverage: images (T3), compose/watchtower/migrate-on-boot (T2/T4), CI gate+filters (T5), graph deletion (T6), cutover+rollback (T8), e2e (T9), docs (T10), amendments (T1). Types/names consistent: `db:migrate` exists in auth+cascade already, added to content-generator in T2 before T3 entrypoints use it. No placeholders remain.
