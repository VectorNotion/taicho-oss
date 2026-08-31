import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { closeCascadePools } from "../data/pool";
import {
  FunnelMemberTransferConflictError,
  createFunnel,
  addFunnelMember,
  listFunnelMembers,
  listFunnels,
  transferFunnelMember,
} from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { GraphVersionConflictError, PendingMemberDeliveryError, getGraph, listFunnelEvents, moveMember, putGraph } from "../data/graph-repository";
import { saveStepOutput } from "../data/execution-repository";
import type { GraphDocument } from "../domain/graph";

test.after(async () => closeCascadePools());

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";

function simpleGraph(): GraphDocument {
  return {
    entryNodeId: A,
    nodes: [
      { id: A, type: "touch", name: "Warm intro", config: { instruction: "write intro", repeat: { maxAttempts: 3, intervalDays: 3 } } },
      { id: B, type: "goal", name: "Booked call", config: {} },
    ],
    edges: [{ fromNodeId: A, toNodeId: B, label: "exhausted" }],
    layout: { [A]: { x: 0, y: 0 }, [B]: { x: 300, y: 0 } },
  };
}

function targetGraph(): GraphDocument {
  return {
    entryNodeId: D,
    nodes: [
      { id: D, type: "wait", name: "Destination entry", config: { days: 1 } },
      { id: E, type: "goal", name: "Destination goal", config: {} },
    ],
    edges: [{ fromNodeId: D, toNodeId: E, label: "next" }],
    layout: {},
  };
}

test("putGraph and getGraph round-trip", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "graph-funnel" });
  await putGraph(pool, funnel.id, simpleGraph(), {});
  const stored = await getGraph(pool, funnel.id);
  assert.equal(stored.entryNodeId, A);
  assert.equal(stored.nodes.length, 2);
  assert.equal(stored.edges.length, 1);
  assert.deepEqual(stored.layout[A], { x: 0, y: 0 });
  const touch = stored.nodes.find((node) => node.id === A);
  assert.equal(touch?.type, "touch");
  assert.equal((touch?.config as { instruction: string }).instruction, "write intro");
  const [summary] = await listFunnels(pool);
  assert.equal(summary?.stepCount, 2);
});

test("putGraph rejects an invalid graph", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "invalid-funnel" });
  const doc = simpleGraph();
  doc.edges = [];
  await assert.rejects(() => putGraph(pool, funnel.id, doc, {}), /arrow/i);
});

test("putGraph rejects a stale editor version without overwriting newer steps", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "concurrent-funnel" });
  const first = simpleGraph();
  first.nodes[0] = { ...first.nodes[0], name: "Saved by the first editor" };
  const saved = await putGraph(pool, funnel.id, first, {}, funnel.version);
  assert.equal(saved.version, funnel.version + 1);

  const stale = simpleGraph();
  stale.nodes[0] = { ...stale.nodes[0], name: "Stale overwrite" };
  await assert.rejects(
    () => putGraph(pool, funnel.id, stale, {}, funnel.version),
    (error: unknown) => error instanceof GraphVersionConflictError
      && error.expectedVersion === funnel.version
      && error.currentVersion === saved.version,
  );
  assert.equal((await getGraph(pool, funnel.id)).nodes[0]?.name, "Saved by the first editor");
});

test("new members land on the entry step with an entered event", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "entry-funnel" });
  await putGraph(pool, funnel.id, simpleGraph(), {});
  const contact = await createContact(pool, { email: "entry@example.com" });
  await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  const [member] = await listFunnelMembers(pool, funnel.id);
  assert.equal(member.currentNodeId, A);
  assert.equal(member.status, "active");
  const events = await listFunnelEvents(pool, funnel.id);
  assert.ok(events.some((event) => event.type === "entered" && event.nodeId === A));
});

test("deleting a node relocates its members to the entry step", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "relocate-funnel" });
  const doc: GraphDocument = {
    ...simpleGraph(),
    nodes: [
      ...simpleGraph().nodes,
      { id: C, type: "touch", name: "Case study", config: { instruction: "case", repeat: { maxAttempts: 1, intervalDays: 3 } } },
    ],
    edges: [
      { fromNodeId: A, toNodeId: C, label: "exhausted" },
      { fromNodeId: C, toNodeId: B, label: "exhausted" },
    ],
  };
  await putGraph(pool, funnel.id, doc, {});
  const contact = await createContact(pool, { email: "relocate@example.com" });
  await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  await moveMember(pool, funnel.id, contact.id, { nodeId: C }, {});
  const { relocatedMembers } = await putGraph(pool, funnel.id, simpleGraph(), {});
  assert.equal(relocatedMembers, 1);
  const [member] = await listFunnelMembers(pool, funnel.id);
  assert.equal(member.currentNodeId, A);
});

test("moveMember updates status with a reason and appends an event", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "move-funnel" });
  await putGraph(pool, funnel.id, simpleGraph(), {});
  const contact = await createContact(pool, { email: "move@example.com" });
  await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  await moveMember(pool, funnel.id, contact.id, { status: "converted", reason: "booked a call" }, {});
  const [member] = await listFunnelMembers(pool, funnel.id);
  assert.equal(member.status, "converted");
  assert.equal(member.statusReason, "booked a call");
  const events = await listFunnelEvents(pool, funnel.id);
  assert.equal(events[0]?.type, "converted");
});

test("an approved delivery blocks a step move but still allows a safety pause", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "delivery-guard" });
  await putGraph(pool, funnel.id, simpleGraph(), {});
  const contact = await createContact(pool, { email: "delivery-guard@example.test" });
  const member = await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  await saveStepOutput(pool, {
    funnelId: funnel.id,
    memberId: member.id,
    nodeId: A,
    attempt: 1,
    subject: "Approved",
    body: "Waiting for delivery",
    status: "approved",
  }, {});

  await assert.rejects(
    () => moveMember(pool, funnel.id, contact.id, { nodeId: B }, {}),
    PendingMemberDeliveryError,
  );
  assert.equal((await listFunnelMembers(pool, funnel.id))[0]?.currentNodeId, A);
  await moveMember(pool, funnel.id, contact.id, { status: "paused", reason: "Safety stop" }, {});
  assert.equal((await listFunnelMembers(pool, funnel.id))[0]?.status, "paused");
});

test("transfer keeps source history exited and starts exactly one eligible destination relationship", async () => {
  const pool = await freshSchema();
  const source = await createFunnel(pool, { name: "Source funnel" });
  const target = await createFunnel(pool, { name: "Target funnel" });
  await putGraph(pool, source.id, simpleGraph(), {});
  await putGraph(pool, target.id, targetGraph(), {});
  const contact = await createContact(pool, { email: "transfer@example.test", attributes: { source: "manual", name: "Transfer Person" } });
  await addFunnelMember(pool, { funnelId: source.id, contactId: contact.id });

  const result = await transferFunnelMember(pool, {
    sourceFunnelId: source.id,
    targetFunnelId: target.id,
    contactId: contact.id,
    reason: "Matched the destination",
  }, {});
  const [sourceMember] = await listFunnelMembers(pool, source.id);
  const [targetMember] = await listFunnelMembers(pool, target.id);
  assert.equal(sourceMember?.status, "exited");
  assert.match(sourceMember?.statusReason ?? "", /Moved to Target funnel/);
  assert.equal(targetMember?.id, result.member.id);
  assert.equal(targetMember?.status, "active");
  assert.equal(targetMember?.currentNodeId, D);
  assert.deepEqual(targetMember?.attributes, { source: "manual", name: "Transfer Person" });
  assert.equal([sourceMember, targetMember].filter((member) => member?.status === "active").length, 1);
  assert.equal((await listFunnelEvents(pool, source.id))[0]?.type, "transferred_out");
  assert.equal((await listFunnelEvents(pool, target.id))[0]?.type, "transferred_in");
});

test("transfer rejects a duplicate destination without changing either relationship", async () => {
  const pool = await freshSchema();
  const source = await createFunnel(pool, { name: "Duplicate source" });
  const target = await createFunnel(pool, { name: "Duplicate target" });
  await putGraph(pool, source.id, simpleGraph(), {});
  await putGraph(pool, target.id, targetGraph(), {});
  const contact = await createContact(pool, { email: "duplicate-transfer@example.test" });
  await addFunnelMember(pool, { funnelId: source.id, contactId: contact.id });
  await addFunnelMember(pool, { funnelId: target.id, contactId: contact.id });

  await assert.rejects(
    () => transferFunnelMember(pool, {
      sourceFunnelId: source.id,
      targetFunnelId: target.id,
      contactId: contact.id,
    }, {}),
    FunnelMemberTransferConflictError,
  );
  assert.equal((await listFunnelMembers(pool, source.id))[0]?.status, "active");
  assert.equal((await listFunnelMembers(pool, target.id))[0]?.status, "active");
});
