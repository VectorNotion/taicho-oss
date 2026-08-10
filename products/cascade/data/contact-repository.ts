import {
  contactsInCascade as contactsTable,
  databaseFor,
  funnel_membersInCascade as funnelMembersTable,
} from "@content-automation/database";
import { desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Contact } from "../domain/types";

export async function createContact(
  pool: Pool,
  input: { email: string; timezone?: string; subscriptionStatus?: Contact["subscriptionStatus"] },
): Promise<Contact> {
  const [row] = await databaseFor(pool).insert(contactsTable).values({
    email: input.email,
    timezone: input.timezone ?? null,
    subscription_status: input.subscriptionStatus ?? "subscribed",
  }).returning();
  return contactFromRow(row);
}

export function contactFromRow(row: {
  id: string;
  email: string;
  timezone: string | null;
  attributes: unknown;
  subscription_status: string;
  workspace_contact_id: string | null;
  outreach_prospect_id: string | null;
}): Contact {
  return {
    id: row.id,
    email: row.email,
    timezone: row.timezone,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    subscriptionStatus: row.subscription_status as Contact["subscriptionStatus"],
    workspaceContactId: row.workspace_contact_id,
    outreachProspectId: row.outreach_prospect_id,
  };
}

export interface NurtureContactProjection {
  id: string;
  workspaceContactId: string | null;
  email: string;
  attributes: Record<string, unknown>;
  timezone: string | null;
  subscriptionStatus: Contact["subscriptionStatus"];
  funnelCount: number;
}

export async function listContacts(
  pool: Pool,
): Promise<NurtureContactProjection[]> {
  const rows = await databaseFor(pool).select({
    id: contactsTable.id,
    workspace_contact_id: contactsTable.workspace_contact_id,
    email: contactsTable.email,
    attributes: contactsTable.attributes,
    timezone: contactsTable.timezone,
    subscription_status: contactsTable.subscription_status,
    funnel_count: sql<number>`count(${funnelMembersTable.id})::int`,
  }).from(contactsTable)
    .leftJoin(funnelMembersTable, eq(funnelMembersTable.contact_id, contactsTable.id))
    .groupBy(contactsTable.id)
    .orderBy(desc(contactsTable.created_at));
  return rows.map((row) => ({
    id: row.id,
    workspaceContactId: row.workspace_contact_id,
    email: row.email,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    timezone: row.timezone,
    subscriptionStatus: row.subscription_status as Contact["subscriptionStatus"],
    funnelCount: row.funnel_count,
  }));
}
