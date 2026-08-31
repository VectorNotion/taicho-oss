process.env.CASCADE_SCHEMA = "cascade";

import {
  contactsInCascade,
  databaseFor,
  funnel_decisionsInCascade as funnelDecisionsInCascade,
  funnel_edgesInCascade as funnelEdgesInCascade,
  funnel_eventsInCascade as funnelEventsInCascade,
  funnel_membersInCascade as funnelMembersInCascade,
  funnel_nodesInCascade as funnelNodesInCascade,
  funnel_repliesInCascade as funnelRepliesInCascade,
  funnelsInCascade,
  plain_text_emailsInCascade as plainTextEmailsInCascade,
  step_outputsInCascade as stepOutputsInCascade,
} from "@content-automation/database";
import type { Pool } from "pg";
import { getCascadePool } from "../data/pool";

/** Reset data without mutating migration-owned database structure. */
export async function freshSchema(): Promise<Pool> {
  const pool = getCascadePool();
  await databaseFor(pool).transaction(async (tx) => {
    await tx.delete(funnelDecisionsInCascade);
    await tx.delete(funnelRepliesInCascade);
    await tx.delete(stepOutputsInCascade);
    await tx.delete(funnelEventsInCascade);
    await tx.delete(funnelEdgesInCascade);
    await tx.delete(funnelNodesInCascade);
    await tx.delete(plainTextEmailsInCascade);
    await tx.delete(funnelMembersInCascade);
    await tx.delete(funnelsInCascade);
    await tx.delete(contactsInCascade);
  });
  return pool;
}
