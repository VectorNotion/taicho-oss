# The closed loop

The part that earns the product. Four stages, running continuously — all implemented:

**1. Generate.** For a given step, the content agent (`agent/content-agent.ts`) generates a small set of variants — subject, preheader, slot fills — grounded in the synced asset library and the `offers` source of truth; the template agent produces layouts. Everything lands as `draft` and must pass the validation gate (`agent/validate.ts`) before it can go anywhere.

**2. Allocate.** The engine sends variants under a Thompson sampling bandit (`engine/bandit.ts`, Beta over interest-per-send): even exploration first, then traffic shifts toward what performs. The pick is stamped on `sends.variant_id` at enqueue. Allocation is deterministic and lives on the hot path; generation does not.

**3. Measure.** Events flow back — open, click, and above all **interest** (a click on the email's `interest_url`, the hand-raise that routes a lead to the next funnel) — and update `variant_stats`, the bandit's arm weights.

**4. Regenerate.** The optimizer (`agent/optimizer.ts`, run via `pnpm cascade:optimize` on cron): reads per-variant performance, retires arms whose interest rate falls below half the winner's (minimum 50 sends before judgment, never retiring the last arm), and breeds replacement variants from the winner's angle at generation + 1 — each bred variant passing the validation gate again.

The bandit is the inner loop (fast, within a generation). The optimizer is the outer loop (slow, across generations) — where gains compound. **Segments are the unit of learning** — in the design; today every variant sits in the single `'all'` segment, and multi-segment learning is still open ([open-questions.md](open-questions.md)).

## What the loop optimizes

The business is enterprise-shaped: the funnel's job is qualification and promotion, not immediate purchase. So the loop's true objective is **funnel progression** — interest events that move leads to the next funnel — with revenue (`convert` + value) taking over as the objective once revenue events exist downstream. Opens and clicks are leading indicators only.

## Risks and design constraints

| Failure mode | Why it happens | Design response |
|---|---|---|
| **Optimizing on the wrong signal** | Interest is sparser and slower than opens/clicks. Optimizing on open rate breeds clickbait subjects that tank real progression. | Optimize on a leading indicator (click-through, reply) but validate against the true objective (interest, downstream progression). Weight the loop toward the promotion event even though it's noisier. |
| **Not enough volume to learn** | At a few thousand sends/day, 20 variants per step never reach significance; the loop thrashes. | Hard cap of **2–4 arms per step per segment** (enforced at 4 by `activateVariant`). Concentration, not breadth. |
| **Hallucinated offers** | An agent inventing a claim or offer that doesn't exist is a liability. | Every artifact passes a **validation gate** before send-eligibility (`variants.status = 'validated'`): offer claims checked against the `offers` table, asset references must resolve to real `assets` rows, and the template must compile with an unsubscribe link. Non-negotiable. |
| **Deliverability under high content variance** | Wildly different content per send erodes template-reputation consistency and pushes toward complaint limits. | Generate at the **segment level** to bound variance; every send obeys [deliverability.md](deliverability.md). |

## Human control

The autonomy dial, implemented as `cascade_settings.autonomy` and settable from the Variants page in `apps/unified`: under `approve_all` (default) a human approves every validated variant before it goes active; under `auto_activate` the optimizer activates its bred variants itself, still capped at 4 arms and still behind the validation gate. See [roadmap.md](roadmap.md).
