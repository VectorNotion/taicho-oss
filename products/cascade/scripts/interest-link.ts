import { getCascadePool } from "../data/pool";
import { publicUrl } from "../engine/compose";
import { signToken } from "../engine/tokens";

// Prints the interest click URL for the most recent sent email that has an
// interest_url — handy for demos and manual testing of the routing path.
const pool = getCascadePool();
const [row] = await databaseFor(pool)
  .select({ id: sendsInCascade.id, interestUrl: emailsInCascade.interest_url })
  .from(sendsInCascade)
  .innerJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, sendsInCascade.step_id))
  .innerJoin(emailsInCascade, sql`${emailsInCascade.id} = (${funnelStepsInCascade.config}->>'emailId')::uuid`)
  .where(and(eq(sendsInCascade.status, "sent"), isNotNull(emailsInCascade.interest_url)))
  .orderBy(desc(sendsInCascade.created_at))
  .limit(1);
if (!row?.interestUrl) {
  console.log("no sent emails with an interest url yet");
} else {
  console.log(`${publicUrl()}/c/${signToken({ t: "click", s: row.id, u: row.interestUrl, i: 1 })}`);
}
await pool.end();
import {
  databaseFor,
  emailsInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  sendsInCascade,
} from "@content-automation/database";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
