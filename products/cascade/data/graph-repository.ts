import {
  databaseFor,
  funnel_edgesInCascade as funnelEdgesInCascade,
  funnel_eventsInCascade as funnelEventsInCascade,
  funnel_membersInCascade as funnelMembersInCascade,
  funnel_nodesInCascade as funnelNodesInCascade,
  funnelsInCascade,
  step_outputsInCascade as stepOutputsInCascade,
} from "@content-automation/database";
import { and, count, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { ActorType } from "@content-automation/observability";
import {
  MEMBER_STATUSES,
  graphDocumentSchema,
  validateGraph,
  type GraphDocument,
  type MemberStatus,
} from "../domain/graph";

export interface Attribution {
  createdBy?: string;
  actorType?: ActorType;
  requestId?: string;
  parentExecutionId?: string;
  traceId?: string;
  traceparent?: string;
}

export interface FunnelEvent {
  id: string;
  memberId: string | null;
  nodeId: string | null;
  type: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export class GraphVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super("This funnel changed in another tab. Your unsaved steps are preserved; reload the latest version before saving again.");
    this.name = "GraphVersionConflictError";
  }
}

export class PendingMemberDeliveryError extends Error {
  constructor() {
    super("This person has an approved email waiting to send. Save it for later or let delivery finish before moving them to another step or funnel.");
    this.name = "PendingMemberDeliveryError";
  }
}

function attributionColumns(attribution: Attribution) {
  return {
    created_by: attribution.createdBy ?? null,
    actor_type: attribution.actorType ?? null,
    request_id: attribution.requestId ?? null,
    parent_execution_id: attribution.parentExecutionId ?? null,
    trace_id: attribution.traceId ?? null,
    traceparent: attribution.traceparent ?? null,
  };
}

export async function getGraph(pool: Pool, funnelId: string): Promise<GraphDocument> {
  const db = databaseFor(pool);
  const [funnel] = await db.select({
    entryNodeId: funnelsInCascade.entry_node_id,
    layout: funnelsInCascade.builder_layout,
  }).from(funnelsInCascade).where(eq(funnelsInCascade.id, funnelId));
  if (!funnel) throw new Error("funnel not found");
  const [nodes, edges] = await Promise.all([
    db.select({
      id: funnelNodesInCascade.id,
      type: funnelNodesInCascade.type,
      name: funnelNodesInCascade.name,
      config: funnelNodesInCascade.config,
    }).from(funnelNodesInCascade).where(eq(funnelNodesInCascade.funnel_id, funnelId)),
    db.select({
      fromNodeId: funnelEdgesInCascade.from_node_id,
      toNodeId: funnelEdgesInCascade.to_node_id,
      label: funnelEdgesInCascade.label,
    }).from(funnelEdgesInCascade).where(eq(funnelEdgesInCascade.funnel_id, funnelId)),
  ]);
  return graphDocumentSchema.parse({
    entryNodeId: funnel.entryNodeId,
    nodes,
    edges,
    layout: funnel.layout ?? {},
  });
}

export async function putGraph(
  pool: Pool,
  funnelId: string,
  input: GraphDocument,
  attribution: Attribution,
  expectedVersion?: number,
): Promise<{ relocatedMembers: number; version: number }> {
  const doc = graphDocumentSchema.parse(input);
  const violations = validateGraph(doc);
  if (violations.length > 0) throw new Error(violations.join(" "));
  const nodeIds = doc.nodes.map((node) => node.id);
  const attrs = attributionColumns(attribution);

  return databaseFor(pool).transaction(async (tx) => {
    const [funnel] = await tx.select({ id: funnelsInCascade.id, version: funnelsInCascade.version })
      .from(funnelsInCascade)
      .where(eq(funnelsInCascade.id, funnelId))
      .for("update");
    if (!funnel) throw new Error("funnel not found");
    if (expectedVersion !== undefined && funnel.version !== expectedVersion) {
      throw new GraphVersionConflictError(expectedVersion, funnel.version);
    }

    await tx.delete(funnelEdgesInCascade).where(eq(funnelEdgesInCascade.funnel_id, funnelId));
    await tx.delete(funnelNodesInCascade).where(and(
      eq(funnelNodesInCascade.funnel_id, funnelId),
      notInArray(funnelNodesInCascade.id, nodeIds),
    ));
    for (const node of doc.nodes) {
      await tx.insert(funnelNodesInCascade).values({
        id: node.id,
        funnel_id: funnelId,
        type: node.type,
        name: node.name,
        config: node.config,
        ...attrs,
      }).onConflictDoUpdate({
        target: funnelNodesInCascade.id,
        set: { type: node.type, name: node.name, config: node.config, updated_at: sql`now()` },
      });
    }
    if (doc.edges.length > 0) {
      await tx.insert(funnelEdgesInCascade).values(doc.edges.map((edge) => ({
        funnel_id: funnelId,
        from_node_id: edge.fromNodeId,
        to_node_id: edge.toNodeId,
        label: edge.label,
        ...attrs,
      })));
    }
    await tx.update(funnelsInCascade).set({
      entry_node_id: doc.entryNodeId,
      builder_layout: doc.layout,
      version: sql`${funnelsInCascade.version} + 1`,
    }).where(eq(funnelsInCascade.id, funnelId));

    const strays = await tx.select({
      id: funnelMembersInCascade.id,
      currentNodeId: funnelMembersInCascade.current_node_id,
    }).from(funnelMembersInCascade).where(and(
      eq(funnelMembersInCascade.funnel_id, funnelId),
      or(
        isNull(funnelMembersInCascade.current_node_id),
        notInArray(funnelMembersInCascade.current_node_id, nodeIds),
      ),
    ));
    if (strays.length > 0 && doc.entryNodeId) {
      await tx.update(funnelMembersInCascade).set({
        current_node_id: doc.entryNodeId,
        entered_node_at: sql`now()`,
        attempt: 0,
      }).where(inArray(funnelMembersInCascade.id, strays.map((member) => member.id)));
      await tx.insert(funnelEventsInCascade).values(strays.map((member) => ({
        funnel_id: funnelId,
        member_id: member.id,
        node_id: doc.entryNodeId,
        type: member.currentNodeId ? "advanced" : "entered",
        metadata: member.currentNodeId ? { reason: "graph_edit" } : {},
        ...attrs,
      })));
    }
    return {
      relocatedMembers: strays.filter((member) => member.currentNodeId !== null).length,
      version: funnel.version + 1,
    };
  });
}

export async function moveMember(
  pool: Pool,
  funnelId: string,
  contactId: string,
  patch: { nodeId?: string | null; status?: MemberStatus; reason?: string },
  attribution: Attribution,
): Promise<void> {
  if (patch.status && !MEMBER_STATUSES.includes(patch.status)) throw new Error("unknown status");
  await databaseFor(pool).transaction(async (tx) => {
    const [member] = await tx.select({
      id: funnelMembersInCascade.id,
      currentNodeId: funnelMembersInCascade.current_node_id,
    }).from(funnelMembersInCascade).where(and(
      eq(funnelMembersInCascade.funnel_id, funnelId),
      eq(funnelMembersInCascade.contact_id, contactId),
    ));
    if (!member) throw new Error("member not found");
    const nodeChanged = patch.nodeId !== undefined && patch.nodeId !== member.currentNodeId;
    if (nodeChanged) {
      const [approved] = await tx.select({ id: stepOutputsInCascade.id })
        .from(stepOutputsInCascade)
        .where(and(
          eq(stepOutputsInCascade.member_id, member.id),
          eq(stepOutputsInCascade.status, "approved"),
        ))
        .limit(1);
      if (approved) throw new PendingMemberDeliveryError();
    }
    await tx.update(funnelMembersInCascade).set({
      ...(patch.nodeId !== undefined ? { current_node_id: patch.nodeId, entered_node_at: sql`now()`, attempt: 0 } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      status_reason: patch.reason ?? null,
    }).where(eq(funnelMembersInCascade.id, member.id));
    await tx.insert(funnelEventsInCascade).values({
      funnel_id: funnelId,
      member_id: member.id,
      node_id: patch.nodeId ?? member.currentNodeId,
      type: patch.status ?? (nodeChanged ? "advanced" : "advanced"),
      metadata: patch.reason ? { reason: patch.reason } : {},
      ...attributionColumns(attribution),
    });
  });
}

export async function listFunnelEvents(
  pool: Pool,
  funnelId: string,
  limit = 50,
): Promise<FunnelEvent[]> {
  const rows = await databaseFor(pool).select({
    id: funnelEventsInCascade.id,
    memberId: funnelEventsInCascade.member_id,
    nodeId: funnelEventsInCascade.node_id,
    type: funnelEventsInCascade.type,
    occurredAt: funnelEventsInCascade.occurred_at,
    metadata: funnelEventsInCascade.metadata,
  }).from(funnelEventsInCascade)
    .where(eq(funnelEventsInCascade.funnel_id, funnelId))
    .orderBy(desc(funnelEventsInCascade.occurred_at), desc(funnelEventsInCascade.created_at))
    .limit(limit);
  return rows.map((row) => ({ ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> }));
}

/** Active members per node, for the builder's live counts. */
export async function countMembersByNode(
  pool: Pool,
  funnelId: string,
): Promise<Record<string, number>> {
  const rows = await databaseFor(pool).select({
    nodeId: funnelMembersInCascade.current_node_id,
    value: count(),
  }).from(funnelMembersInCascade)
    .where(and(
      eq(funnelMembersInCascade.funnel_id, funnelId),
      eq(funnelMembersInCascade.status, "active"),
    ))
    .groupBy(funnelMembersInCascade.current_node_id);
  const counts: Record<string, number> = {};
  for (const row of rows) if (row.nodeId) counts[row.nodeId] = row.value;
  return counts;
}
