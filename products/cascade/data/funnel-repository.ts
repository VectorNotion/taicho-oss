import {
  contactsInCascade,
  databaseFor,
  funnel_membersInCascade as funnelMembersInCascade,
  funnelsInCascade,
  plain_text_emailsInCascade as plainTextEmailsInCascade,
} from "@content-automation/database";
import { and, asc, count, desc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import type { ActorType } from "@content-automation/observability";

export interface FunnelSummary {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  emailCount: number;
}

export interface FunnelMember {
  id: string;
  contactId: string;
  workspaceContactId: string | null;
  email: string;
  attributes: Record<string, unknown>;
  addedAt: string;
}

export async function createFunnel(
  pool: Pool,
  input: { name: string },
): Promise<FunnelSummary> {
  const name = input.name.trim();
  if (!name) throw new Error("funnel name is required");
  const [row] = await databaseFor(pool).insert(funnelsInCascade).values({
    name,
    open_ended: false,
  }).returning({
    id: funnelsInCascade.id,
    name: funnelsInCascade.name,
    createdAt: funnelsInCascade.created_at,
  });
  return { ...row, memberCount: 0, emailCount: 0 };
}

export async function listFunnels(pool: Pool): Promise<FunnelSummary[]> {
  const db = databaseFor(pool);
  const [funnels, memberCounts, emailCounts] = await Promise.all([
    db.select({
      id: funnelsInCascade.id,
      name: funnelsInCascade.name,
      createdAt: funnelsInCascade.created_at,
    }).from(funnelsInCascade).orderBy(desc(funnelsInCascade.created_at)),
    db.select({ funnelId: funnelMembersInCascade.funnel_id, value: count() })
      .from(funnelMembersInCascade)
      .groupBy(funnelMembersInCascade.funnel_id),
    db.select({ funnelId: plainTextEmailsInCascade.funnel_id, value: count() })
      .from(plainTextEmailsInCascade)
      .groupBy(plainTextEmailsInCascade.funnel_id),
  ]);
  const membersByFunnel = new Map(memberCounts.map((row) => [row.funnelId, row.value]));
  const emailsByFunnel = new Map(emailCounts.map((row) => [row.funnelId, row.value]));
  return funnels.map((funnel) => ({
    ...funnel,
    memberCount: membersByFunnel.get(funnel.id) ?? 0,
    emailCount: emailsByFunnel.get(funnel.id) ?? 0,
  }));
}

export async function getFunnel(
  pool: Pool,
  funnelId: string,
): Promise<FunnelSummary | null> {
  const [funnel] = (await listFunnels(pool)).filter((item) => item.id === funnelId);
  return funnel ?? null;
}

export async function renameFunnel(
  pool: Pool,
  funnelId: string,
  name: string,
): Promise<FunnelSummary> {
  const normalized = name.trim();
  if (!normalized) throw new Error("funnel name is required");
  const [updated] = await databaseFor(pool).update(funnelsInCascade)
    .set({ name: normalized })
    .where(eq(funnelsInCascade.id, funnelId))
    .returning({ id: funnelsInCascade.id });
  if (!updated) throw new Error("funnel not found");
  return (await getFunnel(pool, funnelId))!;
}

export async function deleteFunnel(pool: Pool, funnelId: string): Promise<void> {
  const deleted = await databaseFor(pool).delete(funnelsInCascade)
    .where(eq(funnelsInCascade.id, funnelId))
    .returning({ id: funnelsInCascade.id });
  if (deleted.length === 0) throw new Error("funnel not found");
}

export async function listFunnelMembers(
  pool: Pool,
  funnelId: string,
): Promise<FunnelMember[]> {
  const rows = await databaseFor(pool).select({
    id: funnelMembersInCascade.id,
    contactId: contactsInCascade.id,
    workspaceContactId: contactsInCascade.workspace_contact_id,
    email: contactsInCascade.email,
    attributes: contactsInCascade.attributes,
    addedAt: funnelMembersInCascade.created_at,
  }).from(funnelMembersInCascade)
    .innerJoin(contactsInCascade, eq(contactsInCascade.id, funnelMembersInCascade.contact_id))
    .where(eq(funnelMembersInCascade.funnel_id, funnelId))
    .orderBy(asc(funnelMembersInCascade.created_at));
  return rows.map((row) => ({
    ...row,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  }));
}

export async function addFunnelMember(
  pool: Pool,
  input: {
    funnelId: string;
    contactId: string;
    createdBy?: string;
    actorType?: ActorType;
    requestId?: string;
    parentExecutionId?: string;
    traceId?: string;
    traceparent?: string;
  },
): Promise<FunnelMember> {
  const [created] = await databaseFor(pool).insert(funnelMembersInCascade).values({
    funnel_id: input.funnelId,
    contact_id: input.contactId,
    created_by: input.createdBy ?? null,
    actor_type: input.actorType ?? null,
    request_id: input.requestId ?? null,
    parent_execution_id: input.parentExecutionId ?? null,
    trace_id: input.traceId ?? null,
    traceparent: input.traceparent ?? null,
  }).onConflictDoNothing({
    target: [funnelMembersInCascade.funnel_id, funnelMembersInCascade.contact_id],
  }).returning({ id: funnelMembersInCascade.id });

  const members = await listFunnelMembers(pool, input.funnelId);
  const member = created
    ? members.find((item) => item.id === created.id)
    : members.find((item) => item.contactId === input.contactId);
  if (!member) throw new Error("contact or funnel not found");
  return member;
}

export async function removeFunnelMember(
  pool: Pool,
  funnelId: string,
  contactId: string,
): Promise<void> {
  await databaseFor(pool).delete(funnelMembersInCascade).where(and(
    eq(funnelMembersInCascade.funnel_id, funnelId),
    eq(funnelMembersInCascade.contact_id, contactId),
  ));
}

export async function countFunnelMembers(pool: Pool, contactId: string): Promise<number> {
  const [row] = await databaseFor(pool).select({ n: count() })
    .from(funnelMembersInCascade)
    .where(eq(funnelMembersInCascade.contact_id, contactId));
  return row.n;
}
