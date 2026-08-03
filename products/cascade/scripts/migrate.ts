import { getCascadeAdminPool, schemaName } from "../data/pool";
import { contactsInCascade, databaseFor } from "@content-automation/database";
import { runMigrations } from "@content-automation/database/migrate";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { closeDriver, runWithGraphOrganization } from "@content-automation/platform/data/graph";
import {
  addWorkspaceContactRole,
  ensureWorkspaceContact,
} from "@content-automation/platform/workspace/contacts";

await runMigrations();
const pool = getCascadeAdminPool();
const db = databaseFor(pool);
const legacyContacts = await db
  .select({
    id: contactsInCascade.id,
    organizationId: contactsInCascade.organization_id,
    email: contactsInCascade.email,
    attributes: contactsInCascade.attributes,
    workspaceContactId: contactsInCascade.workspace_contact_id,
    outreachLeadId: contactsInCascade.outreach_lead_id,
  })
  .from(contactsInCascade)
  .where(and(isNotNull(contactsInCascade.organization_id), isNull(contactsInCascade.workspace_contact_linked_at)));
let promoted = 0;
try {
  for (const row of legacyContacts) {
    if (!row.organizationId) continue;
    const proposedIds = [
      row.workspaceContactId,
      row.outreachLeadId,
    ];
    const legacyId = proposedIds.find(
      (value): value is string =>
        Boolean(
          value
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value,
          ),
        ),
    );
    const result = await runWithGraphOrganization(
      row.organizationId,
      async () => {
        const ensured = await ensureWorkspaceContact({
          id: legacyId,
          email: row.email,
          name:
            typeof (row.attributes as Record<string, unknown>).name === "string"
              ? String((row.attributes as Record<string, unknown>).name)
              : row.email,
          company:
            typeof (row.attributes as Record<string, unknown>).company === "string"
              ? String((row.attributes as Record<string, unknown>).company)
              : undefined,
          title:
            typeof (row.attributes as Record<string, unknown>).title === "string"
              ? String((row.attributes as Record<string, unknown>).title)
              : undefined,
        });
        await addWorkspaceContactRole(ensured.contact.id, "nurture");
        return ensured;
      },
    );
    await db
      .update(contactsInCascade)
      .set({
        workspace_contact_id: result.contact.id,
        outreach_lead_id: sql`coalesce(${contactsInCascade.outreach_lead_id}, ${result.contact.id})`,
        workspace_contact_linked_at: sql`now()`,
      })
      .where(and(eq(contactsInCascade.organization_id, row.organizationId), eq(contactsInCascade.id, row.id)));
    promoted += 1;
  }
  console.log(
    `Cascade schema '${schemaName()}' is current (${promoted} legacy contacts linked to workspace identities).`,
  );
} finally {
  await Promise.all([pool.end(), closeDriver()]);
}
