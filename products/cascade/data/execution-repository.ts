import {
  contactsInCascade,
  databaseFor,
  funnel_decisionsInCascade as funnelDecisionsInCascade,
  funnel_eventsInCascade as funnelEventsInCascade,
  funnel_membersInCascade as funnelMembersInCascade,
  funnel_repliesInCascade as funnelRepliesInCascade,
  funnelsInCascade,
  step_outputsInCascade as stepOutputsInCascade,
} from "@content-automation/database";
import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { Pool } from "pg";
import {
  applyAttemptSent,
  applyDecision,
  applyReply,
  applyWaitElapsed,
  computeNextTouch,
  DEFAULT_SEND_WINDOW,
  sendWindowSchema,
  type MemberExecutionState,
  type ReplyClassification,
  type SendWindow,
  type WalkEffect,
  type WalkResult,
} from "../domain/execution";
import type { GraphDocument, GraphNode, MemberStatus } from "../domain/graph";
import { getGraph } from "./graph-repository";
import type { Attribution } from "./graph-repository";

type Tx = Parameters<Parameters<ReturnType<typeof databaseFor>["transaction"]>[0]>[0];

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

export interface MemberRecord {
  id: string;
  contactId: string;
  email: string;
  attributes: Record<string, unknown>;
  timezone: string | null;
  currentNodeId: string | null;
  status: MemberStatus;
  statusReason: string | null;
  attempt: number;
  enteredNodeAt: string | null;
  snoozedUntil: string | null;
}

export interface StepOutputRecord {
  id: string;
  memberId: string;
  nodeId: string;
  attempt: number;
  subject: string;
  body: string;
  status: "generated" | "approved" | "sent" | "failed";
  metadata: Record<string, unknown>;
  generatedAt: string;
  updatedAt: string;
}

export interface ReplyRecord {
  id: string;
  memberId: string;
  nodeId: string | null;
  attempt: number | null;
  body: string;
  classification: ReplyClassification | null;
  classifierNote: string;
  routedOutcome: string | null;
  receivedAt: string;
}

export interface DueMember {
  memberId: string;
  contactId: string;
  email: string;
  name: string;
  nodeId: string;
  nodeName: string;
  /** The attempt number this send would be (1-based). */
  attempt: number;
  dueAt: string;
  /** IANA timezone used to clamp dueAt into the funnel send window. */
  timezone: string;
  draftId: string | null;
  draftStatus: StepOutputRecord["status"] | null;
  /** True when elapsed waits project the member past their stored cursor. */
  projected: boolean;
}

interface FunnelExecutionConfig {
  goalType: string;
  sendWindow: SendWindow;
  autoApprove: boolean;
}

function stateOf(member: MemberRecord): MemberExecutionState {
  return {
    currentNodeId: member.currentNodeId,
    status: member.status,
    statusReason: member.statusReason,
    attempt: member.attempt,
    enteredNodeAt: member.enteredNodeAt,
    snoozedUntil: member.snoozedUntil,
  };
}

async function loadMembers(db: Tx | ReturnType<typeof databaseFor>, funnelId: string, filter?: { contactId?: string; memberId?: string }): Promise<MemberRecord[]> {
  const rows = await db.select({
    id: funnelMembersInCascade.id,
    contactId: funnelMembersInCascade.contact_id,
    email: contactsInCascade.email,
    attributes: contactsInCascade.attributes,
    timezone: contactsInCascade.timezone,
    currentNodeId: funnelMembersInCascade.current_node_id,
    status: funnelMembersInCascade.status,
    statusReason: funnelMembersInCascade.status_reason,
    attempt: funnelMembersInCascade.attempt,
    enteredNodeAt: funnelMembersInCascade.entered_node_at,
    snoozedUntil: funnelMembersInCascade.snoozed_until,
  }).from(funnelMembersInCascade)
    .innerJoin(contactsInCascade, eq(contactsInCascade.id, funnelMembersInCascade.contact_id))
    .where(and(
      eq(funnelMembersInCascade.funnel_id, funnelId),
      ...(filter?.contactId ? [eq(funnelMembersInCascade.contact_id, filter.contactId)] : []),
      ...(filter?.memberId ? [eq(funnelMembersInCascade.id, filter.memberId)] : []),
    ));
  return rows.map((row) => ({
    ...row,
    status: row.status as MemberStatus,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  }));
}

async function loadFunnelConfig(db: Tx | ReturnType<typeof databaseFor>, funnelId: string): Promise<FunnelExecutionConfig> {
  const [funnel] = await db.select({
    goalType: funnelsInCascade.goal_type,
    sendWindow: funnelsInCascade.send_window,
    autoApprove: funnelsInCascade.auto_approve,
  }).from(funnelsInCascade).where(eq(funnelsInCascade.id, funnelId));
  if (!funnel) throw new Error("funnel not found");
  const parsed = sendWindowSchema.safeParse(funnel.sendWindow);
  return {
    goalType: funnel.goalType,
    sendWindow: parsed.success ? parsed.data : DEFAULT_SEND_WINDOW,
    autoApprove: funnel.autoApprove,
  };
}

export class FunnelSettingsVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super("These funnel settings changed in another tab. Your unsaved values are preserved; reload the latest version before saving again.");
    this.name = "FunnelSettingsVersionConflictError";
  }
}

export interface FunnelSettings {
  version: number;
  name: string;
  goalType: string;
  goalDescription: string;
  sendWindow: SendWindow | null;
  autoApprove: boolean;
  reentryDays: number | null;
  runEnabled: boolean;
}

export async function getFunnelSettings(pool: Pool, funnelId: string): Promise<FunnelSettings> {
  const [funnel] = await databaseFor(pool).select({
    version: funnelsInCascade.version,
    name: funnelsInCascade.name,
    goalType: funnelsInCascade.goal_type,
    goalDescription: funnelsInCascade.goal_description,
    sendWindow: funnelsInCascade.send_window,
    autoApprove: funnelsInCascade.auto_approve,
    reentryDays: funnelsInCascade.reentry_days,
    runEnabled: funnelsInCascade.run_enabled,
  }).from(funnelsInCascade).where(eq(funnelsInCascade.id, funnelId));
  if (!funnel) throw new Error("funnel not found");
  const parsed = sendWindowSchema.safeParse(funnel.sendWindow);
  return { ...funnel, sendWindow: parsed.success ? parsed.data : null };
}

export async function configureFunnel(
  pool: Pool,
  funnelId: string,
  patch: {
    name?: string;
    goalType?: string;
    goalDescription?: string;
    sendWindow?: SendWindow | null;
    autoApprove?: boolean;
    reentryDays?: number | null;
    runEnabled?: boolean;
    expectedVersion?: number;
  },
): Promise<FunnelSettings> {
  const normalizedName = patch.name?.trim();
  if (patch.name !== undefined && !normalizedName) throw new Error("funnel name is required");
  return databaseFor(pool).transaction(async (tx) => {
    const [current] = await tx.select({ version: funnelsInCascade.version })
      .from(funnelsInCascade)
      .where(eq(funnelsInCascade.id, funnelId))
      .for("update");
    if (!current) throw new Error("funnel not found");
    if (patch.expectedVersion !== undefined && current.version !== patch.expectedVersion) {
      throw new FunnelSettingsVersionConflictError(patch.expectedVersion, current.version);
    }
    const [updated] = await tx.update(funnelsInCascade).set({
      ...(normalizedName !== undefined ? { name: normalizedName } : {}),
      ...(patch.goalType !== undefined ? { goal_type: patch.goalType } : {}),
      ...(patch.goalDescription !== undefined ? { goal_description: patch.goalDescription } : {}),
      ...(patch.sendWindow !== undefined ? { send_window: patch.sendWindow } : {}),
      ...(patch.autoApprove !== undefined ? { auto_approve: patch.autoApprove } : {}),
      ...(patch.reentryDays !== undefined ? { reentry_days: patch.reentryDays } : {}),
      ...(patch.runEnabled !== undefined ? { run_enabled: patch.runEnabled } : {}),
      version: sql`${funnelsInCascade.version} + 1`,
    }).where(eq(funnelsInCascade.id, funnelId)).returning({
      version: funnelsInCascade.version,
      name: funnelsInCascade.name,
      goalType: funnelsInCascade.goal_type,
      goalDescription: funnelsInCascade.goal_description,
      sendWindow: funnelsInCascade.send_window,
      autoApprove: funnelsInCascade.auto_approve,
      reentryDays: funnelsInCascade.reentry_days,
      runEnabled: funnelsInCascade.run_enabled,
    });
    if (!updated) throw new Error("funnel not found");
    const parsed = sendWindowSchema.safeParse(updated.sendWindow);
    return { ...updated, sendWindow: parsed.success ? parsed.data : null };
  });
}

async function persistState(tx: Tx, memberId: string, state: MemberExecutionState): Promise<void> {
  await tx.update(funnelMembersInCascade).set({
    current_node_id: state.currentNodeId,
    status: state.status,
    status_reason: state.statusReason,
    attempt: state.attempt,
    entered_node_at: state.enteredNodeAt,
    snoozed_until: state.snoozedUntil,
  }).where(eq(funnelMembersInCascade.id, memberId));
}

async function recordEvent(
  tx: Tx,
  funnelId: string,
  memberId: string | null,
  nodeId: string | null,
  type: string,
  metadata: Record<string, unknown>,
  attribution: Attribution,
  occurredAt?: Date,
): Promise<void> {
  await tx.insert(funnelEventsInCascade).values({
    funnel_id: funnelId,
    member_id: memberId,
    node_id: nodeId,
    type,
    metadata,
    ...(occurredAt ? { occurred_at: occurredAt.toISOString() } : {}),
    ...attributionColumns(attribution),
  });
}

/** Persist a walk: the member's new state plus one event per effect. */
async function applyWalkResult(
  tx: Tx,
  funnelId: string,
  member: MemberRecord,
  walk: WalkResult,
  attribution: Attribution,
  occurredAt?: Date,
): Promise<void> {
  await persistState(tx, member.id, walk.state);
  for (const effect of walk.effects) {
    await applyEffect(tx, funnelId, member, effect, attribution, occurredAt);
  }
}

async function applyEffect(
  tx: Tx,
  funnelId: string,
  member: MemberRecord,
  effect: WalkEffect,
  attribution: Attribution,
  occurredAt?: Date,
): Promise<void> {
  if (effect.kind === "move") {
    await recordEvent(tx, funnelId, member.id, effect.nodeId, "advanced", { edge: effect.edgeLabel }, attribution, occurredAt);
    return;
  }
  if (effect.kind === "converted") {
    await recordEvent(tx, funnelId, member.id, effect.nodeId, "converted", { outcome: effect.outcome }, attribution, occurredAt);
    return;
  }
  if (effect.kind === "route") {
    await recordEvent(tx, funnelId, member.id, effect.nodeId, "routed_to_funnel", { toFunnelId: effect.toFunnelId }, attribution, occurredAt);
    await routeContactToFunnel(tx, member.contactId, effect.toFunnelId, attribution);
    return;
  }
  if (effect.kind === "decided") {
    await tx.insert(funnelDecisionsInCascade).values({
      funnel_id: funnelId,
      member_id: member.id,
      node_id: effect.nodeId,
      condition: effect.condition,
      result: effect.result,
      rationale: effect.rationale,
      ...attributionColumns(attribution),
    });
    await recordEvent(tx, funnelId, member.id, effect.nodeId, "branch_evaluated", { result: effect.result, rationale: effect.rationale }, attribution, occurredAt);
    return;
  }
  if (effect.kind === "status") {
    await recordEvent(tx, funnelId, member.id, member.currentNodeId, effect.status, effect.reason ? { reason: effect.reason } : {}, attribution, occurredAt);
    return;
  }
  await recordEvent(tx, funnelId, member.id, member.currentNodeId, "snoozed", { until: effect.until }, attribution, occurredAt);
}

/** Hand the contact to another funnel at its entry step (no-op when already a member). */
async function routeContactToFunnel(tx: Tx, contactId: string, toFunnelId: string, attribution: Attribution): Promise<void> {
  const [created] = await tx.insert(funnelMembersInCascade).values({
    funnel_id: toFunnelId,
    contact_id: contactId,
    ...attributionColumns(attribution),
  }).onConflictDoNothing({
    target: [funnelMembersInCascade.funnel_id, funnelMembersInCascade.contact_id],
  }).returning({ id: funnelMembersInCascade.id });
  if (!created) return;
  const [target] = await tx.select({ entryNodeId: funnelsInCascade.entry_node_id })
    .from(funnelsInCascade).where(eq(funnelsInCascade.id, toFunnelId));
  if (target?.entryNodeId) {
    await tx.update(funnelMembersInCascade).set({
      current_node_id: target.entryNodeId,
      entered_node_at: sql`now()`,
      attempt: 0,
    }).where(eq(funnelMembersInCascade.id, created.id));
    await recordEvent(tx, toFunnelId, created.id, target.entryNodeId, "entered", {}, attribution);
  }
}

function waitElapseInstant(node: GraphNode, enteredNodeAt: string | null, fallback: Date): Date | null {
  if (node.type !== "wait") return null;
  const entered = enteredNodeAt ? Date.parse(enteredNodeAt) : fallback.getTime();
  return new Date(entered + node.config.days * 86_400_000);
}

/**
 * Advance one member through every elapsed wait, persisting each hop at the
 * instant the wait actually elapsed. Stops at a resting node or at a brain
 * predicate, which the caller resolves via resumeDecision.
 */
export async function catchUpMember(
  pool: Pool,
  input: { funnelId: string; memberId: string; now: Date },
  attribution: Attribution,
): Promise<{ member: MemberExecutionState; pendingDecision?: WalkResult["pendingDecision"] }> {
  const graph = await getGraph(pool, input.funnelId);
  return databaseFor(pool).transaction(async (tx) => {
    const [member] = await loadMembers(tx, input.funnelId, { memberId: input.memberId });
    if (!member) throw new Error("member not found");
    let state = stateOf(member);
    let pendingDecision: WalkResult["pendingDecision"];
    for (let hop = 0; hop < graph.nodes.length + 1; hop += 1) {
      if (state.status !== "active") break;
      const node = graph.nodes.find((candidate) => candidate.id === state.currentNodeId);
      if (!node) break;
      const elapseAt = waitElapseInstant(node, state.enteredNodeAt, input.now);
      if (!elapseAt || elapseAt.getTime() > input.now.getTime()) break;
      const walk = applyWaitElapsed({ graph, state, now: elapseAt });
      await applyWalkResult(tx, input.funnelId, member, walk, attribution, elapseAt);
      state = walk.state;
      if (walk.pendingDecision) {
        pendingDecision = walk.pendingDecision;
        break;
      }
    }
    return { member: state, pendingDecision };
  });
}

/** The executor reports one attempt actually sent; Taicho advances the cursor. */
export async function recordAttemptSent(
  pool: Pool,
  input: { funnelId: string; contactId: string; outputId?: string; now: Date; metadata?: Record<string, unknown> },
  attribution: Attribution,
): Promise<{ member: MemberExecutionState; recorded: boolean }> {
  const graph = await getGraph(pool, input.funnelId);
  return databaseFor(pool).transaction(async (tx) => {
    const output = input.outputId ? (await tx.select({
      id: stepOutputsInCascade.id,
      memberId: stepOutputsInCascade.member_id,
      nodeId: stepOutputsInCascade.node_id,
      attempt: stepOutputsInCascade.attempt,
      status: stepOutputsInCascade.status,
    }).from(stepOutputsInCascade).where(and(
      eq(stepOutputsInCascade.id, input.outputId),
      eq(stepOutputsInCascade.funnel_id, input.funnelId),
    )).for("update"))[0] : null;
    if (input.outputId && !output) throw new Error("draft not found");
    const [member] = await loadMembers(tx, input.funnelId, { contactId: input.contactId });
    if (!member) throw new Error("member not found");
    const state = stateOf(member);
    if (output?.memberId !== undefined && output.memberId !== member.id) throw new Error("draft does not belong to this member");
    if (output?.status === "sent") return { member: state, recorded: false };
    const attempt = state.attempt + 1;
    if (output && (output.status !== "approved" || output.nodeId !== state.currentNodeId || output.attempt !== attempt)) {
      throw new Error("approved draft no longer matches the member's current attempt");
    }
    if (state.currentNodeId) {
      await tx.update(stepOutputsInCascade).set({ status: "sent", updated_at: sql`now()` }).where(and(
        ...(output
          ? [eq(stepOutputsInCascade.id, output.id)]
          : [
              eq(stepOutputsInCascade.member_id, member.id),
              eq(stepOutputsInCascade.node_id, state.currentNodeId),
              eq(stepOutputsInCascade.attempt, attempt),
            ]),
      ));
    }
    await recordEvent(tx, input.funnelId, member.id, state.currentNodeId, "attempt_sent", { attempt, ...(input.metadata ?? {}) }, attribution, input.now);
    const walk = applyAttemptSent({ graph, state, now: input.now });
    await applyWalkResult(tx, input.funnelId, member, walk, attribution, input.now);
    return { member: walk.state, recorded: true };
  });
}

/** A bounce always exits the member — the global rail, no graph involved. */
export async function ingestBounce(
  pool: Pool,
  input: { funnelId: string; contactId: string },
  attribution: Attribution,
): Promise<{ member: MemberExecutionState }> {
  return databaseFor(pool).transaction(async (tx) => {
    const [member] = await loadMembers(tx, input.funnelId, { contactId: input.contactId });
    if (!member) throw new Error("member not found");
    const state = { ...stateOf(member), status: "exited" as MemberStatus, statusReason: "bounced" };
    await persistState(tx, member.id, state);
    await recordEvent(tx, input.funnelId, member.id, member.currentNodeId, "exited", { reason: "bounced" }, attribution);
    return { member: state };
  });
}

/** The executor reported a click or open — recorded to power event branches. */
export async function recordEngagementSignal(
  pool: Pool,
  input: { funnelId: string; contactId: string; type: "clicked" | "opened"; metadata?: Record<string, unknown> },
  attribution: Attribution,
): Promise<void> {
  await databaseFor(pool).transaction(async (tx) => {
    const [member] = await loadMembers(tx, input.funnelId, { contactId: input.contactId });
    if (!member) throw new Error("member not found");
    await recordEvent(tx, input.funnelId, member.id, member.currentNodeId, input.type, input.metadata ?? {}, attribution);
  });
}

/** Store an inbound reply verbatim before anything reads it. */
export async function storeReply(
  pool: Pool,
  input: { funnelId: string; contactId: string; body: string },
  attribution: Attribution,
): Promise<ReplyRecord> {
  return databaseFor(pool).transaction(async (tx) => {
    const [member] = await loadMembers(tx, input.funnelId, { contactId: input.contactId });
    if (!member) throw new Error("member not found");
    const [row] = await tx.insert(funnelRepliesInCascade).values({
      funnel_id: input.funnelId,
      member_id: member.id,
      node_id: member.currentNodeId,
      attempt: member.attempt,
      body: input.body,
      ...attributionColumns(attribution),
    }).returning({
      id: funnelRepliesInCascade.id,
      memberId: funnelRepliesInCascade.member_id,
      nodeId: funnelRepliesInCascade.node_id,
      attempt: funnelRepliesInCascade.attempt,
      body: funnelRepliesInCascade.body,
      classification: funnelRepliesInCascade.classification,
      classifierNote: funnelRepliesInCascade.classifier_note,
      routedOutcome: funnelRepliesInCascade.routed_outcome,
      receivedAt: funnelRepliesInCascade.received_at,
    });
    await recordEvent(tx, input.funnelId, member.id, member.currentNodeId, "reply_received", {}, attribution);
    return { ...row, classification: row.classification as ReplyClassification | null };
  });
}

function routedOutcomeOf(state: MemberExecutionState, before: MemberExecutionState, pending: boolean): string | null {
  if (pending) return null;
  if (state.status === "converted") return "converted";
  if (state.status === "paused") return "paused for a human";
  if (state.status === "exited") return "exited";
  if (state.status === "unsubscribed") return "unsubscribed";
  if (state.snoozedUntil && state.snoozedUntil !== before.snoozedUntil) return "snoozed";
  if (state.currentNodeId !== before.currentNodeId) return "advanced";
  return "recorded";
}

/** Classify a stored reply and run it through the graph / default routing. */
export async function routeReply(
  pool: Pool,
  input: {
    funnelId: string;
    replyId: string;
    classification: ReplyClassification;
    classifierNote?: string;
    snoozeUntil?: string;
    now: Date;
  },
  attribution: Attribution,
): Promise<{ member: MemberExecutionState; pendingDecision?: WalkResult["pendingDecision"] }> {
  const graph = await getGraph(pool, input.funnelId);
  return databaseFor(pool).transaction(async (tx) => {
    const config = await loadFunnelConfig(tx, input.funnelId);
    const [reply] = await tx.select({
      id: funnelRepliesInCascade.id,
      memberId: funnelRepliesInCascade.member_id,
    }).from(funnelRepliesInCascade).where(and(
      eq(funnelRepliesInCascade.id, input.replyId),
      eq(funnelRepliesInCascade.funnel_id, input.funnelId),
    ));
    if (!reply) throw new Error("reply not found");
    const [member] = await loadMembers(tx, input.funnelId, { memberId: reply.memberId });
    if (!member) throw new Error("member not found");

    await tx.update(funnelRepliesInCascade).set({
      classification: input.classification,
      classifier_note: input.classifierNote ?? "",
    }).where(eq(funnelRepliesInCascade.id, reply.id));
    await recordEvent(tx, input.funnelId, member.id, member.currentNodeId, "reply_classified", {
      classification: input.classification,
      ...(input.classifierNote ? { note: input.classifierNote } : {}),
    }, attribution, input.now);

    const before = stateOf(member);
    const walk = applyReply({
      graph,
      state: before,
      classification: input.classification,
      goalType: config.goalType,
      note: input.classifierNote,
      snoozeUntil: input.snoozeUntil,
      attributes: member.attributes,
      now: input.now,
    });
    await applyWalkResult(tx, input.funnelId, member, walk, attribution, input.now);
    await tx.update(funnelRepliesInCascade).set({
      routed_outcome: routedOutcomeOf(walk.state, before, Boolean(walk.pendingDecision)),
    }).where(eq(funnelRepliesInCascade.id, reply.id));
    return { member: walk.state, pendingDecision: walk.pendingDecision };
  });
}

/** Resume a walk halted at a brain predicate with the evaluated answer. */
export async function resumeDecision(
  pool: Pool,
  input: { funnelId: string; memberId: string; nodeId: string; result: boolean; rationale?: string; now: Date },
  attribution: Attribution,
): Promise<{ member: MemberExecutionState; pendingDecision?: WalkResult["pendingDecision"] }> {
  const graph = await getGraph(pool, input.funnelId);
  return databaseFor(pool).transaction(async (tx) => {
    const [member] = await loadMembers(tx, input.funnelId, { memberId: input.memberId });
    if (!member) throw new Error("member not found");
    const before = stateOf(member);
    const walk = applyDecision({
      graph,
      state: before,
      nodeId: input.nodeId,
      result: input.result,
      rationale: input.rationale,
      now: input.now,
    });
    await applyWalkResult(tx, input.funnelId, member, walk, attribution, input.now);
    if (!walk.pendingDecision) {
      await tx.update(funnelRepliesInCascade).set({
        routed_outcome: routedOutcomeOf(walk.state, before, false),
      }).where(and(
        eq(funnelRepliesInCascade.member_id, member.id),
        isNull(funnelRepliesInCascade.routed_outcome),
      ));
    }
    return { member: walk.state, pendingDecision: walk.pendingDecision };
  });
}

/** Upsert one generated draft per (member, touch, attempt). */
export async function saveStepOutput(
  pool: Pool,
  input: {
    funnelId: string;
    memberId: string;
    nodeId: string;
    attempt: number;
    subject: string;
    body: string;
    status: "generated" | "approved" | "failed";
    metadata?: Record<string, unknown>;
  },
  attribution: Attribution,
): Promise<StepOutputRecord> {
  return databaseFor(pool).transaction(async (tx) => {
    const [row] = await tx.insert(stepOutputsInCascade).values({
      funnel_id: input.funnelId,
      member_id: input.memberId,
      node_id: input.nodeId,
      attempt: input.attempt,
      subject: input.subject,
      body: input.body,
      status: input.status,
      metadata: input.metadata ?? {},
      ...attributionColumns(attribution),
    }).onConflictDoUpdate({
      target: [stepOutputsInCascade.member_id, stepOutputsInCascade.node_id, stepOutputsInCascade.attempt],
      set: {
        subject: input.subject,
        body: input.body,
        status: input.status,
        metadata: input.metadata ?? {},
        updated_at: sql`now()`,
      },
    }).returning({
      id: stepOutputsInCascade.id,
      memberId: stepOutputsInCascade.member_id,
      nodeId: stepOutputsInCascade.node_id,
      attempt: stepOutputsInCascade.attempt,
      subject: stepOutputsInCascade.subject,
      body: stepOutputsInCascade.body,
      status: stepOutputsInCascade.status,
      metadata: stepOutputsInCascade.metadata,
      generatedAt: stepOutputsInCascade.generated_at,
      updatedAt: stepOutputsInCascade.updated_at,
    });
    await recordEvent(
      tx,
      input.funnelId,
      input.memberId,
      input.nodeId,
      input.status === "approved" ? "approved" : "generated",
      { attempt: input.attempt },
      attribution,
    );
    return { ...row, status: row.status as StepOutputRecord["status"], metadata: (row.metadata ?? {}) as Record<string, unknown> };
  });
}

/** Edit and/or approve a draft; sent drafts are immutable. */
export async function approveStepOutput(
  pool: Pool,
  funnelId: string,
  outputId: string,
  patch: { subject?: string; body?: string; approve?: boolean },
  attribution: Attribution,
): Promise<StepOutputRecord> {
  return databaseFor(pool).transaction(async (tx) => {
    const [existing] = await tx.select({
      id: stepOutputsInCascade.id,
      status: stepOutputsInCascade.status,
      memberId: stepOutputsInCascade.member_id,
      nodeId: stepOutputsInCascade.node_id,
      attempt: stepOutputsInCascade.attempt,
    }).from(stepOutputsInCascade).where(and(
      eq(stepOutputsInCascade.id, outputId),
      eq(stepOutputsInCascade.funnel_id, funnelId),
    ));
    if (!existing) throw new Error("draft not found");
    if (existing.status === "sent") throw new Error("this draft has already been sent");
    const [row] = await tx.update(stepOutputsInCascade).set({
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      status: patch.approve === false ? "generated" : "approved",
      updated_at: sql`now()`,
    }).where(eq(stepOutputsInCascade.id, outputId)).returning({
      id: stepOutputsInCascade.id,
      memberId: stepOutputsInCascade.member_id,
      nodeId: stepOutputsInCascade.node_id,
      attempt: stepOutputsInCascade.attempt,
      subject: stepOutputsInCascade.subject,
      body: stepOutputsInCascade.body,
      status: stepOutputsInCascade.status,
      metadata: stepOutputsInCascade.metadata,
      generatedAt: stepOutputsInCascade.generated_at,
      updatedAt: stepOutputsInCascade.updated_at,
    });
    if (patch.approve !== false) {
      await recordEvent(tx, funnelId, existing.memberId, existing.nodeId, "approved", { attempt: existing.attempt }, attribution);
    }
    return { ...row, status: row.status as StepOutputRecord["status"], metadata: (row.metadata ?? {}) as Record<string, unknown> };
  });
}

/** Record a delivery failure on a draft without touching its text. */
export async function failStepOutput(pool: Pool, funnelId: string, outputId: string, error: string): Promise<void> {
  await databaseFor(pool).update(stepOutputsInCascade).set({
    status: "failed",
    metadata: sql`${stepOutputsInCascade.metadata} || ${JSON.stringify({ error })}::jsonb`,
    updated_at: sql`now()`,
  }).where(and(
    eq(stepOutputsInCascade.id, outputId),
    eq(stepOutputsInCascade.funnel_id, funnelId),
  ));
}

/**
 * Every run-enabled funnel across every organization — read with the
 * admin pool for the platform's background pass, which then does all real
 * work through each organization's own RLS pool.
 */
export async function listRunEnabledFunnels(adminPool: Pool): Promise<Array<{ funnelId: string; organizationId: string | null }>> {
  const db = databaseFor(adminPool);
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local row_security = off`);
    const rows = await tx.select({
      funnelId: funnelsInCascade.id,
      organizationId: funnelsInCascade.organization_id,
    }).from(funnelsInCascade).where(eq(funnelsInCascade.run_enabled, true));
    return rows;
  });
}

export async function listStepOutputs(pool: Pool, funnelId: string): Promise<StepOutputRecord[]> {
  const rows = await databaseFor(pool).select({
    id: stepOutputsInCascade.id,
    memberId: stepOutputsInCascade.member_id,
    nodeId: stepOutputsInCascade.node_id,
    attempt: stepOutputsInCascade.attempt,
    subject: stepOutputsInCascade.subject,
    body: stepOutputsInCascade.body,
    status: stepOutputsInCascade.status,
    metadata: stepOutputsInCascade.metadata,
    generatedAt: stepOutputsInCascade.generated_at,
    updatedAt: stepOutputsInCascade.updated_at,
  }).from(stepOutputsInCascade)
    .where(eq(stepOutputsInCascade.funnel_id, funnelId))
    .orderBy(desc(stepOutputsInCascade.updated_at));
  return rows.map((row) => ({
    ...row,
    status: row.status as StepOutputRecord["status"],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}

export async function listReplies(pool: Pool, funnelId: string): Promise<ReplyRecord[]> {
  const rows = await databaseFor(pool).select({
    id: funnelRepliesInCascade.id,
    memberId: funnelRepliesInCascade.member_id,
    nodeId: funnelRepliesInCascade.node_id,
    attempt: funnelRepliesInCascade.attempt,
    body: funnelRepliesInCascade.body,
    classification: funnelRepliesInCascade.classification,
    classifierNote: funnelRepliesInCascade.classifier_note,
    routedOutcome: funnelRepliesInCascade.routed_outcome,
    receivedAt: funnelRepliesInCascade.received_at,
  }).from(funnelRepliesInCascade)
    .where(eq(funnelRepliesInCascade.funnel_id, funnelId))
    .orderBy(desc(funnelRepliesInCascade.received_at));
  return rows.map((row) => ({ ...row, classification: row.classification as ReplyClassification | null }));
}

export async function listMemberProgress(pool: Pool, funnelId: string): Promise<MemberRecord[]> {
  return loadMembers(databaseFor(pool), funnelId);
}

/** Per-node sent/reply counts from the event log. */
export async function nodeMetrics(pool: Pool, funnelId: string): Promise<Record<string, { sent: number; replies: number }>> {
  const rows = await databaseFor(pool).select({
    nodeId: funnelEventsInCascade.node_id,
    type: funnelEventsInCascade.type,
    value: sql<number>`count(*)::int`,
  }).from(funnelEventsInCascade)
    .where(and(
      eq(funnelEventsInCascade.funnel_id, funnelId),
      inArray(funnelEventsInCascade.type, ["attempt_sent", "reply_received"]),
    ))
    .groupBy(funnelEventsInCascade.node_id, funnelEventsInCascade.type);
  const metrics: Record<string, { sent: number; replies: number }> = {};
  for (const row of rows) {
    if (!row.nodeId) continue;
    metrics[row.nodeId] ??= { sent: 0, replies: 0 };
    if (row.type === "attempt_sent") metrics[row.nodeId].sent = row.value;
    else metrics[row.nodeId].replies = row.value;
  }
  return metrics;
}

/**
 * The shared touch schedule (§3): every active member projected through
 * elapsed waits (read-only — catchUpMember persists), resting on a touch
 * with an attempt left, with the computed nextTouch instant. UI and the
 * executor read the same numbers; the executor sends the ones already due.
 */
export async function computeDueMembers(pool: Pool, funnelId: string, now: Date): Promise<DueMember[]> {
  const db = databaseFor(pool);
  const [graph, config, members] = await Promise.all([
    getGraph(pool, funnelId),
    loadFunnelConfig(db, funnelId),
    loadMembers(db, funnelId),
  ]);
  const active = members.filter((member) => member.status === "active" && member.currentNodeId);
  if (active.length === 0) return [];

  const lastAttempts = await db.select({
    memberId: funnelEventsInCascade.member_id,
    nodeId: funnelEventsInCascade.node_id,
    lastAt: max(funnelEventsInCascade.occurred_at),
  }).from(funnelEventsInCascade)
    .where(and(
      eq(funnelEventsInCascade.funnel_id, funnelId),
      eq(funnelEventsInCascade.type, "attempt_sent"),
    ))
    .groupBy(funnelEventsInCascade.member_id, funnelEventsInCascade.node_id);
  const lastAttemptAt = new Map(lastAttempts.map((row) => [`${row.memberId}:${row.nodeId}`, row.lastAt]));

  const outputs = await listStepOutputs(pool, funnelId);
  const outputByKey = new Map(outputs.map((output) => [`${output.memberId}:${output.nodeId}:${output.attempt}`, output]));

  const due: DueMember[] = [];
  for (const member of active) {
    let state = stateOf(member);
    // Project through elapsed waits without writing anything.
    for (let hop = 0; hop < graph.nodes.length + 1; hop += 1) {
      const node = graph.nodes.find((candidate) => candidate.id === state.currentNodeId);
      if (!node) break;
      const elapseAt = waitElapseInstant(node, state.enteredNodeAt, now);
      if (!elapseAt || elapseAt.getTime() > now.getTime()) break;
      const walk = applyWaitElapsed({ graph, state, now: elapseAt });
      state = walk.state;
      if (walk.pendingDecision || state.status !== "active") break;
    }
    if (state.status !== "active") continue;
    const node = graph.nodes.find((candidate) => candidate.id === state.currentNodeId);
    if (!node || node.type !== "touch") continue;
    const dueAt = computeNextTouch({
      state,
      node,
      lastAttemptAt: lastAttemptAt.get(`${member.id}:${node.id}`) ?? null,
      window: config.sendWindow,
      timeZone: member.timezone,
    });
    if (!dueAt) continue;
    const attempt = state.attempt + 1;
    const draft = outputByKey.get(`${member.id}:${node.id}:${attempt}`);
    due.push({
      memberId: member.id,
      contactId: member.contactId,
      email: member.email,
      name: String(member.attributes.name ?? member.email),
      nodeId: node.id,
      nodeName: node.name || node.type,
      attempt,
      dueAt,
      timezone: member.timezone || "UTC",
      draftId: draft?.id ?? null,
      draftStatus: draft?.status ?? null,
      projected: state.currentNodeId !== member.currentNodeId,
    });
  }
  return due;
}
