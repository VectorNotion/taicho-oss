import type { Pool } from "pg";
import type { Attribution } from "../data/graph-repository";
import { getGraph } from "../data/graph-repository";
import {
  catchUpMember,
  computeDueMembers,
  getFunnelSettings,
  ingestBounce,
  listMemberProgress,
  listReplies,
  listStepOutputs,
  resumeDecision,
  routeReply,
  saveStepOutput,
  storeReply,
  type DueMember,
  type MemberRecord,
  type StepOutputRecord,
} from "../data/execution-repository";
import type { ReplyClassification } from "../domain/execution";
import type { CascadeBrain, ThreadItem } from "./brain";
import { modelSlug } from "@content-automation/platform/agents/model";

/**
 * Orchestration of the brain's three jobs over the execution repository.
 * The brain arrives as a dependency so tests run on a stub; production
 * callers pass mastraBrain().
 */

const MAX_DECISION_CHAIN = 5;

async function buildThread(pool: Pool, funnelId: string, memberId: string): Promise<ThreadItem[]> {
  const [outputs, replies] = await Promise.all([
    listStepOutputs(pool, funnelId),
    listReplies(pool, funnelId),
  ]);
  const items: ThreadItem[] = [
    ...outputs
      .filter((output) => output.memberId === memberId)
      .map((output): ThreadItem => ({
        kind: "touch",
        at: output.updatedAt,
        attempt: output.attempt,
        subject: output.subject,
        body: output.body,
      })),
    ...replies
      .filter((reply) => reply.memberId === memberId)
      .map((reply): ThreadItem => ({
        kind: "reply",
        at: reply.receivedAt,
        body: reply.body,
        classification: reply.classification,
      })),
  ];
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

async function resolveDecisions(
  pool: Pool,
  input: { funnelId: string; memberId: string; now: Date },
  pending: { nodeId: string; condition: { kind: string; prompt?: string } } | undefined,
  member: Pick<MemberRecord, "email" | "attributes">,
  brain: CascadeBrain,
  attribution: Attribution,
): Promise<void> {
  let current = pending;
  for (let round = 0; round < MAX_DECISION_CHAIN && current; round += 1) {
    const prompt = current.condition.kind === "predicate" ? current.condition.prompt ?? "" : "";
    const thread = await buildThread(pool, input.funnelId, input.memberId);
    const answer = await brain.answerPredicate({
      prompt,
      contact: { email: member.email, attributes: member.attributes },
      thread,
    });
    const resumed = await resumeDecision(pool, {
      funnelId: input.funnelId,
      memberId: input.memberId,
      nodeId: current.nodeId,
      result: answer.result,
      rationale: answer.rationale,
      now: input.now,
    }, attribution);
    current = resumed.pendingDecision;
  }
}

/**
 * Persist every elapsed wait and answer every predicate the settlement runs
 * into, so stored cursors match reality before drafting or listing.
 */
export async function settleFunnel(
  pool: Pool,
  input: { funnelId: string; now: Date },
  brain: CascadeBrain,
  attribution: Attribution,
): Promise<void> {
  const members = await listMemberProgress(pool, input.funnelId);
  for (const member of members) {
    if (member.status !== "active") continue;
    for (let round = 0; round < MAX_DECISION_CHAIN; round += 1) {
      const caught = await catchUpMember(pool, { funnelId: input.funnelId, memberId: member.id, now: input.now }, attribution);
      if (!caught.pendingDecision) break;
      await resolveDecisions(pool, { funnelId: input.funnelId, memberId: member.id, now: input.now }, caught.pendingDecision, member, brain, attribution);
    }
  }
}

export interface GeneratedDraft {
  memberId: string;
  email: string;
  nodeId: string;
  nodeName: string;
  attempt: number;
  output: StepOutputRecord | null;
  error?: string;
}

/**
 * Draft the due touches (§2 job 1): one fresh generation per (member, touch,
 * attempt), aware of the attempt number and the unanswered thread.
 * With memberId, drafts (or re-drafts) just that member.
 */
export async function generateTouchDrafts(
  pool: Pool,
  input: { funnelId: string; memberId?: string; regenerate?: boolean; now: Date },
  brain: CascadeBrain,
  attribution: Attribution,
): Promise<GeneratedDraft[]> {
  await settleFunnel(pool, { funnelId: input.funnelId, now: input.now }, brain, attribution);
  const [schedule, settings, graph] = await Promise.all([
    computeDueMembers(pool, input.funnelId, input.now),
    getFunnelSettings(pool, input.funnelId),
    getGraph(pool, input.funnelId),
  ]);

  // The first touch may be drafted before its delivery window so a reviewer
  // has time to approve it. Repeated attempts, however, must not be generated
  // before their interval is due. The one-second tolerance only bridges
  // PostgreSQL microseconds and JavaScript's millisecond precision.
  const targets = schedule.filter((entry: DueMember) => entry.attempt === 1 || Date.parse(entry.dueAt) <= input.now.getTime() + 1_000).filter((entry: DueMember) => {
    if (input.memberId) return entry.memberId === input.memberId;
    return entry.draftStatus === null;
  }).filter((entry) => input.regenerate || entry.draftStatus === null || entry.draftStatus === "failed");

  const results: GeneratedDraft[] = [];
  for (const target of targets) {
    const node = graph.nodes.find((candidate) => candidate.id === target.nodeId);
    if (!node || node.type !== "touch") continue;
    const base = {
      memberId: target.memberId,
      email: target.email,
      nodeId: target.nodeId,
      nodeName: target.nodeName,
      attempt: target.attempt,
    };
    try {
      const members = await listMemberProgress(pool, input.funnelId);
      const member = members.find((candidate) => candidate.id === target.memberId);
      if (!member) continue;
      const thread = await buildThread(pool, input.funnelId, target.memberId);
      const draft = await brain.draftTouch({
        funnelName: settings.name,
        goalDescription: settings.goalDescription,
        instruction: node.config.instruction,
        attempt: target.attempt,
        maxAttempts: node.config.repeat.maxAttempts,
        contact: { email: member.email, attributes: member.attributes },
        thread,
      });
      const output = await saveStepOutput(pool, {
        funnelId: input.funnelId,
        memberId: target.memberId,
        nodeId: target.nodeId,
        attempt: target.attempt,
        subject: draft.subject,
        body: draft.body,
        status: settings.autoApprove ? "approved" : "generated",
        metadata: { model: modelSlug(), operation: "cascade-touch" },
      }, attribution);
      results.push({ ...base, output });
    } catch (error) {
      const output = await saveStepOutput(pool, {
        funnelId: input.funnelId,
        memberId: target.memberId,
        nodeId: target.nodeId,
        attempt: target.attempt,
        subject: "",
        body: "",
        status: "failed",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      }, attribution);
      results.push({ ...base, output, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export interface IngestedReply {
  replyId: string | null;
  classification: ReplyClassification | null;
  note: string;
  memberStatus: string;
}

/**
 * Store an inbound reply or bounce, read it (§2 job 2), route it through the
 * graph, and answer any predicate branch the routing runs into (§2 job 3).
 */
export async function ingestReply(
  pool: Pool,
  input: { funnelId: string; contactId: string; body?: string; kind: "reply" | "bounce"; now: Date },
  brain: CascadeBrain,
  attribution: Attribution,
): Promise<IngestedReply> {
  if (input.kind === "bounce") {
    const bounced = await ingestBounce(pool, { funnelId: input.funnelId, contactId: input.contactId }, attribution);
    return { replyId: null, classification: null, note: "bounced", memberStatus: bounced.member.status };
  }
  if (!input.body?.trim()) throw new Error("a reply needs a body");

  const settings = await getFunnelSettings(pool, input.funnelId);
  const stored = await storeReply(pool, { funnelId: input.funnelId, contactId: input.contactId, body: input.body }, attribution);
  const members = await listMemberProgress(pool, input.funnelId);
  const member = members.find((candidate) => candidate.id === stored.memberId);
  if (!member) throw new Error("member not found");

  const thread = await buildThread(pool, input.funnelId, stored.memberId);
  const reading = await brain.readReply({
    funnelName: settings.name,
    goalDescription: settings.goalDescription,
    contact: { email: member.email, attributes: member.attributes },
    thread: thread.filter((item) => !(item.kind === "reply" && item.body === input.body)),
    replyBody: input.body,
  });

  const routed = await routeReply(pool, {
    funnelId: input.funnelId,
    replyId: stored.id,
    classification: reading.classification,
    classifierNote: reading.note,
    ...(reading.returnDate ? { snoozeUntil: reading.returnDate } : {}),
    now: input.now,
  }, attribution);

  if (routed.pendingDecision) {
    await resolveDecisions(pool, { funnelId: input.funnelId, memberId: stored.memberId, now: input.now }, routed.pendingDecision, member, brain, attribution);
  }
  const after = (await listMemberProgress(pool, input.funnelId)).find((candidate) => candidate.id === stored.memberId);
  return {
    replyId: stored.id,
    classification: reading.classification,
    note: reading.note,
    memberStatus: after?.status ?? routed.member.status,
  };
}

/** A human overrules the classifier: reclassify and re-run routing (§1). */
export async function rerouteReply(
  pool: Pool,
  input: { funnelId: string; replyId: string; classification: ReplyClassification; note?: string; now: Date },
  brain: CascadeBrain,
  attribution: Attribution,
): Promise<IngestedReply> {
  const routed = await routeReply(pool, {
    funnelId: input.funnelId,
    replyId: input.replyId,
    classification: input.classification,
    classifierNote: input.note ?? "reclassified by a human",
    now: input.now,
  }, attribution);
  if (routed.pendingDecision) {
    const members = await listMemberProgress(pool, input.funnelId);
    const replies = await listReplies(pool, input.funnelId);
    const reply = replies.find((candidate) => candidate.id === input.replyId);
    const member = members.find((candidate) => candidate.id === reply?.memberId);
    if (member && reply) {
      await resolveDecisions(pool, { funnelId: input.funnelId, memberId: member.id, now: input.now }, routed.pendingDecision, member, brain, attribution);
    }
  }
  return {
    replyId: input.replyId,
    classification: input.classification,
    note: input.note ?? "reclassified by a human",
    memberStatus: routed.member.status,
  };
}
