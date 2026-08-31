# Content Automation

An autonomous content creation system built on **stateful agents with persistent graph memory**. Agents research trends, plan content, generate materials (scripts, articles, posts), and publish across platforms — the only required human input is recording video.

- **Knowledge graph** (FalkorDB): canonical identities, research evidence, claims, assessments, and generated artifacts are shared across products through authorized knowledge APIs.
- **TypeScript agents** (Mastra + OpenRouter): structured-output entity extraction, research, content pipeline, outreach qualification
- **Two products, one platform**: Content Generator (`localhost:3005`) and Outreach Agent (`localhost:3004`), sharing auth, graph, jobs, events, and UI packages
- **Research** via Tavily, **transcription** via AssemblyAI, **publishing** via direct platform APIs, **scheduling** via Google Calendar

> This repository is the open-source core, mirrored from a private monorepo. It is fully self-hostable. The managed cloud adds metered billing, the Audience Resonance GPU scoring service, cross-product intelligence, and the hosted MCP gateway — those run only on the cloud deployment.

## Quickstart (self-hosted)

Prerequisites: Node 24, pnpm 10.34, Docker.

```bash
# 1. Databases (Postgres + FalkorDB)
docker compose up -d

# 2. Environment
cp .env.example .env
#    Set BETTER_AUTH_SECRET (openssl rand -base64 32) and your OPENROUTER_API_KEY.
#    TAVILY_API_KEY enables research; OPENAI_API_KEY enables topic extraction.

# 3. Install + migrate + seed
pnpm install
pnpm db:migrate
pnpm auth:seed
pnpm content:migrate

# 4. Run a product
pnpm dev:content    # Content Generator → http://localhost:3005
pnpm dev:outreach   # Outreach Agent   → http://localhost:3004
```

Self-hosted deployments run **unmetered** — no billing, no credit limits, every capability enabled. The Audience Resonance scoring surface reports itself unavailable (it requires the managed GPU worker).

## Repository layout

| Path | What lives there |
| --- | --- |
| `apps/content-generator`, `apps/outreach` | The two deployable Next.js apps |
| `apps/docs`, `apps/styleguide` | Documentation site and design-system workbench |
| `products/*` | Product business logic and agents (content-generator, outreach, cascade) |
| `packages/platform` | Graph seam, agent runtime, jobs, events, and the provider seams (`commercial`, `resonance`) |
| `packages/knowledge` | Shared module registry, evidence/claim model, extraction contract, and policy-bounded query API |
| `packages/ui` | Shared visual primitives |
| `packages/auth`, `packages/chat`, `packages/database`, `packages/observability`, `packages/config` | Shared infrastructure |
| `tests/architecture` | Executable architecture contracts (including the open-core boundary) |

## Architecture notes

- All graph access goes through `packages/platform/data/graph.ts` (openCypher; see `docs/graph-backend.md`).
- Billing crosses `packages/platform/commercial` — the default provider is unmetered; the cloud swaps in a metered one at boot. Open-core code never imports billing internals (enforced by `tests/architecture/open-core-contract.test.mjs`).
- UI follows `docs/design-language.md` — dark shadcn token system, semantic tokens only.

## Contributing

External contributions are welcome on this repository — see `CONTRIBUTING.md`. PRs are reviewed here, applied to the private source-of-truth, and mirrored back in the next sync (your change lands with attribution; the PR closes as merged-via-sync).

## License

See `LICENSE`.
