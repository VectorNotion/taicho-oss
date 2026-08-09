# Deployment

The deployment policy has two gates:

- Every push to `main` resolves an image dependency plan. Affected images are
  rebuilt and scanned; unchanged image digests are cheaply aliased to the new
  immutable commit SHA. Only affected images roll out to the `staging` GitHub
  environment and the `taicho-staging` Kubernetes namespace.
- Publishing a GitHub Release deploys its tagged commit to the `production`
  GitHub environment and the `taicho` Kubernetes namespace.

The deployment named `mcp-worker` is retained for rollout compatibility but now runs the shared capability worker. It claims durable operations created by either REST or MCP and drains the signed external-webhook outbox. API/OAuth configuration and verification are documented in [External OAuth API](external-api.md).

Production does not rebuild. The production workflow requires the release tag
to resolve to a commit on `main`, requires that commit's staging workflow to
have succeeded, verifies all eight immutable registry tags, and then promotes
only digests that differ from the currently deployed production images.
Registry uploads remain capped at two concurrent builds. Every Actions job has
an explicit timeout, and the security job runs
`scripts/validate-workflow-timeouts.mjs` to reject any workflow that omits one.

## Image dependency map

`config/image-dependencies.json` is the source of truth for the eight release
images. Each image declares its root workspace package and image-specific
Docker inputs. `scripts/resolve-image-plan.mjs` reads every workspace
`package.json`, follows transitive `workspace:*` dependencies, and maps the
files changed since the latest successful `main` candidate to affected images.

Examples:

| Change | Images rebuilt and staged |
|---|---|
| `docs/content/**` or `apps/docs/**` | `docs` |
| `docker/docs.Dockerfile` | `docs` |
| `docker/worker.Dockerfile` | all six workers |
| A workspace package | images whose transitive package closure includes it |
| Root lockfile, workspace, patch, or TypeScript configuration | all images |
| Tests, operational docs, or workflow-only files | none |

Unknown files under `docker/` or a removed workspace directory deliberately
fall back to a full rebuild. This makes missing dependency declarations safe
by default. A manually dispatched `docker` workflow also defaults to
`rebuild_all=true`; clear that input only when intentionally exercising the
dependency plan.

Every successful candidate still owns all eight `${GITHUB_SHA}` registry tags.
For an unchanged image, Buildx creates the new tag from the previously scanned
manifest and verifies that both tags resolve to the same digest. This preserves
the release-by-SHA contract without spending time rebuilding unchanged code.

## Publishing a production release

On GitHub, open **Releases → Draft a new release**, choose or create a tag for
the staged `main` commit, complete the release notes, and click **Publish
release**. Saving a draft does not deploy. Publishing is the production gate.

The equivalent CLI command is:

```bash
gh release create <version-tag> \
  --target <staged-main-sha> \
  --generate-notes
```

Both deployment jobs wait for Kubernetes rollout health. If a rollout fails,
the rollout helper restores every deployment changed by that job to its prior
revision.

Manual rollback remains an operator action:

```bash
kubectl -n taicho rollout undo deployment/unified
kubectl -n taicho rollout status deployment/unified --timeout=300s
```

Repeat for any worker deployment included in the release.

## Reproducing the release checks locally

Node 24 and pnpm 10.34.5 are the supported release toolchain (`.node-version`
and `packageManager` are the machine-readable pins). On an 8 GB development
machine, run the canonical checks sequentially:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build:unified
pnpm test
pnpm test:e2e
```

The typecheck deliberately limits Turbo to one package at a time, and both
typecheck and build commands cap the Node heap at 3 GiB. The unified build
invokes only the unified Next application; its pruned workspace dependencies
remain available without redundantly building the standalone outreach and
content applications. `pnpm test:e2e` migrates and seeds its local schemas,
starts the real durable workers plus browser applications, and substitutes
only explicitly non-production model/email boundaries.

If the active shell is not already running Node 24, the same checks can be run
without changing the machine-wide Node installation:

```bash
pnpm dlx node@24 "$(command -v pnpm)" typecheck
pnpm dlx node@24 "$(command -v pnpm)" build:unified
```

The CI test job records the Node and pnpm versions in its normal setup logs,
runs both canonical commands against the checked-out commit, and only then
allows the image job to publish immutable `${GITHUB_SHA}` tags.

The live OpenRouter workflow smoke is deliberately separate from the
deterministic release gate. Run it locally with `pnpm test:e2e:provider`, or
dispatch the `docker` workflow manually; the job runs only when the repository
has an `OPENROUTER_API_KEY` secret. `E2E_OPENROUTER_MODEL` defaults to
`openrouter/free` and can be overridden for a compatibility check.

## Production configuration preflight

The release environment is a fail-closed contract, not an informal list of
suggested variables. Validate the exact production env file without printing
secret values:

```bash
pnpm env:validate:production
```

The validator checks canonical URLs and origins, separate database roles,
migration/worker tenant IDs, encryption keys, assistant and knowledge
services, authentication, object storage, observability, and the
explicit launch integration sets. Its report contains only presence,
structure, and semantic results; secret values are always redacted. A failed
check exits non-zero.

`PRODUCTION_RELEASE_PROFILE` defaults to `public-launch`, which requires the
complete contract. An explicitly approved production test release may set it
to `testing`. That profile records warnings, rather than inventing credentials,
for deferred legal publication, outbound MCP, Payload/Qdrant assistant
knowledge, FAL creative media, OpenAI/Tavily, and commercial-operator
configuration. Core authentication, database-role separation, tenant
isolation, encryption, object storage, the protected Payload billing catalog,
publishing destinations, and
Datadog/Langfuse observability remain mandatory. Configured deferred values
are still validated strictly, unknown profiles fail, and dependent runtime
features stay unavailable. Nurture has no provider credentials, delivery
configuration, scheduler, or worker. External automation reads and manages its
funnel memberships and literal-text emails through OAuth REST or MCP.

Production validation also rejects every deterministic test escape hatch:
`ASSISTANT_MODEL_MODE=stub` and `CONTENT_MIGRATION_SKIP_GRAPH=1`. These values belong only to local or CI E2E
processes and must not appear in `/root/content-automation/.env`.

### Recall meeting capture

Outreach meeting capture uses Recall. Set `RECALL_REGION` (for example,
`us-east-1`), `RECALL_API_KEY`, and the `whsec_`-prefixed
`RECALL_WEBHOOK_SECRET` copied from Recall. In the Recall dashboard, register
`https://cloud.taicho.ai/api/outreach/recall/webhook` and subscribe it to
`bot.status_change`, `transcript.done`, and `transcript.failed`.

Taicho requests Recall's accuracy-prioritized streaming transcript with
automatic language detection and separate-stream diarization. Bot status is
updated only from signed webhooks; Taicho does not poll Recall. A
`transcript.done` delivery starts a bounded download of the JSON transcript,
stores its speaker-attributed segments as immutable lead evidence, and then
generates a fresh insight revision. Existing Attendee records and signed
Attendee deliveries remain supported during migration, but new meeting
captures use Recall.

Lead semantic search writes source-linked embeddings for profiles, sent
outreach, activities, notes, manual updates, and transcript utterances into
each organization's FalkorDB graph. By default it reuses
`OPENROUTER_API_KEY` with `nvidia/nemotron-3-embed-1b:free` at 2,048
dimensions. `OUTREACH_EMBEDDING_URL`, `OUTREACH_EMBEDDING_API_KEY`,
`OUTREACH_EMBEDDING_MODEL`, `OUTREACH_EMBEDDING_DIMENSIONS`, and the optional
query/document input-type variables can point the same code at a self-hosted
compatible embedding endpoint. A model or dimension change requires the
existing `LeadKnowledgeChunk.embedding` vector index to be rebuilt before the
new configuration is deployed.

The unified container runs the same complete validation before any migration
or web process starts. This prevents a partially configured release from
changing schemas and then serving traffic. Before deployment, attach the
redacted report to the release record and confirm that it ends with zero
failures.

## Kubernetes environments

The primary cluster keeps staging and production isolated by namespace,
credentials, application secrets, databases, and ingress:

| GitHub environment | Namespace | Application |
|---|---|---|
| `staging` | `taicho-staging` | `https://cloud-dev.taicho.ai` |
| `production` | `taicho` | `https://cloud.taicho.ai` |

The explicit `testing` release profile derives its canonical origin from
`PUBLIC_APP_URL`; public-launch validation remains pinned to
`https://cloud.taicho.ai` unless an operator supplies `--origin` directly.

Each GitHub environment owns a `KUBE_CONFIG` secret for a namespace-scoped
`ci-deployer` service account. The role may update deployments and observe
their rollouts; it has no cross-namespace permission.

## Graph backend

Production runs **FalkorDB** as the `falkordb` service
(`FALKORDB_URL=redis://falkordb:6379`, `FALKORDB_GRAPH=content` in `.env`).
The `falkordb` volume is append-only
and, like postgres, is not watchtower-managed.

All graph consumers use the FalkorDB-only seam at
`packages/platform/data/graph.ts`.

Full detail, including the Cypher dialect rules: `docs/graph-backend.md`.

## Kubernetes cheat sheet

```bash
# current production and staging images
kubectl -n taicho get deployments \
  -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image
kubectl -n taicho-staging get deployments \
  -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image

# rollout status and logs
kubectl -n taicho rollout status deployment/unified --timeout=300s
kubectl -n taicho logs deployment/unified --tail=200
```

## Observability

Production exports operational telemetry to Datadog Cloud and privacy-filtered
AI telemetry to Langfuse Cloud. The local Datadog container is a collector,
not a self-hosted observability backend. Configuration, attribution fields,
support-code lookup, privacy defaults and production verification are in
`docs/observability.md`.

## Known follow-ups

- Python Relay still runs in parallel at relay.vectornotion.com pending wind-down.
- Remove the repository-level `KUBE_CONFIG` secret after the environment-scoped
  credentials have been proven by one staging and one production deployment.
