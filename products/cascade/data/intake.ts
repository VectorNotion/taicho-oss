import {
  contactsInCascade as contactsTable,
  databaseFor,
} from "@content-automation/database";
import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Contact } from "../domain/types";
import { contactFromRow } from "./contact-repository";

/**
 * Lead intake boundary: outreach (products/outreach) hands a lead to
 * Cascade. Upserts by email; re-imports refresh attributes and the lead
 * link but never resurrect an unsubscribed/suppressed contact.
 */
export async function importWorkspaceContact(
  pool: Pool,
  input: {
    email: string;
    workspaceContactId: string;
    attributes?: Record<string, unknown>;
    timezone?: string;
  },
): Promise<Contact> {
  const [row] = await databaseFor(pool).insert(contactsTable).values({
    email: input.email,
    workspace_contact_id: input.workspaceContactId,
    outreach_lead_id: input.workspaceContactId,
    attributes: input.attributes ?? {},
    timezone: input.timezone ?? null,
  }).onConflictDoUpdate({
    target: [contactsTable.organization_id, contactsTable.email],
    set: {
      workspace_contact_id: sql`excluded.workspace_contact_id`,
      outreach_lead_id: sql`excluded.outreach_lead_id`,
      attributes: sql`${contactsTable.attributes} || excluded.attributes`,
      timezone: sql`coalesce(excluded.timezone, ${contactsTable.timezone})`,
    },
  }).returning();
  return contactFromRow(row);
}

/**
 * Record that the canonical graph role has been written. If this update fails,
 * the startup migration safely retries the idempotent graph link.
 */
export async function markWorkspaceContactLinked(
  pool: Pool,
  contactId: string,
): Promise<void> {
  await databaseFor(pool).update(contactsTable)
    .set({ workspace_contact_linked_at: sql`now()` })
    .where(eq(contactsTable.id, contactId));
}

/** @deprecated Use importWorkspaceContact with the canonical workspace ID. */
export async function importOutreachLead(
  pool: Pool,
  input: {
    email: string;
    outreachLeadId: string;
    attributes?: Record<string, unknown>;
    timezone?: string;
  },
): Promise<Contact> {
  return importWorkspaceContact(pool, {
    email: input.email,
    workspaceContactId: input.outreachLeadId,
    attributes: input.attributes,
    timezone: input.timezone,
  });
}
