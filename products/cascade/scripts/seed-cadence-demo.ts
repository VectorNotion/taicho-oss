import { getCascadePool } from "../data/pool";
import { ensureCascadeSchema } from "../data/schema";
import { createFunnel } from "../data/funnel-repository";
import { enrollContact } from "../data/enrollment-repository";
import { importOutreachLead } from "../data/intake";
import { runTick } from "../engine/tick";

// A day-1 / day-7 / day-10 / day-15 cadence: delays gate the NEXT step, so
// the gaps are 6, 3, and 5 days. Proves multi-day durable scheduling.
const DAY = 86400;

const pool = getCascadePool();
await ensureCascadeSchema(pool);

const { funnel } = await createFunnel(pool, {
  name: "Enterprise cadence (day 1-7-10-15)",
  steps: [
    { type: "email", config: { subject: "Day 1 — Welcome", body: "Kickoff email." } },
    { type: "delay", config: { seconds: 6 * DAY } },
    { type: "email", config: { subject: "Day 7 — Case study", body: "Proof email." } },
    { type: "delay", config: { seconds: 3 * DAY } },
    { type: "email", config: { subject: "Day 10 — Objections", body: "FAQ email." } },
    { type: "delay", config: { seconds: 5 * DAY } },
    { type: "email", config: { subject: "Day 15 — The ask", body: `<a href="https://cascade.example/book-call">Book a call</a>` } },
    { type: "goal", config: {} },
  ],
});

const lead = await importOutreachLead(pool, {
  email: `cadence-${Date.now()}@example.com`,
  outreachLeadId: `cadence-${Date.now()}`,
  attributes: { company: "CadenceCorp" },
});
await enrollContact(pool, funnel.id, lead.id);

// One tick: day-1 email queues, then the enrollment parks 6 days out.
const tick = await runTick(pool);
const [state] = await databaseFor(pool)
  .select({
    state: enrollmentsInCascade.state,
    nextRunAt: enrollmentsInCascade.next_run_at,
    position: funnelStepsInCascade.position,
  })
  .from(enrollmentsInCascade)
  .leftJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, enrollmentsInCascade.current_step_id))
  .where(eq(enrollmentsInCascade.funnel_id, funnel.id))
  .limit(1);
console.log(`funnel=${funnel.id} contact=${lead.email}`);
console.log(`tick processed=${tick.processed} queued=${tick.queued}`);
console.log(
  `enrollment: state=${state?.state} at step ${state?.position}, next run ${state?.nextRunAt}`,
);
await pool.end();
import {
  databaseFor,
  enrollmentsInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
} from "@content-automation/database";
import { eq } from "drizzle-orm";
