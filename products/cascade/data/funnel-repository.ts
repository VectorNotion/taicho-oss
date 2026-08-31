import {
  contactsInCascade,
  databaseFor,
  funnel_eventsInCascade as funnelEventsInCascade,
  funnel_membersInCascade as funnelMembersInCascade,
  funnel_nodesInCascade as funnelNodesInCascade,
  funnelsInCascade,
  plain_text_emailsInCascade as plainTextEmailsInCascade,
  step_outputsInCascade as stepOutputsInCascade,
} from "@content-automation/database";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { ActorType } from "@content-automation/observability";
import { PendingMemberDeliveryError, type Attribution } from "./graph-repository";

export interface FunnelSummary {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  memberCount: number;
  emailCount: number;
  stepCount: number;
  currentMembership: {
    id: string;
    contactId: string;
    currentNodeId: string | null;
    status: string;
    enteredNodeAt: string | null;
  } | null;
}

export interface FunnelMember {
  id: string;
  contactId: string;
  workspaceContactId: string | null;
  email: string;
  attributes: Record<string, unknown>;
  addedAt: string;
  currentNodeId: string | null;
  status: string;
  statusReason: string | null;
  enteredNodeAt: string | null;
  attempt: number;
}

export class FunnelMemberTransferConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FunnelMemberTransferConflictError";
  }
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
    version: funnelsInCascade.version,
    createdAt: funnelsInCascade.created_at,
  });
  return { ...row, memberCount: 0, emailCount: 0, stepCount: 0, currentMembership: null };
}

export async function listFunnels(
  pool: Pool,
  input: { workspaceContactId?: string } = {},
): Promise<FunnelSummary[]> {
  const db = databaseFor(pool);
  const [funnels, memberCounts, emailCounts, nodeCounts, currentMemberships] = await Promise.all([
    db.select({
      id: funnelsInCascade.id,
      name: funnelsInCascade.name,
      version: funnelsInCascade.version,
      createdAt: funnelsInCascade.created_at,
    }).from(funnelsInCascade).orderBy(desc(funnelsInCascade.created_at)),
    db.select({ funnelId: funnelMembersInCascade.funnel_id, value: count() })
      .from(funnelMembersInCascade)
      .groupBy(funnelMembersInCascade.funnel_id),
    db.select({ funnelId: plainTextEmailsInCascade.funnel_id, value: count() })
      .from(plainTextEmailsInCascade)
      .groupBy(plainTextEmailsInCascade.funnel_id),
    db.select({ funnelId: funnelNodesInCascade.funnel_id, value: count() })
      .from(funnelNodesInCascade)
      .groupBy(funnelNodesInCascade.funnel_id),
    input.workspaceContactId
      ? db.select({
          funnelId: funnelMembersInCascade.funnel_id,
          id: funnelMembersInCascade.id,
          contactId: funnelMembersInCascade.contact_id,
          currentNodeId: funnelMembersInCascade.current_node_id,
          status: funnelMembersInCascade.status,
          enteredNodeAt: funnelMembersInCascade.entered_node_at,
        })
          .from(funnelMembersInCascade)
          .innerJoin(contactsInCascade, eq(contactsInCascade.id, funnelMembersInCascade.contact_id))
          .where(eq(contactsInCascade.workspace_contact_id, input.workspaceContactId))
      : Promise.resolve([]),
  ]);
  const membersByFunnel = new Map(memberCounts.map((row) => [row.funnelId, row.value]));
  const emailsByFunnel = new Map(emailCounts.map((row) => [row.funnelId, row.value]));
  const nodesByFunnel = new Map(nodeCounts.map((row) => [row.funnelId, row.value]));
  const membershipByFunnel = new Map(currentMemberships.map(({ funnelId, ...membership }) => [funnelId, membership]));
  return funnels.map((funnel) => ({
    ...funnel,
    memberCount: membersByFunnel.get(funnel.id) ?? 0,
    emailCount: emailsByFunnel.get(funnel.id) ?? 0,
    stepCount: nodesByFunnel.get(funnel.id) ?? 0,
    currentMembership: membershipByFunnel.get(funnel.id) ?? null,
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
    .set({ name: normalized, version: sql`${funnelsInCascade.version} + 1` })
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
    currentNodeId: funnelMembersInCascade.current_node_id,
    status: funnelMembersInCascade.status,
    statusReason: funnelMembersInCascade.status_reason,
    enteredNodeAt: funnelMembersInCascade.entered_node_at,
    attempt: funnelMembersInCascade.attempt,
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
): Promise<FunnelMember & { membershipCreated: boolean }> {
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

  if (created) {
    const [funnel] = await databaseFor(pool).select({ entryNodeId: funnelsInCascade.entry_node_id })
      .from(funnelsInCascade).where(eq(funnelsInCascade.id, input.funnelId));
    if (funnel?.entryNodeId) {
      await databaseFor(pool).update(funnelMembersInCascade).set({
        current_node_id: funnel.entryNodeId,
        entered_node_at: sql`now()`,
      }).where(eq(funnelMembersInCascade.id, created.id));
      await databaseFor(pool).insert(funnelEventsInCascade).values({
        funnel_id: input.funnelId,
        member_id: created.id,
        node_id: funnel.entryNodeId,
        type: "entered",
        created_by: input.createdBy ?? null,
        actor_type: input.actorType ?? null,
        request_id: input.requestId ?? null,
        parent_execution_id: input.parentExecutionId ?? null,
        trace_id: input.traceId ?? null,
        traceparent: input.traceparent ?? null,
      });
    }
  }

  const members = await listFunnelMembers(pool, input.funnelId);
  const member = created
    ? members.find((item) => item.id === created.id)
    : members.find((item) => item.contactId === input.contactId);
  if (!member) throw new Error("contact or funnel not found");
  return { ...member, membershipCreated: Boolean(created) };
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

/**
 * Transfer an active/paused relationship without deleting its source history.
 * The source membership becomes exited while one new relationship starts at
 * the destination entry step, so runners see exactly one eligible member.
 */
export async function transferFunnelMember(
  pool: Pool,
  input: {
    sourceFunnelId: string;
    targetFunnelId: string;
    contactId: string;
    reason?: string;
  },
  attribution: Attribution,
): Promise<{ member: FunnelMember; sourceFunnelName: string; targetFunnelName: string }> {
  if (input.sourceFunnelId === input.targetFunnelId) {
    throw new FunnelMemberTransferConflictError("Choose a different funnel.");
  }

  const transferred = await databaseFor(pool).transaction(async (tx) => {
    // Lock funnels in stable id order so opposite-direction transfers cannot
    // deadlock one another.
    const lockedFunnels = await tx.select({
      id: funnelsInCascade.id,
      name: funnelsInCascade.name,
      entryNodeId: funnelsInCascade.entry_node_id,
    }).from(funnelsInCascade)
      .where(inArray(funnelsInCascade.id, [input.sourceFunnelId, input.targetFunnelId]))
      .orderBy(asc(funnelsInCascade.id))
      .for("update");
    const sourceFunnel = lockedFunnels.find((funnel) => funnel.id === input.sourceFunnelId);
    const targetFunnel = lockedFunnels.find((funnel) => funnel.id === input.targetFunnelId);
    if (!sourceFunnel || !targetFunnel) throw new Error("funnel not found");
    if (!targetFunnel.entryNodeId) {
      throw new FunnelMemberTransferConflictError("The destination funnel needs an entry step before people can be moved into it.");
    }

    const [source] = await tx.select({
      id: funnelMembersInCascade.id,
      status: funnelMembersInCascade.status,
      statusReason: funnelMembersInCascade.status_reason,
      snoozedUntil: funnelMembersInCascade.snoozed_until,
    }).from(funnelMembersInCascade).where(and(
      eq(funnelMembersInCascade.funnel_id, input.sourceFunnelId),
      eq(funnelMembersInCascade.contact_id, input.contactId),
    )).for("update");
    if (!source) throw new Error("member not found");
    if (!["active", "paused"].includes(source.status)) {
      throw new FunnelMemberTransferConflictError("Only an active or paused person can be moved to another funnel.");
    }

    const [existingTarget, approved] = await Promise.all([
      tx.select({ id: funnelMembersInCascade.id })
        .from(funnelMembersInCascade)
        .where(and(
          eq(funnelMembersInCascade.funnel_id, input.targetFunnelId),
          eq(funnelMembersInCascade.contact_id, input.contactId),
        ))
        .limit(1)
        .then((rows) => rows[0]),
      tx.select({ id: stepOutputsInCascade.id })
        .from(stepOutputsInCascade)
        .where(and(
          eq(stepOutputsInCascade.member_id, source.id),
          eq(stepOutputsInCascade.status, "approved"),
        ))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    if (existingTarget) {
      throw new FunnelMemberTransferConflictError("This person already has a relationship with the destination funnel.");
    }
    if (approved) throw new PendingMemberDeliveryError();

    const attrs = {
      created_by: attribution.createdBy ?? null,
      actor_type: attribution.actorType ?? null,
      request_id: attribution.requestId ?? null,
      parent_execution_id: attribution.parentExecutionId ?? null,
      trace_id: attribution.traceId ?? null,
      traceparent: attribution.traceparent ?? null,
    };
    const [created] = await tx.insert(funnelMembersInCascade).values({
      funnel_id: input.targetFunnelId,
      contact_id: input.contactId,
      current_node_id: targetFunnel.entryNodeId,
      entered_node_at: sql`now()`,
      status: source.status,
      status_reason: input.reason?.trim() || source.statusReason,
      snoozed_until: source.snoozedUntil,
      ...attrs,
    }).returning({ id: funnelMembersInCascade.id });

    const sourceReason = `Moved to ${targetFunnel.name}${input.reason?.trim() ? ` — ${input.reason.trim()}` : ""}`;
    await tx.update(funnelMembersInCascade).set({
      status: "exited",
      status_reason: sourceReason,
      snoozed_until: null,
    }).where(eq(funnelMembersInCascade.id, source.id));
    await tx.insert(funnelEventsInCascade).values([
      {
        funnel_id: input.sourceFunnelId,
        member_id: source.id,
        type: "transferred_out",
        metadata: { targetFunnelId: input.targetFunnelId, targetFunnelName: targetFunnel.name, reason: input.reason?.trim() || null },
        ...attrs,
      },
      {
        funnel_id: input.targetFunnelId,
        member_id: created.id,
        node_id: targetFunnel.entryNodeId,
        type: "transferred_in",
        metadata: { sourceFunnelId: input.sourceFunnelId, sourceFunnelName: sourceFunnel.name, reason: input.reason?.trim() || null },
        ...attrs,
      },
    ]);
    return { memberId: created.id, sourceFunnelName: sourceFunnel.name, targetFunnelName: targetFunnel.name };
  });

  const member = (await listFunnelMembers(pool, input.targetFunnelId)).find((item) => item.id === transferred.memberId);
  if (!member) throw new Error("transferred member not found");
  return { member, sourceFunnelName: transferred.sourceFunnelName, targetFunnelName: transferred.targetFunnelName };
}

export async function countFunnelMembers(pool: Pool, contactId: string): Promise<number> {
  const [row] = await databaseFor(pool).select({ n: count() })
    .from(funnelMembersInCascade)
    .where(eq(funnelMembersInCascade.contact_id, contactId));
  return row.n;
}
