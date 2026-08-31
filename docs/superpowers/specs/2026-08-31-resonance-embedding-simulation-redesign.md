# Audience Resonance — Embedding-Space Simulation Redesign

**Date:** 2026-08-31
**Status:** Approved (supersedes `2026-07-27-audience-resonance-service-design.md`)
**Owner:** packages/resonance (serving), services/resonance (future training home)

## 1. Why the redesign

The steered-Qwen design had one frozen source of intelligence and no learning
path anywhere. Its synthetic audience was random isotropic steering noise —
ungrounded in any real audience — so the population mean converged to the base
model's single opinion and the confidence interval measured noise variance
with an arbitrary scale (`alpha = 0.5 × resid_norm`). Running 2M "audience
members" extracted barely more information than asking the model once, at GPU
fleet cost and multi-hour latency.

The redesign inverts the priorities: **the audience is grounded in real
data, every component has a training pathway, and no LLM sits in the serving
path.** LLMs may appear later only as offline teachers (distillation).

## 2. Architecture

Three components with stable contracts. Each can evolve independently
(static → learned → reward-tuned) without touching the others or the product
surface. See `packages/resonance/ROADMAP.md` for the version arc.

### 2.1 AudienceSampler

`sample(n, seed) → audience vectors`

v1 implementation — **fitted mixture over real anchors**:

- Anchors are embeddings of the workspace's real audience artifacts pulled
  from the graph: published content (weighted by `performance_level`:
  high = 4, medium = 2, low = 1, unannotated = 1, title + insights text),
  active personas (name, target titles, description), and research topics.
- Sampling draws an anchor by weight, then adds a Gaussian noise kernel
  (`KERNEL_SIGMA`, fixed) so members vary around real audience traits.
- Seeded, deterministic (mulberry32-style PRNG): the same seed produces the
  same audience for every creative/frame — the paired design is preserved by
  construction.
- **Fallback:** a workspace with no graph anchors gets surface-conditioned
  default descriptors (embedded generic audience texts per
  `ResonanceSurface`), and the result is marked `audienceGrounding:
  "default"` so the UI can say the audience was not personalized. Anchored
  runs carry `audienceGrounding: "graph"`.

### 2.2 ResponseModel

`respond(creativeFrameVector, audienceVector) → pYes ∈ [0, 1]`

v1 implementation — **frame-conditioned similarity readout**:

- Each creative is embedded once per frame using a closed template that
  merges frame and surface semantics (the same closed-profile principle as
  the old worker's frame prompts: no arbitrary customer scoring
  instructions). ≤ 20 creatives × ≤ 4 frames = ≤ 80 embedding inputs, one
  batched call.
- `pYes = logistic((sim − baseline) / TAU)`, where `sim` is the cosine
  between the creative-frame vector and the audience vector, and `baseline`
  is the **same audience member's mean similarity across the run's scored
  creatives in the same frame** (paired-relative readout, revised
  2026-08-31 after live testing: absolute cosines in real embedding space
  sit in a narrow near-zero band that saturated a fixed-midpoint readout to
  ~3/100 for every creative; the between-creative differences are the
  signal). A score is "how much this creative beats the field for this
  audience", centered on 50. Explicitly a heuristic readout; v2 replaces it
  with a trained model behind the same contract.
- Embeddings come from the existing OpenAI `text-embedding-3-small` REST
  path (same model `extract_topics` uses), behind an injectable
  `EmbeddingClient` seam so tests run hermetically.

### 2.3 Calibrator

`calibrate(rawScore) → displayedScore`

v1: identity (plus the fixed logistic squash inside the readout). The
contract exists from day one so the isotonic fit on real performance
annotations (the first learning loop to pay off) can slot in without a
schema change.

## 3. Run lifecycle

The API shape is preserved: `POST /api/resonance/runs` → `{jobId}`,
`GET /api/resonance/runs/{jobId}` → `RunView`. Internally:

- A new `EngineTrigger implements ResonanceTrigger` replaces `ModalTrigger`.
  It computes the run **in-process and synchronously** inside `spawnRun`,
  then calls the same `complete(jobId, payload)` path `StubTrigger` uses.
  The job row, credit settle/release path, knowledge-event projection, and
  replay-safe one-shot transition in `server/runs.ts` are unchanged.
- `resolveTrigger`: `RESONANCE_RUNTIME_MODE=stub` → `StubTrigger` (unchanged,
  still the dev/e2e default); `live` → `EngineTrigger` (real embeddings, needs
  `OPENAI_API_KEY`). Modal mode is gone.
- `ResonanceTrigger.spawnRun` gains a context parameter carrying
  `organizationId` (the engine needs it to fetch graph anchors;
  `startReservedRun` already holds it).
- The poll-on-read reconcile machinery (`reconcileRun`,
  `sweepResonanceRuns`) stays — the stub streaming scenarios still exercise
  it and it remains correct for any future async trigger — but the
  Modal-specific parts (`ModalTrigger`, `ResonanceResultGoneError` handling,
  HMAC `webhook-security.ts`, `RESONANCE_TRIGGER_URL`/`RESONANCE_RESULT_URL`/
  `RESONANCE_TRIGGER_SECRET`) are removed.

### 3.1 Compute bounds

`audienceSize` (100–2,000,000) is the *simulated population*; the engine
computes on a Monte Carlo draw of at most `MAX_COMPUTED_CELLS = 200,000`
cells (`m = clamp(⌊cap / (creatives × frames)⌋, 500, audienceSize)` audience
draws). Score means and CIs are computed honestly on `m` (the CI reflects
what was actually sampled); tallies in the vote snapshot are scaled to
`audienceSize` as a display projection (exactly as the stub already does).
The result carries `computedAudienceSize` so nothing pretends otherwise.
Runs complete in seconds.

**Memory model (revised 2026-08-31 after staging 502s consistent with the
unified pod being killed mid-request):** the audience is streamed, never
materialized. Each member is drawn into one reused buffer, scored against
every creative-frame vector, and discarded, so peak resident memory is
O(creatives × frames × dims) — about a megabyte — independent of audience
size (measured: ≤ 2.2 MB growth at the cell cap, versus ~172 MB at 14k
members and ~614 MB at the cap for a materialized audience). The engine
logs `resonance.engine.run` with RSS/heap before and after each run.

### 3.2 Result contract

`RunResult` is preserved so the UI keeps working: `scores[]` (0–100,
`ci95`, `perFrame` on the same scale), `winner` with `tooCloseToCall` (CI
overlap), `voteSnapshot` (bounded, thumbs = `pYes ≥ 0.5`), `partial`/
`degradedReason` (now only for embedding-call failures). Additive optional
fields: `audienceGrounding`, `computedAudienceSize`. `model` reports
`"text-embedding-3-small+similarity-v1"`; `gpuSeconds` is 0; `usdCost` is
the embedding token cost estimate. `domain/result-contract.json` continues
to pin both remaining producers (engine aggregate + stub); the Python
contract test retires with the Python producer.

### 3.3 Pricing

Credits: **flat 1 credit per run** (product decision, approved). Real cost
is one batched embeddings call; per-cell GPU pricing no longer reflects
anything. `estimateRun` remains the single pricing authority and settlement
uses the same function — reserve and settle can no longer disagree.

## 4. What is removed

- `services/resonance/modal_app.py`, `resonance_core/`, `poc/`, Python
  tests: the GPU scorer, steering machinery, signed trigger/result
  endpoints. The directory survives with a rewritten README as the future
  **training home** (v2 distillation, v3 generator/reward training —
  Python/torch territory).
- `packages/resonance/webhook-security.ts` + tests, `ModalTrigger` + tests.
- Modal env plumbing in `scripts/validate-production-env.mjs` (live mode now
  validates `OPENAI_API_KEY` instead).
- In-flight Modal jobs at deploy time are orphaned; acceptable pre-GA.

## 5. Error handling

- Embedding call fails entirely → job `failed`, reservation released, no
  charge (same path a Modal crash took).
- Partial embedding failure (some batch items) → degraded result:
  `partial: true`, `degradedReason`, affected creatives
  `insufficientData: true` — the existing degraded-run UI renders it.
- No graph anchors → **not** an error: default-audience fallback, marked in
  the result (§2.1).
- Graph unreachable → fall back to default anchors, log, mark
  `audienceGrounding: "default"`; a resonance run must not depend on graph
  availability.

## 6. Testing

- Engine pure functions (`runSimulation(run, anchors, creativeVectors) →
  RunResult`): seeded determinism (same seed ⇒ identical result), paired
  design (audience identical across creatives), CI behavior (widens with
  smaller `m`), winner/tie logic, tally scaling, degraded paths — all
  hermetic, embedding client stubbed with hash-based vectors.
- Contract tests: engine aggregate and `StubTrigger` both pinned to
  `result-contract.json` (scale invariants).
- Lifecycle tests in `tests/server.test.ts` continue to pass unchanged
  (the trigger seam is the same); add an `EngineTrigger` lifecycle case.
- Anchor fetch: unit tests over a stubbed graph session (weighting,
  fallback on empty/unreachable).

## 7. Learning pathways (documented, not built)

See `packages/resonance/ROADMAP.md` — committed alongside this spec — for
v2 (learned response model: offline LLM distillation + public engagement
corpora + own-outcome fine-tuning; isotonic calibration), v3 (thin
generator behind `AudienceSampler`, then the publish→observe→reward loop),
and the two permanent invariants: the anchor-distribution constraint that
prevents generator collapse, and reward-loop-as-refinement (the system must
be useful with zero reward data).
