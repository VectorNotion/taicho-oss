import {
  contactsInCascade as contactsTable,
  databaseFor,
} from "@content-automation/database";
import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Contact } from "../domain/types";
import { contactFromRow } from "./contact-repository";

/**
 * Prospect intake boundary: outreach (products/outreach) hands a prospect to
 * Cascade. Upserts by email; re-imports refresh attributes and the prospect
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
    outreach_prospect_id: input.workspaceContactId,
    attributes: input.attributes ?? {},
    timezone: input.timezone ?? null,
  }).onConflictDoUpdate({
    target: [contactsTable.organization_id, contactsTable.email],
    set: {
      workspace_contact_id: sql`excluded.workspace_contact_id`,
      outreach_prospect_id: sql`excluded.outreach_prospect_id`,
      // Product handoffs may refresh descriptive fields, but the first known
      // relationship source is identity history and must not be overwritten
      // by a later duplicate add through another surface.
      attributes: sql`${contactsTable.attributes} || excluded.attributes || case when ${contactsTable.attributes} ? 'source' then jsonb_build_object('source', ${contactsTable.attributes}->'source') else '{}'::jsonb end`,
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
export async function importOutreachProspect(
  pool: Pool,
  input: {
    email: string;
    outreachProspectId: string;
    attributes?: Record<string, unknown>;
    timezone?: string;
  },
): Promise<Contact> {
  return importWorkspaceContact(pool, {
    email: input.email,
    workspaceContactId: input.outreachProspectId,
    attributes: input.attributes,
    timezone: input.timezone,
  });
}
