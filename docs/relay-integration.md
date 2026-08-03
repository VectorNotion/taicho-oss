# Integrating Relay: social publishing inside the Content product

Status: **implemented and deployed** (2026-07-20) — engine in `products/content-generator/publishing/`, worker `content-automation-publisher` on graph-server, 4 channels migrated from Relay's SQLite, full publish loop verified end-to-end. Python Relay still runs in parallel pending wind-down (see open questions: the personal MCP shorts workflow).
Source repo: `github.com/rkumar1310/relay` — live today at `relay.vectornotion.com` on graph-server.

## What Relay is

A small Python/FastAPI + SQLite service (~6k lines, ~287 tests) that schedules and publishes media posts to **YouTube, X, LinkedIn, and Instagram (Reels)**. Its core value is reliability at the token layer: a 30-second **refresh heartbeat** proactively renews OAuth tokens before expiry (YouTube tokens live one hour), plus a just-in-time refresh before every publish — so a scheduled post never fires on a dead token. Media stages through Cloudflare R2; a publish loop with backoff (1m→5m→30m→2h, 5 attempts) records the real result URL or the real platform error. Driven over REST or MCP, gated by a single shared access key.

## The finding that decides the shape

**The Content product already models publishing — it just can't execute it.** `ContentDraft` carries `status: draft|ready|published`, `scheduledFor`, `publishedAt`, `publishedUrl`; the permission system already has a `content.publish` action with the `content_manager` / `content_editor` role split. But today "publishing" is a manual text box: the operator posts somewhere by hand and pastes the URL back. There is no scheduler, no OAuth, no posting code anywhere in the platform — **Relay fills an empty, already-shaped slot. Nothing collides.**

Platform vocabularies almost align: content's `youtube|twitter|linkedin|blog` vs Relay's `youtube|x|linkedin|instagram` (map `twitter↔x`; `blog` needs no Relay; `instagram` gains a content type later).

## Decision: a capability inside Content, not a fourth product

Publishing is a *phase of the content lifecycle*, not a separate domain. A fourth product would fracture the `idea → draft → ready → published` continuum across a product boundary and duplicate an entitlement matrix that already exists (`content.publish`). Instead:

- **UI**: the draft page's manual "Published URL" box becomes real **Publish now / Schedule** actions (platform + channel + time). One genuinely new page: **Channels** (`/content/channels`) — connected social accounts, token health, and "Connect" buttons driving Relay's OAuth flow.
- **API**: `POST /api/content/drafts/[id]/publish` and `/schedule`; `GET/POST /api/content/channels/*`. All under the existing `/api/content` prefix, gated by mapping these routes to `{product: "content", action: "publish"}` in `permissionForRequest()`. **No new product ID, no new entitlement, no new sidebar group.**
- **Naming**: because it's a capability, it needs no product brand. In the UI it is simply **Publishing** (actions) and **Channels** (connections). "Relay" remains the internal service codename, exactly as "cascade" remains Nurture's internal ID.

## Decision (owner, 2026-07-20): port Relay into the monorepo — sidecar rejected

The first draft of this document proposed keeping Relay as a Python sidecar called over HTTP. **The owner rejected that shape**: publishing must be joined at the hip with the dashboard, and the sidecar puts every piece of shared state — queue, channel health, token expiry, publish results, failures, media handles — on the wrong side of an HTTP boundary, mirrored into the UI through polling and write-back glue. That glue is a permanent tax and two sources of truth that drift. A port costs once.

**Relay is therefore re-implemented as a TypeScript engine inside the monorepo**, following Cascade's precedent exactly:

- **Storage**: publishing tables (`channels`, `posts`, token state) in the shared Postgres under their own schema, alongside Cascade's. The UI reads them through repositories like every other page — no connector, no sync layer, one truth. Relay's SQLite disappears.
- **Engine**: the publish loop and 30s token-refresh heartbeat become a worker process (poll loop, `SKIP LOCKED` claims, systemd unit) in `products/content-generator` — the same long-running-worker pattern ADR 0005 accepted for Cascade.
- **Adapters ported** (YouTube resumable upload, X chunked media + OAuth 1.0a, LinkedIn versioned REST, Instagram Reels via R2 public URL), with **text-only publishing designed in from day one** — the sharpest gap in Python Relay, and the reason "port while we're in there" wins.
- **OAuth flows** become Next.js routes on the app's own domain; tokens live in Postgres; org-scoping becomes a column, not a rearchitecture.
- **Result write-back is in-process**: posts reference `ContentDraft` ids natively; on publish the engine writes `published` + result URL (or `failed` + the platform's real error) onto the draft through the existing content repositories. The graph(drafts)/Postgres(publishing) seam is bridged inside the engine — the UI never sees it.
- **De-risking the port**: Python Relay's ~287 tests are a spec of every platform's API quirks — port the test suite alongside the adapters. The Python service keeps running in parallel; cut over platform-by-platform at parity, then wind it down.

## Engine design (ported)

```
draft page ──▶ /api/content/.../publish ──▶ publishing repositories ──▶ Postgres (channels, posts)
   (Better-Auth session,                          (products/content-          ▲
    content.publish action)                        generator/data)            │ SKIP LOCKED claims
                                                                              │
                              publishing worker: refresh heartbeat + publish loop + adapters
                                        │ on result: writes published/failed + URL
                                        ▼
                              ContentDraft (graph, via existing content repositories)
```

- **Schema** (Postgres, own schema alongside Cascade's): `channels` (platform, account id/name, tokens, expiry, extra, org-scoping column from day one), `posts` (draft id, platform, channel, copy JSON, media ref, publish_at, status `scheduled|publishing|published|failed|cancelled`, attempts, next_attempt_at, claimed_at, idempotency key per (draft, platform), result_url, error).
- **Worker**: one process, Cascade's exact pattern — refresh heartbeat (renew any token expiring within skew; YouTube's 1-hour tokens are the reason this exists) + publish loop (atomic claim → JIT refresh → adapter.publish → record result → backoff 1m/5m/30m/2h, 5 attempts, orphan recovery). Idempotency key closes Python Relay's documented double-post edge.
- **Adapters** (port with their test suite as the spec): YouTube resumable uploads, X chunked media + OAuth 1.0a signing, LinkedIn versioned REST posts, Instagram Reels (URL-mode via R2 public URL). **Text-only branches from day one** for X/LinkedIn — most drafts are text.

### Extensibility: destinations, not "social platforms" (owner requirement)

Publishing must reach more than social — our own CMS/blog and future internal systems. So the engine is designed around a **destination registry**, not a hardcoded platform list:

- **Adapter contract**: `{ type, credentialKind, publish(post, channel) → { url }, refresh?(channel), validate?(channel) }`. Social networks are four implementations of it, not the definition of it.
- **`channels` generalizes to destinations**: `type` is open (`youtube|x|linkedin|instagram|cms|webhook|…`); the credential column is polymorphic per `credentialKind` — OAuth token bundle (social), API key + base URL (CMS), signing secret (webhook), none (internal).
- **First non-social adapter: the CMS.** The content domain already defines `blog` as a platform with no implementation, and the environment already carries `BLOG_API_URL`/`CMS_API_URL` credentials — the CMS adapter closes that circle and proves the contract isn't social-shaped.
- **Escape hatch: a signed-webhook adapter.** POST the rendered post (copy + media URLs + draft metadata, HMAC-signed) to any configured URL. Any internal system we haven't built an adapter for yet becomes a destination with zero engine changes — configuration, not code.
- UI consequence: the Channels page lists destinations of every kind; the publish dialog's platform picker is driven by the registry, so new adapters appear without UI changes.
- **Media**: R2 staging kept as-is (S3-compatible client, public URLs for Instagram).
- **OAuth**: connect/callback routes on the app domain (`/api/content/channels/connect/[platform]`, `/api/content/channels/callback/[platform]`), tokens in Postgres. Redirect URIs re-registered on each platform's OAuth app.
- **Auth**: no service key at all — the session + `content.publish` action gate everything, enforced by the existing proxy. The fails-open sidecar risk disappears with the sidecar.

## UI (per the design language)

- Draft page: the manual "Published URL" box becomes **Publish now / Schedule** (platform + channel picker, time); publish status and failures surface on the draft as badges + toasts.
- **Channels** page under Content: connected accounts, token health (fresh/expiring), Connect/Disconnect. Disconnect copy notes tokens aren't revoked platform-side.
- `scheduledFor` finally gets its UI, backed by a real scheduler.

## Migration path

1. Schema + repositories + Channels page (read/connect flows) — OAuth end-to-end on the app domain.
2. Adapters ported test-first (YouTube → X → LinkedIn → Instagram), each verified against the ported test fixtures.
3. Publish/Schedule wired on drafts; worker deployed as `content-automation-publisher` systemd unit.
4. Parallel-run against Python Relay per platform; cut over at parity; wind down the relay container and its SQLite (one-time token migration: copy channel tokens into Postgres).

## Open questions for the owner

1. Naming sign-off: "Publishing" + "Channels" as plain capability vocabulary (recommended) — or a visible brand?
2. LinkedIn account ownership: Outreach (1:1 InMail to leads) vs Publishing (broadcast feed posts) — different APIs, no code overlap, but decide which LinkedIn account each uses.
3. Does the personal MCP workflow (Claude driving Relay directly to schedule shorts) survive the port? If yes, the ported engine should expose an equivalent MCP/API surface — flag before wind-down.

## Open questions for the owner

1. Naming sign-off: "Publishing" + "Channels" as plain capability vocabulary (recommended) — or does the publishing engine deserve a visible brand?
2. LinkedIn account ownership: Outreach (1:1 InMail to leads) and Publishing (broadcast posts to your feed) are different APIs and don't overlap in code, but both may want LinkedIn credentials — decide which account each uses.
3. When multi-org matters: single-tenant Relay is fine for the demo production; the org-scoping work should be scheduled before any second organization onboards.
