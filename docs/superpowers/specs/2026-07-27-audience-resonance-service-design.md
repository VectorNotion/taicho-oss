# Audience Resonance Service — Design

**Date:** 2026-07-27
**Status:** Draft — awaiting review
**Workspace:** `worktree-audience-resonance-service`

## 1. Summary

A standalone scoring service that predicts which creative variant (hook, title, post, ad copy) will resonate most with a target audience — without generating any text. It runs a ~4B open-weight model on Modal and reads **next-token probabilities** instead of full completions. Because each judgment is a single forward pass (prefill + one logit readout), one GPU can score thousands of persona × creative judgments in minutes, and Modal fan-out brings that to seconds.

The API lives in the existing Next.js app (matching the platform's jobs pattern: the route returns `{ jobId }` immediately); the Modal side is a pure worker — no HTTP surface of its own. Submit creatives + audience personas, get back calibrated resonance scores, per-segment breakdowns, and a winner with a confidence statement.

## 2. Why probabilities instead of generations

Asking an LLM to *write an opinion* about a creative costs hundreds of decode steps per judgment and then still needs a parser/judge to turn prose into a decision. Reading the model's **probability distribution over answer tokens** collapses all of that:

- Prompt: persona context + creative + "Would this person stop scrolling for this? Answer Yes or No."
- One forward pass produces the logits for the next token. `P(" Yes")` vs `P(" No")` **is** the judgment.
- No sampling, no temperature, no parsing, deterministic, and ~100–500× cheaper per judgment than generate-then-judge.

This also gives *graded* signal (0.71 vs 0.55) rather than a binary verdict, which is exactly what we need to rank creatives and to average across a large persona ensemble.

## 3. Scoring modes

| Mode | Question shape | Readout | Cost per cell | Use |
|------|----------------|---------|---------------|-----|
| **M1 Choice readout** (primary) | "Answer Yes or No" | `P(Yes)` normalized over {Yes, No} | 1 prefill + 1 decode step | Absolute per-creative scores across the ensemble |
| **M2 Pairwise duel** | "Which resonates more, A or B?" | `P(A)` vs `P(B)`, both orders | 1 prefill + 1 decode step | Final winner among top-k; feeds Bradley–Terry |
| **M3 Echo likelihood** (v2, optional) | none — score the creative's own tokens | mean token logprob of creative under persona context | 1 prefill, 0 decode | "Naturalness/fit" signal, tie-breaking |

Readout mechanics (M1/M2): request `max_tokens=1, logprobs=20` from vLLM and read label probabilities from the top-k list. At engine startup, assert each label ("Yes", "No", "A", "B" — with leading space, in chat-template context) tokenizes to a single token. If a label ever falls outside top-20, fall back to **exact echo scoring**: append the label and read its `prompt_logprobs` — with prefix caching the shared prompt is already cached, so the fallback costs one cheap 1-token extension per label.

Model note: use a **non-thinking instruct** variant. A thinking-mode model would emit `<think>` as its first token and destroy the readout — the readout reads the logits at the answer position, so a model that starts reasoning instead of answering produces a distribution over `<think>`, not over Yes/No. The deployed pin is `Qwen/Qwen3.5-4B` (`MODEL_ID` in `services/resonance/modal_app.py`), whose chat template is rendered with `enable_thinking=False`, with an explicit `</think>`-suffix fallback for tokenizer builds that do not accept that flag (see `Scorer._render`).

## 4. The cell matrix (the "thousands of inferences")

One run compiles a matrix of independent scoring cells:

```
cells = creatives × personas × frames × variants
```

- **creatives** — the variants under test (e.g. 20 hooks).
- **personas** — audience members, as short natural-language descriptions (e.g. 25). v1: supplied in the request or via named presets. Later: derived from the outreach `Persona` domain type (`products/outreach/domain/types.ts:340` — name, description, targetTitles, companySize, signals map cleanly onto a persona paragraph).
- **frames** — the engagement questions: stop-scrolling, click, share, comment, "would ignore" (inverted), "feels like an ad" (inverted)… (e.g. 6–8). Frames are versioned prompt templates.
- **variants** — order swaps (pairwise), paraphrased frames, and per-template content-free calibration probes (see §5).

Example: `20 × 25 × 8 × 2 = 8,000` cells ≈ 4M prompt tokens. Every cell is a single forward pass; cells are embarrassingly parallel. Prompt structure is deliberately `persona ‖ frame ‖ creative` so vLLM **prefix caching** collapses the repeated persona+frame prefixes — the effective unique token count is far below 4M.

## 5. Calibration and bias controls

Small models have strong surface biases. Uncalibrated readouts are not credible; these controls are in scope for v1:

1. **Content-free baseline (yes-bias):** for each persona × frame template, score a neutral placeholder creative ("[a typical post]"). Calibrate real scores in log-odds space: `s = σ(logit(p) − logit(p_baseline))`. Adds `personas × frames` cells (cheap).
2. **Position bias (pairwise):** every duel runs both orders (A,B) and (B,A); average the two.
3. **Token surface:** single-token labels asserted at startup; case/variant mass ("Yes"/"yes") summed if both appear in top-k.
4. **Ensemble averaging:** the frame paraphrases and persona breadth exist precisely so template-specific noise averages out.
5. **Persona balance:** equal weight per persona (or per declared segment), never per cell.

## 6. Aggregation and winner selection

- **Resonance score** per creative = mean calibrated `P(positive)` across cells, aggregated in log-odds space, reported 0–100, with a per-persona and per-frame breakdown.
- **Uncertainty:** cluster bootstrap over personas (cells within a persona are correlated) → 95% CI per creative.
- **Winner:** run M2 pairwise duels among the top-k (default 4) creatives across the persona ensemble, fit **Bradley–Terry** strengths, and declare the winner **only if** its CI separates from the runner-up; otherwise return `"too_close_to_call": true` with the ranked list. Honest ties are a feature.

## 7. Modal architecture

```
Next.js API route (existing app)                 ← the API: auth, validation
   │  job row in platform Postgres (existing jobs pattern) → return { jobId }
   │  spawn deployed Modal function (Modal JS SDK; fallback: signed trigger URL)
   ▼
run_scoring() orchestrator (Modal CPU worker)
   │  compile cell matrix → shards (~1–2k cells)
   │  Scorer.score_shard.map(shards)             ← Modal fan-out
   ▼
Scorer (@modal.cls, GPU=L40S, vLLM engine, Qwen3-4B, prefix caching)
   │  batch prefill → logprob readout per cell
   ▼
aggregate + calibrate + bootstrap + Bradley–Terry (CPU worker)
   │
   └─ RETURNS the result; it waits in Modal's control plane at zero GPU cost
      until the platform polls for it (see §8 "Completion path — pull, not push")
```

Key decisions:

- **In-process engine per shard, not HTTP per cell.** Each `Scorer` container holds a vLLM engine and scores a whole shard in-process. No per-request HTTP tax at thousands-scale; shard ordering is arranged to maximize prefix-cache hits (group cells by persona+frame prefix).
- **Scale-out = containers.** `Scorer` autoscales 0→N (default cap 8). A run's wall clock ≈ `cells / (containers × cells_per_sec)`.
- **Scale-to-zero with managed cold starts.** Weights live on a `modal.Volume`; engine boot ~30–60 s. Acceptable for v1 (runs are batch jobs, not chat). Optional `min_containers=1` during working hours, and Modal memory snapshots if cold starts annoy.
- **GPU default L40S** (48 GB, strong prefill $/token for a 4B in bf16); `A10G` flag for budget, `H100` flag for burst. Prices verified in Phase 0.
- **No API on Modal.** Modal runs deployed worker functions only. Next.js triggers them via the Modal JS SDK (`modal` on npm — `Function.lookup(...).spawn(payload)`); if the SDK proves immature in Phase 0, the fallback is Modal's one-decorator trigger URL with a signed secret — still no FastAPI app of ours.
- **State in platform Postgres.** The run is a row in the existing `jobs` table (route returns `{ jobId }` immediately, result lands in `result` JSONB when reconciliation observes a finished run — same lifecycle every other action uses). Modal keeps only scratch state (weights Volume, shard intermediates).
- **Retries & partial results:** shard-level retries (Modal `retries=2`); a run completes with `partial: true` if ≤10% of shards ultimately fail, else `failed`. A partial run keeps job status `completed` (the table has no `partial`), so the degraded signal is carried in the result itself (`partial`/`degradedReason`) and rendered as such, never as a clean win. Reconciliation is by poll (§8): on read for a watched run, and by `sweepResonanceRuns` for one nobody is watching.

## 8. API (v1, served from Next.js)

The public API is Next.js routes in the unified app; auth is whatever the app already uses. The JSON below is also the payload contract passed to the Modal worker verbatim.

`POST /api/resonance/runs` → `202 { "jobId", "estimated_cells", "estimated_cost_usd" }`

```json
{
  "creatives": [{ "id": "c1", "text": "Stop A/B testing blind…", "kind": "hook" }],
  "audience": {
    "personas": [{ "id": "p1", "description": "CTO at a 40-person SaaS…" }],
    "preset": null
  },
  "frames": ["scroll_stop", "click", "share", "ignore"],
  "options": { "pairwise_top_k": 4, "paraphrases": 2, "model": "qwen3-4b", "gpu": "L40S" }
}
```

`GET /api/resonance/runs/{jobId}` (reads the job row) →

```json
{
  "status": "running | complete | partial | failed",
  "progress": { "cells_done": 5200, "cells_total": 8000 },
  "results": {
    "scores": [{ "creative_id": "c1", "score": 68.2, "ci95": [63.1, 72.9],
                 "per_persona": {}, "per_frame": {} }],
    "pairwise": { "matrix": {}, "bradley_terry": {} },
    "winner": { "creative_id": "c1", "margin": 7.3, "too_close_to_call": false }
  },
  "meta": { "model": "Qwen/Qwen3.5-4B", "cells": 8000, "gpu_seconds": 290, "cost_usd": 0.16 }
}
```

### Completion path — pull, not push (revised 2026-07-27)

**Superseded design:** the Modal worker POSTed results to an inbound `/api/resonance/webhook` route. Rejected — it bought a public inbound endpoint, inbound HMAC + replay receipts, a proxy allowlist entry, an architecture-test boundary registration, delivery retries, a stuck-job failure mode when the shared secret is misconfigured, and a localhost-unreachable problem in development. All of it to avoid a poll.

**Current design:** Modal's `spawn()` is already a durable task queue. The GPU container exits when its work completes; the pending result is control-plane state on Modal's side, costing zero GPU while it waits.

1. `POST /api/resonance/runs` reserves credits, creates the job row, calls the signed trigger, and stores the returned Modal **call id** on the job row (in `result` JSONB as `{ modalCallId }` while `processing` — no new columns).
2. Modal's `orchestrate` **returns** the `WebhookPayload`-shaped result instead of POSTing it.
3. A second small Modal endpoint, `GET /result?callId=…` (one decorated function, no framework), answers `202` while running or `200` with the result when finished.
4. `GET /api/resonance/runs/{jobId}` reconciles lazily on read: if the job is still `processing` and carries a `modalCallId`, it polls that endpoint through `safeFetchPublicUrl`, and on a finished result applies the same one-shot `transitionJobStatus` + credit settlement used before.
5. `sweepResonanceRuns` (`packages/resonance/server/runs.ts`) reconciles runs nobody is watching — `processing` `resonance_run` rows carrying a `modalCallId` — through the same `reconcileRun` a user's own poll uses, so there is only ever one settle path. It runs from the job-reconciler registry (`packages/platform/jobs/reconcilers.ts`) and is exported so a worker or cron can call it directly.

Every call is **outbound** from the platform and passes the SSRF-guarded fetch path. There is no inbound surface, no `RESONANCE_WEBHOOK_SECRET`, and no tunnel needed for local development. The request is never held open waiting — reconciliation happens on read, so no serverless timeout is at risk.

Unchanged by this revision: the outbound trigger signing (`webhook-security.ts`, used one direction now), the platform product/action registration, the replay-safe one-shot `transitionJobStatus` (still exactly what settle-once requires), the trigger client, the scorer, and the statistical core.

## 9. Repo placement and stack

**Confirmed 2026-07-27:** resonance is a **platform service in `packages/resonance`** (the Taicho/flow shape: package owns domain + components + clients; `apps/unified` owns thin route shells), NOT a vertical under `products/*`. Products are firewalled from each other by `tests/architecture/product-boundaries.test.mjs`; platform packages are consumable by every module in both directions — which is what "resonance plugs into outreach/content/cascade" requires.

- **`packages/resonance/`** — `@content-automation/resonance`: domain types, run-payload contract, Modal trigger client (Deps-injectable), `webhook-security.ts` (HMAC **signing** for outbound calls; the verifying side lives in `modal_app.py`), run-lifecycle handlers, and the run-composer components. Explicit `exports` subpaths per house convention.
- **`apps/unified/app/api/resonance/`** — two thin routes: `runs/route.ts` (POST → reserve credits → job row → spawn → `{ jobId }`) and `runs/[jobId]/route.ts` (GET → authenticated, RLS-scoped read that reconciles from Modal when still running). No webhook route, no allowlist entry, no inbound boundary registration.
- **v1 rides the platform `jobs` table** (adds `'resonance'` to the `Product` union + action catalog) — deliberately avoids owning Postgres tables, which would trigger the tenant-isolation and observability architecture contracts.
- **Billing:** `reserveVariableCost()` at route time; actual-cost settlement when reconciliation observes a finished run.
- **Outbound trigger:** signed trigger URL via `safeFetchPublicUrl` (SSRF-guarded, test-enforced) as primary; Modal JS SDK (gRPC, bypasses the safe-fetch contract) as a later optimization behind a flag.
- **`services/resonance/`** — Python Modal worker, deliberately outside the pnpm/turbo workspace (Modal SDK is Python-first). PoC spikes live in `services/resonance/poc/` (validated: steering readout + consistency battery).
  - `modal_app.py` — Modal app: signed `trigger` endpoint, signed `result_endpoint` poll, `orchestrate` worker, `Scorer` class. No webhook client.
  - `resonance_core/` — pure-Python core: cell compiler, prompt templates (versioned), calibration, aggregation, Bradley–Terry, bootstrap. **No Modal imports** — fully unit-testable locally.
  - `tests/` — pytest; engine stubbed with canned logprobs.
  - `pyproject.toml` (uv), `README.md`.
- **Model:** `Qwen/Qwen3.5-4B` (non-thinking readout, matches the house Qwen stack) — pinned as `MODEL_ID` in `services/resonance/modal_app.py`. Config-swappable.
- **Serving:** vLLM, `enable_prefix_caching=True`, `max_model_len=4096`, bf16, `SamplingParams(max_tokens=1, logprobs=20)`.
- **TS side (v1 scope now):** `packages/resonance/` — the `@content-automation/resonance` package described above: domain + payload contract, the `Deps`-injectable trigger client, the run-lifecycle handlers (`server/runs.ts`) the two API routes delegate to, and the run-composer components. There is no webhook route and no `packages/platform/resonance/`.
- **Outbound signing:** every call the platform makes to Modal is signed with `RESONANCE_TRIGGER_SECRET` (`webhook-security.ts`, signing direction only) and goes out through `safeFetchPublicUrl`. There is no inbound surface and no `RESONANCE_WEBHOOK_SECRET` — both were retired with the push-completion design.

## 10. Performance & cost model (estimates — verified in Phase 0)

Reference run: 8,000 cells, ~500 prompt tokens/cell ≈ 4M tokens before prefix caching.

| Setup | Wall clock | Cost (GPU only) |
|-------|-----------|------------------|
| 1 × L40S (~10–20k prefill tok/s batched) | ~3–7 min | ~$0.10–0.25 |
| 8 × L40S (fan-out) | **~30–60 s** | same ≈ $0.10–0.25 + cold starts |
| Generate-then-judge comparison (200 decode tok/cell + judge pass) | tens of minutes | ~10–50× more |

Prefix caching should cut effective prefill substantially (persona+frame prefixes repeat across every creative); the spike measures the real hit rate. Cold start (scale-from-zero) adds ~30–60 s to the first shards.

## 11. Approaches considered

**A. Persistent OpenAI-compatible vLLM server on Modal; client fans out 8,000 HTTP calls with `max_tokens=1, logprobs`.**
Familiar interface, but: per-request HTTP overhead × thousands, client owns fan-out/retries/backpressure, no control over batch ordering for prefix cache, and an aggregator service is still needed. Rejected as primary (kept as a debug convenience later if wanted).

**B. Shard workers — Modal `.map()` over cell shards, vLLM engine in-process, orchestrator aggregates. ← Recommended.**
No per-cell network tax, engine-level batching + prefix-cache-aware ordering, scale-out and scale-to-zero come from Modal, results aggregate in one place. This is the design above.

**C. One Modal function call per cell.** Maximal nominal parallelism, pathological economics — engine load dominates per call. Rejected.

**Hosted logprob APIs (OpenRouter/Together) instead of Modal.** No infra, but logprob support is inconsistent across providers, per-request rate limits break thousands-scale bursts, and per-token pricing beats self-hosting only at trivial volume. Brief explicitly targets Modal. Rejected for the harness; fine as a future fallback provider behind the same core.

## 12. Validation plan

1. **Sanity suite (Phase 0/1):** ~30 hand-built cases with obvious expected outcomes (great hook vs word salad; persona-sensitivity: a k8s meme should score higher for a platform-engineer persona than a CFO persona). Assert directional correctness, not exact values.
2. **Golden set (Phase 3):** replay historical published content that already carries human performance annotations (low/medium/high engagement) through the harness; require positive rank correlation (Spearman) between resonance score and annotated engagement. This is the go/no-go for trusting the winner-picker.
3. **Repeatability:** same run twice → score delta < 1 point (readout is argmax-free and deterministic up to batching noise).
4. **Calibration audit:** content-free baselines logged per template; alert if any template's baseline drifts past 0.5 ± 0.2 (template rot).

## 13. Phases

- **Phase 0 — Spike (half day):** Modal account/token, deploy minimal `Scorer` with Qwen3-4B, verify single-token labels + logprob readout, measure real prefill tok/s and prefix-cache effect, verify GPU pricing, and confirm the Modal JS SDK can spawn the deployed function from Node (else fall back to signed trigger URL). Go/no-go on the cost model.
- **Phase 1 — Scoring core:** cell compiler, frames v1, calibration, aggregation, Bradley–Terry, bootstrap; pytest with stubbed engine; `modal run` CLI entry for a full offline run.
- **Phase 2 — API & wiring:** Next.js routes (`POST /api/resonance/runs`, `GET /api/resonance/runs/{jobId}` — two routes, no webhook route), job-row lifecycle in the platform `jobs` table, HMAC-signed Modal spawn from the route, poll-on-read reconciliation plus the unwatched-run sweeper, partial-failure semantics.
- **Phase 3 — Validation & tuning:** golden-set eval against human annotations, frame/ensemble tuning, cost/latency report.
- **Phase 4 — Deeper platform integration (deferred by brief):** `score_creatives` job-runner action, UI surface, personas sourced from the outreach domain, scores written back to the graph beside human annotations.

## 14. Assumptions (flagged for review)

1. **Creatives are text** in v1 (hooks/titles/posts). Images/thumbnails are out of scope.
2. **Personas arrive in the request** (or presets); no graph coupling in v1.
3. **A Modal account exists** (or will be created); `MODAL_TOKEN_ID/SECRET` and `RESONANCE_TRIGGER_SECRET` become new secrets — none exist in `.env` today. (`RESONANCE_WEBHOOK_SECRET` was retired with the push-completion design.)
4. **Python is acceptable** for this leaf service (Modal is Python-first; the repo is otherwise TS).
5. **Relative ranking is the product**, not absolute CTR prediction — a 4B ensemble can rank credibly; it cannot promise "this will get 4.2% CTR".
6. Winner credibility is bounded by **Phase 3 validation**; until then outputs are labeled experimental.

## 15. Open questions (non-blocking)

- Should run results eventually write back to the graph as annotations on content nodes (pre-publication predicted resonance next to post-publication human annotation)? Natural fit, deferred.
- Preset persona packs: curate manually or derive from the outreach Personas domain?
- The repo has no creative-variant concept in content-generator today (the only "variants" are cascade's email A/B rows in Postgres). Does the resonance harness eventually score cascade email subject lines too, or stay content-side (hooks from `refine_content_idea`)? Both fit the same API.
- Multi-model ensembles (4B + 8B disagreement as a confidence signal) — v2 idea.
