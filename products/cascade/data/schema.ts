import {
  contactsInCascade,
  databaseFor,
  funnel_membersInCascade,
  funnelsInCascade,
  plain_text_emailsInCascade,
} from "@content-automation/database";
import { isNull, sql } from "drizzle-orm";
import type { Pool } from "pg";

/** Cascade tables are provisioned exclusively by the root Drizzle migrations. */
export async function ensureCascadeSchema(_pool: Pool): Promise<void> {
  return Promise.resolve();
}

/** Explicitly assign pre-tenancy rows. Never call this based on request context. */
export async function assignLegacyCascadeData(pool: Pool, organizationId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(organizationId)) throw new Error("Invalid organization ID.");
  await databaseFor(pool).transaction(async (tx) => {
    await tx.execute(sql`set local row_security = off`);
    await tx.update(funnelsInCascade).set({ organization_id: organizationId }).where(isNull(funnelsInCascade.organization_id));
    await tx.update(contactsInCascade).set({ organization_id: organizationId }).where(isNull(contactsInCascade.organization_id));
    await tx.update(funnel_membersInCascade).set({ organization_id: organizationId }).where(isNull(funnel_membersInCascade.organization_id));
    await tx.update(plain_text_emailsInCascade).set({ organization_id: organizationId }).where(isNull(plain_text_emailsInCascade.organization_id));
  });
}

export async function dropCascadeSchema(_pool: Pool): Promise<void> {
  return Promise.resolve();
}
