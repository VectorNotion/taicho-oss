import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { closeCascadePools } from "../data/pool";
import { createContact } from "../data/contact-repository";
import { addFunnelMember, createFunnel } from "../data/funnel-repository";
import { listFunnelEvents, putGraph } from "../data/graph-repository";
import {
  computeDueMembers,
  configureFunnel,
  listMemberProgress,
  listReplies,
  listStepOutputs,
  recordAttemptSent,
} from "../data/execution-repository";
import { generateTouchDrafts, ingestReply, rerouteReply } from "../agent/execution";
import type { CascadeBrain } from "../agent/brain";
import type { GraphDocument } from "../domain/graph";

test.after(async () => closeCascadePools());

const TOUCH_A = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const TOUCH_B = "33333333-3333-4333-8333-333333333333";
const GOAL = "44444444-4444-4444-8444-444444444444";
const CLOSED = "55555555-5555-4555-8555-555555555555";

function buildGraph(): GraphDocument {
  return {
    entryNodeId: TOUCH_A,
    nodes: [
      { id: TOUCH_A, type: "touch", name: "Warm intro", config: { instruction: "Reference something specific about their company.", repeat: { maxAttempts: 2, intervalDays: 3 } } },
      { id: BRANCH, type: "branch", name: "Interested?", config: { condition: { kind: "predicate", prompt: "They sound interested in a call" } } },
      { id: TOUCH_B, type: "touch", name: "Case study", config: { instruction: "Share the closest case study.", repeat: { maxAttempts: 1, intervalDays: 4 } } },
      { id: GOAL, type: "goal", name: "Booked", config: { outcome: "booked a call" } },
      { id: CLOSED, type: "goal", name: "Closed", config: { outcome: "no response" } },
    ],
    edges: [
      { fromNodeId: TOUCH_A, toNodeId: BRANCH, label: "responded" },
      { fromNodeId: TOUCH_A, toNodeId: TOUCH_B, label: "exhausted" },
      { fromNodeId: BRANCH, toNodeId: GOAL, label: "yes" },
      { fromNodeId: BRANCH, toNodeId: TOUCH_B, label: "no" },
      { fromNodeId: TOUCH_B, toNodeId: GOAL, label: "responded" },
      { fromNodeId: TOUCH_B, toNodeId: CLOSED, label: "exhausted" },
    ],
    layout: {},
  };
}

function stubBrain(overrides: Partial<CascadeBrain> = {}): CascadeBrain & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async draftTouch(context) {
      calls.push(`draft:${context.attempt}`);
      return {
        subject: `Attempt ${context.attempt} for ${context.contact.email}`,
        body: `Following the instruction: ${context.instruction} (thread had ${context.thread.length} items)`,
      };
    },
    async readReply(context) {
      calls.push("read");
      const body = context.replyBody.toLowerCase();
      if (body.includes("interest")) return { classification: "positive", note: "they sound keen" };
      if (body.includes("remove me")) return { classification: "unsubscribe", note: "asked to be removed" };
      return { classification: "neutral", note: "hard to tell" };
    },
    async answerPredicate(context) {
      calls.push("predicate");
      return { result: context.thread.some((item) => item.body.toLowerCase().includes("interest")), rationale: "based on their words" };
    },
    ...overrides,
  };
}

async function seed(pool: Awaited<ReturnType<typeof freshSchema>>, email: string) {
  const funnel = await createFunnel(pool, { name: `brain-${email}` });
  await putGraph(pool, funnel.id, buildGraph(), {});
  const contact = await createContact(pool, { email, attributes: { name: "Priya", company: "Acme Robotics" } });
  const member = await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  return { funnel, contact, member };
}

test("due touches are drafted per person and marked generated for review", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "draft@example.test");
  const brain = stubBrain();

  const drafts = await generateTouchDrafts(pool, { funnelId: funnel.id, now: new Date() }, brain, {});
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.attempt, 1);
  assert.equal(drafts[0]?.output?.status, "generated");
  assert.match(drafts[0]?.output?.subject ?? "", /Attempt 1/);

  // A second pass drafts nothing new — the attempt already has its draft.
  const again = await generateTouchDrafts(pool, { funnelId: funnel.id, now: new Date() }, brain, {});
  assert.equal(again.length, 0);
});

test("auto-approve funnels mark drafts approved so the executor sends in one pass", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "auto@example.test");
  await configureFunnel(pool, funnel.id, { autoApprove: true });
  const drafts = await generateTouchDrafts(pool, { funnelId: funnel.id, now: new Date() }, stubBrain(), {});
  assert.equal(drafts[0]?.output?.status, "approved");
});

test("a brain failure stores a failed draft instead of throwing", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "fail@example.test");
  const brain = stubBrain({
    async draftTouch() { throw new Error("model unavailable"); },
  });
  const drafts = await generateTouchDrafts(pool, { funnelId: funnel.id, now: new Date() }, brain, {});
  assert.equal(drafts[0]?.output?.status, "failed");
  assert.equal(drafts[0]?.error, "model unavailable");
  const outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs[0]?.metadata.error, "model unavailable");
});

test("an interested reply is read, walks to the predicate, and the brain's yes converts", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "convert@example.test");
  const brain = stubBrain();
  const now = new Date();

  await generateTouchDrafts(pool, { funnelId: funnel.id, now }, brain, {});
  await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now }, {});

  const result = await ingestReply(pool, {
    funnelId: funnel.id,
    contactId: contact.id,
    body: "This looks interesting — tell me more",
    kind: "reply",
    now,
  }, brain, {});

  assert.equal(result.classification, "positive");
  assert.equal(result.memberStatus, "converted");
  assert.ok(brain.calls.includes("read"));
  assert.ok(brain.calls.includes("predicate"));

  const events = await listFunnelEvents(pool, funnel.id);
  const types = events.map((event) => event.type);
  for (const expected of ["generated", "attempt_sent", "reply_received", "reply_classified", "branch_evaluated", "converted"]) {
    assert.ok(types.includes(expected), `missing event ${expected}`);
  }
});

test("an unsubscribe reply hits the global rail whatever the brain wanted to route", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "unsub@example.test");
  const result = await ingestReply(pool, {
    funnelId: funnel.id,
    contactId: contact.id,
    body: "Please remove me from this list",
    kind: "reply",
    now: new Date(),
  }, stubBrain(), {});
  assert.equal(result.classification, "unsubscribe");
  assert.equal(result.memberStatus, "unsubscribed");
});

test("a bounce exits without calling any model", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "bounced@example.test");
  const brain = stubBrain();
  const result = await ingestReply(pool, { funnelId: funnel.id, contactId: contact.id, kind: "bounce", now: new Date() }, brain, {});
  assert.equal(result.memberStatus, "exited");
  assert.equal(brain.calls.length, 0);
});

test("a human reroute overrides the classifier and re-runs routing", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "reroute@example.test");
  const brain = stubBrain();
  const now = new Date();

  const first = await ingestReply(pool, {
    funnelId: funnel.id,
    contactId: contact.id,
    body: "hmm, maybe",
    kind: "reply",
    now,
  }, brain, {});
  assert.equal(first.classification, "neutral");
  const paused = await listMemberProgress(pool, funnel.id);
  // Neutral consumed by the branch: predicate answered no → case study touch.
  assert.equal(paused[0]?.currentNodeId, TOUCH_B);

  const rerouted = await rerouteReply(pool, {
    funnelId: funnel.id,
    replyId: first.replyId!,
    classification: "negative",
    note: "actually a soft no",
    now,
  }, brain, {});
  assert.equal(rerouted.memberStatus, "exited");
  const replies = await listReplies(pool, funnel.id);
  assert.equal(replies[0]?.classification, "negative");
});

test("drafting includes the unanswered thread on later attempts", async () => {
  const pool = await freshSchema();
  const { funnel, contact } = await seed(pool, "thread@example.test");
  const brain = stubBrain();
  const now = new Date();

  await generateTouchDrafts(pool, { funnelId: funnel.id, now }, brain, {});
  await recordAttemptSent(pool, { funnelId: funnel.id, contactId: contact.id, now }, {});

  const later = new Date(now.getTime() + 4 * 86_400_000);
  const due = await computeDueMembers(pool, funnel.id, later);
  assert.equal(due[0]?.attempt, 2);

  const drafts = await generateTouchDrafts(pool, { funnelId: funnel.id, now: later }, brain, {});
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.output?.body ?? "", /thread had 1 items/);
});
