# Open questions

## Settled

| Question | Answer |
|---|---|
| Where does Cascade live? | Third product in this monorepo: `products/cascade` ([ADR 0005](decisions/0005-cascade-as-third-product-in-monorepo.md)) |
| Where does content come from? | Pulled from the content engine over a sync boundary; possibly integrated into Cascade later ([ADR 0006](decisions/0006-content-synced-from-content-engine.md)) |
| What is "conversion"? | An **interest signal** that promotes the lead to the next funnel. Enterprise sale: many touchpoints, funnels chained. Revenue events come later. |
| Newsletter scope? | A funnel in Cascade — the open-ended "newsletter queue." Cascade does funnel management end to end; leads move funnel → funnel forever. |
| Shape of `content`? | Subject/preheader columns plus slot fills (`hero`, `body`, `cta`), slots referencing synced `assets` via Handlebars. Implemented in `data/schema.ts` / `engine/compose.ts`. |
| Campaign ↔ funnel? | Superseded: the funnel graph (`funnel_routes`) is the core object; a campaign/grouping layer can come later if needed. |
| The concrete interest signal | Implemented: a click on the email's designated `interest_url`. Compose flags that link in the signed click token; ingestion records `click` + `interest` and `routeOnInterest` promotes the contact along the funnel's `interest` route immediately. Replies/booked calls could become additional signals later. |
| Scheduler choice | Implemented: neither pg-boss nor Bree — a plain poll loop in `engine/worker.ts` (default 1s interval) claiming due enrollments with `FOR UPDATE SKIP LOCKED`. Queue state is the `enrollments`/`sends` tables themselves. See the status note on [ADR 0002](decisions/0002-postgres-state-machine-over-workflow-engine.md). |
| Where approval UI lives | Implemented: the Variants page in `apps/unified` (`/cascade/variants`) — validate/approve/retire per variant plus the autonomy dial (`cascade_settings.autonomy`). |

## Still open

1. **Multi-segment learning.** Variants carry a `segment` column but everything runs in the single `'all'` segment; there is no `segments` table or rule-based membership. When volume justifies it, segments become the unit of generation and allocation ([closed-loop.md](closed-loop.md)).
2. **Content-generator live adapter.** Asset sync runs through the `ContentSource` interface with only `StaticContentSource` implemented. A real adapter pulling published content from `products/content-generator` (which repositories/fields, sync cadence) is still to be built.
3. **Outreach hand-off automation.** `importOutreachLead` is the intake boundary, but nothing in `products/outreach` calls it yet — hand-off is manual (UI enrollment, seeds). Automating lead flow outreach → Cascade is open.
4. **Worker supervision and deployment.** The worker runs in the foreground (`pnpm cascade:worker`); there is no process supervision, restart policy, or deployment story — and the unsubscribe endpoint lives in the worker, so uptime is a compliance concern (monitor `/healthz`).
5. **UI design sweep.** The Cascade pages are functional shadcn defaults; a design pass to bring them up to the rest of the unified app's polish is pending.
