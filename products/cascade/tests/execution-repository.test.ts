import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { closeCascadePools } from "../data/pool";
import { createContact } from "../data/contact-repository";
import { addFunnelMember, createFunnel } from "../data/funnel-repository";
import { getGraph, listFunnelEvents, putGraph } from "../data/graph-repository";
import {
  approveStepOutput,
  catchUpMember,
  computeDueMembers,
  configureFunnel,
  FunnelSettingsVersionConflictError,
  getFunnelSettings,
  ingestBounce,
  listMemberProgress,
  listReplies,
  listStepOutputs,
  nodeMetrics,
  recordAttemptSent,
  resumeDecision,
  routeReply,
  saveStepOutput,
  storeReply,
} from "../data/execution-repository";
import type { GraphDocument } from "../domain/graph";

test.after(async () => closeCascadePools());

const TOUCH_A = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const WAIT = "33333333-3333-4333-8333-333333333333";
const TOUCH_B = "44444444-4444-4444-8444-444444444444";
const GOAL = "55555555-5555-4555-8555-555555555555";
const CLOSED = "66666666-6666-4666-8666-666666666666";

test("settings save atomically and reject a stale editor version", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "settings-funnel" });
  const first = await configureFunnel(pool, funnel.id, {
    name: "Configured funnel",
    goalType: "manual",
    goalDescription: "Book the implementation review",
    sendWindow: { days: [6], startHour: 10, endHour: 12 },
    expectedVersion: funnel.version,
  });
  assert.equal(first.version, funnel.version + 1);
  assert.equal(first.name, "Configured funnel");

  await assert.rejects(
    () => configureFunnel(pool, funnel.id, {
      goalDescription: "Stale overwrite",
      expectedVersion: funnel.version,
    }),
    (error: unknown) => error instanceof FunnelSettingsVersionConflictError
      && error.expectedVersion === funnel.version
      && error.currentVersion === first.version,
  );
  assert.equal((await getFunnelSettings(pool, funnel.id)).goalDescription, "Book the implementation review");
});

function buildGraph(): GraphDocument {
  return {
    entryNodeId: TOUCH_A,
    nodes: [
      { id: TOUCH_A, type: "touch", name: "Warm intro", config: { instruction: "write intro", repeat: { maxAttempts: 2, intervalDays: 3 } } },
      { id: BRANCH, type: "branch", name: "Interested?", config: { condition: { kind: "predicate", prompt: "they sound interested" } } },
      { id: WAIT, type: "wait", name: "Cool off", config: { days: 5 } },
      { id: TOUCH_B, type: "touch", name: "Case study", config: { instruction: "write case study", repeat: { maxAttempts: 1, intervalDays: 4 } } },
      { id: GOAL, type: "goal", name: "Booked", config: { outcome: "booked a call" } },
      { id: CLOSED, type: "goal", name: "Closed", config: { outcome: "no response" } },
    ],
    edges: [
      { fromNodeId: TOUCH_A, toNodeId: BRANCH, label: "responded" },
      { fromNodeId: TOUCH_A, toNodeId: WAIT, label: "exhausted" },
      { fromNodeId: BRANCH, toNodeId: GOAL, label: "yes" },
      { fromNodeId: BRANCH, toNodeId: TOUCH_B, label: "no" },
      { fromNodeId: WAIT, toNodeId: TOUCH_B, label: "next" },
      { fromNodeId: TOUCH_B, toNodeId: GOAL, label: "responded" },
      { fromNodeId: TOUCH_B, toNodeId: CLOSED, label: "exhausted" },
    ],
    layout: {},
  };
}

async function seed(pool: Awaited<ReturnType<typeof freshSchema>>, email: string) {
  const funnel = await createFunnel(pool, { name: `exec-${email}` });
  await putGraph(pool, funnel.id, buildGraph(), {});
  const contact = await createContact(pool, { email, attributes: { name: "Test Person", segment: "enterprise" } });
  const member = await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  return { funnel, contact, member };
}

test("drafts save, approve, and mark sent through the attempt walk", async () => {
  const pool = await freshSchema();
  const { funnel, contact, member } = await seed(pool, "drafts@example.test");

  const draft = await saveStepOutput(pool, {
    funnelId: funnel.id,
    memberId: member.id,
    nodeId: TOUCH_A,
    attempt: 1,
    subject: "Hello",
    body: "First touch",
    status: "generated",
    metadata: { model: "stub" },
  }, {});
  assert.equal(draft.status, "generated");

  // Saving the same attempt again replaces the draft instead of duplicating.
  const regenerated = await saveStepOutput(pool, {
    funnelId: funnel.id,
    memberId: member.id,
    nodeId: TOUCH_A,
    attempt: 1,
    subject: "Hello again",
    body: "Fresh regeneration",
    status: "generated",
    metadata: {},
  }, {});
  assert.equal(regenerated.id, draft.id);
  assert.equal(regenerated.subject, "Hello again");

  const approved = await approveStepOutput(pool, funnel.id, draft.id, { subject: "Hello!", body: "Edited body" }, {});
  assert.equal(approved.status, "approved");
  assert.equal(approved.subject, "Hello!");

  const first = await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now: new Date() }, {});
  assert.equal(first.member.attempt, 1);
  assert.equal(first.member.currentNodeId, TOUCH_A); // one attempt left

  const outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]?.status, "sent");

  const second = await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now: new Date() }, {});
  assert.equal(second.member.currentNodeId, WAIT); // exhausted → wait
  assert.equal(second.member.attempt, 0);

  const events = await listFunnelEvents(pool, funnel.id);
  const types = events.map((event) => event.type);
  assert.ok(types.includes("attempt_sent"));
  assert.ok(types.includes("advanced"));
});

test("a positive reply walks the graph, halts at the predicate, and resumes with the decision", async () => {
  const pool = await freshSchema();
  const { funnel, contact, member } = await seed(pool, "replies@example.test");

  const reply = await storeReply(pool, {
    funnelId: funnel.id,
    contactId: contact.id,
    body: "Sounds interesting, tell me more",
  }, {});
  assert.equal(reply.classification, null);

  const routed = await routeReply(pool, {
    funnelId: funnel.id,
    replyId: reply.id,
    classification: "positive",
    classifierNote: "they asked for more",
    now: new Date(),
  }, {});
  assert.ok(routed.pendingDecision, "the predicate branch needs the brain");
  assert.equal(routed.pendingDecision?.nodeId, BRANCH);
  assert.equal(routed.member.currentNodeId, BRANCH);

  const resumed = await resumeDecision(pool, {
    funnelId: funnel.id,
    memberId: member.id,
    nodeId: BRANCH,
    result: true,
    rationale: "the reply asks for a call",
    now: new Date(),
  }, {});
  assert.equal(resumed.member.status, "converted");

  const replies = await listReplies(pool, funnel.id);
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.classification, "positive");
  assert.ok(replies[0]?.routedOutcome);

  const events = await listFunnelEvents(pool, funnel.id);
  const types = events.map((event) => event.type);
  assert.ok(types.includes("reply_received"));
  assert.ok(types.includes("reply_classified"));
  assert.ok(types.includes("branch_evaluated"));
  assert.ok(types.includes("converted"));

  const progress = await listMemberProgress(pool, funnel.id);
  assert.equal(progress[0]?.status, "converted");
});

test("bounces exit the member on the global rail", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "bounce@example.test");
  const bounced = await ingestBounce(pool, { funnelId: funnel.id, contactId: contact.id }, {});
  assert.equal(bounced.member.status, "exited");
  assert.equal(bounced.member.statusReason, "bounced");
});

test("due members project through elapsed waits without persisting, and catch-up persists", async () => {
  const pool = await freshSchema();
  const { funnel, contact, member } = await seed(pool, "due@example.test");

  const now = new Date();
  const dueNow = await computeDueMembers(pool, funnel.id, now);
  assert.equal(dueNow.length, 1);
  assert.equal(dueNow[0]?.nodeId, TOUCH_A);
  assert.equal(dueNow[0]?.attempt, 1);
  assert.equal(dueNow[0]?.draftStatus, null);
  assert.ok(dueNow[0]?.dueAt);
  assert.equal(dueNow[0]?.timezone, "UTC");

  // Exhaust the touch: the member lands on the 5-day wait.
  await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now }, {});
  await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now }, {});

  // Right now nothing is due — the wait has not elapsed.
  const during = await computeDueMembers(pool, funnel.id, now);
  assert.equal(during.length, 0);

  // Six days later the wait has elapsed: the projection shows the next touch.
  const later = new Date(now.getTime() + 6 * 86_400_000);
  const projected = await computeDueMembers(pool, funnel.id, later);
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.nodeId, TOUCH_B);
  assert.equal(projected[0]?.projected, true);

  // The stored cursor is still the wait until catch-up persists the advance.
  let progress = await listMemberProgress(pool, funnel.id);
  assert.equal(progress[0]?.currentNodeId, WAIT);

  const caught = await catchUpMember(pool, { funnelId: funnel.id, memberId: member.id, now: later }, {});
  assert.equal(caught.member.currentNodeId, TOUCH_B);
  progress = await listMemberProgress(pool, funnel.id);
  assert.equal(progress[0]?.currentNodeId, TOUCH_B);
});

test("node metrics count sends and replies per step", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "metrics@example.test");
  const now = new Date();
  await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now }, {});
  const reply = await storeReply(pool, { funnelId: funnel.id, contactId: contact.id, body: "no thanks" }, {});
  await routeReply(pool, { funnelId: funnel.id, replyId: reply.id, classification: "negative", now }, {});

  const metrics = await nodeMetrics(pool, funnel.id);
  assert.equal(metrics[TOUCH_A]?.sent, 1);
  assert.equal(metrics[TOUCH_A]?.replies, 1);
});
