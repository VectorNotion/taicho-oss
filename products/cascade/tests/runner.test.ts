import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { freshSchema } from "./helpers";
import { closeCascadePools, getCascadeAdminPool } from "../data/pool";
import { createContact } from "../data/contact-repository";
import { addFunnelMember, createFunnel } from "../data/funnel-repository";
import { listFunnelEvents, putGraph } from "../data/graph-repository";
import {
  configureFunnel,
  listRunEnabledFunnels,
  listMemberProgress,
  listStepOutputs,
} from "../data/execution-repository";
import { runFunnel } from "../agent/runner";
import { CascadeDeliveryError, resendSender, stubSender, type CascadeSender } from "../delivery/sender";
import type { CascadeBrain } from "../agent/brain";
import type { GraphDocument } from "../domain/graph";

test.after(async () => closeCascadePools());

const TOUCH = "11111111-1111-4111-8111-111111111111";
const GOAL = "22222222-2222-4222-8222-222222222222";
const CLOSED = "33333333-3333-4333-8333-333333333333";

function graph(): GraphDocument {
  return {
    entryNodeId: TOUCH,
    nodes: [
      { id: TOUCH, type: "touch", name: "Warm intro", config: { instruction: "say hello", repeat: { maxAttempts: 2, intervalDays: 3 } } },
      { id: GOAL, type: "goal", name: "Replied", config: { outcome: "replied" } },
      { id: CLOSED, type: "goal", name: "Closed", config: { outcome: "no response" } },
    ],
    edges: [
      { fromNodeId: TOUCH, toNodeId: GOAL, label: "responded" },
      { fromNodeId: TOUCH, toNodeId: CLOSED, label: "exhausted" },
    ],
    layout: {},
  };
}

function brain(): CascadeBrain {
  return {
    async draftTouch(context) {
      return { subject: `Hello attempt ${context.attempt}`, body: "Automated body" };
    },
    async readReply() { return { classification: "neutral", note: "n/a" }; },
    async answerPredicate() { return { result: false, rationale: "n/a" }; },
  };
}

function recordingSender(): CascadeSender & { sent: Array<{ to: string; subject: string }> } {
  const sent: Array<{ to: string; subject: string }> = [];
  return {
    name: "recording",
    sent,
    async send(email) {
      sent.push({ to: email.to, subject: email.subject });
      return { providerMessageId: `rec-${sent.length}` };
    },
  };
}

function independentPool(): Pool {
  const options = `-csearch_path=${process.env.CASCADE_SCHEMA ?? "cascade"} -capp.organization_id=${process.env.CASCADE_ORGANIZATION_ID ?? "legacy"}`;
  const connectionString = process.env.CASCADE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (connectionString) return new Pool({ connectionString, options });
  return new Pool({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB ?? "langgraph",
    options,
  });
}

async function seed(pool: Awaited<ReturnType<typeof freshSchema>>, email: string) {
  const funnel = await createFunnel(pool, { name: `auto-${email}` });
  await putGraph(pool, funnel.id, graph(), {});
  await configureFunnel(pool, funnel.id, { autoApprove: true });
  const contact = await createContact(pool, { email, attributes: { name: "Auto Person" } });
  await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  return { funnel, contact };
}

test("a runner pass drafts, sends the due approved draft, and advances the member", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "auto-run@example.test");
  const sender = recordingSender();

  // Send-window free run: due computation clamps into the default window,
  // so pick a "now" safely inside it (next Wednesday noon UTC).
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);

  const summary = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), sender, {});
  assert.equal(summary.drafted, 1);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(sender.sent, [{ to: "auto-run@example.test", subject: "Hello attempt 1" }]);

  const outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs[0]?.status, "sent");
  const [member] = await listMemberProgress(pool, funnel.id);
  assert.equal(member?.attempt, 1); // one of two attempts spent, still on the touch

  const events = await listFunnelEvents(pool, funnel.id);
  const sentEvent = events.find((event) => event.type === "attempt_sent");
  assert.equal(sentEvent?.metadata.provider, "recording");
  assert.ok(sentEvent?.metadata.providerMessageId);

  // A second run in the same instant sends nothing — the next attempt is not due yet.
  const again = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), sender, {});
  assert.equal(again.drafted, 0, "a later attempt is not written before its eligibility time");
  assert.equal(again.sent, 0);
  assert.equal(sender.sent.length, 1);
  assert.equal((await listStepOutputs(pool, funnel.id)).length, 1);
});

test("concurrent runner passes use one provider identity and record one physical attempt", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "concurrent-run@example.test");
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);

  // Prepare the approved draft without delivering it, then force both runners
  // through the provider boundary before either can record completion.
  await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), null, {});
  let calls = 0;
  let release!: () => void;
  const together = new Promise<void>((resolve) => { release = resolve; });
  const providerIds = new Map<string, string>();
  const sender: CascadeSender = {
    name: "idempotent-recording",
    async send(_email, options) {
      calls += 1;
      const key = options?.idempotencyKey;
      assert.ok(key);
      if (calls === 2) release();
      await together;
      const providerMessageId = providerIds.get(key) ?? `provider-${key}`;
      providerIds.set(key, providerMessageId);
      return { providerMessageId };
    },
  };

  const summaries = await Promise.all([
    runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), sender, {}),
    runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), sender, {}),
  ]);
  assert.equal(calls, 2, "both workers can cross the provider boundary after reading the same approved draft");
  assert.equal(providerIds.size, 1, "the provider sees one deterministic idempotency identity");
  assert.equal(summaries.reduce((total, summary) => total + summary.sent, 0), 1);

  const events = await listFunnelEvents(pool, funnel.id);
  assert.equal(events.filter((event) => event.type === "attempt_sent").length, 1);
  const [member] = await listMemberProgress(pool, funnel.id);
  assert.equal(member?.attempt, 1);
});

test("a worker restart resumes after delivery succeeds but its database write fails", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "restart-after-send@example.test");
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);

  // Prepare one approved output, then simulate the worker losing its database
  // connection immediately after the provider accepted the delivery.
  await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), null, {});
  const providerIds = new Map<string, string>();
  let providerCalls = 0;
  const interruptedPool = independentPool();
  const interruptedSender: CascadeSender = {
    name: "restartable-provider",
    async send(_email, options) {
      providerCalls += 1;
      const key = options?.idempotencyKey;
      assert.ok(key);
      const providerMessageId = providerIds.get(key) ?? `provider-${key}`;
      providerIds.set(key, providerMessageId);
      await interruptedPool.end();
      return { providerMessageId };
    },
  };

  const interrupted = await runFunnel(interruptedPool, { funnelId: funnel.id, now: wednesday }, brain(), interruptedSender, {});
  assert.equal(interrupted.sent, 0);
  assert.equal(interrupted.failed, 1);
  let outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs[0]?.status, "approved", "a delivered output remains resumable until its database transition commits");
  assert.equal((await listMemberProgress(pool, funnel.id))[0]?.attempt, 0);

  const resumedPool = independentPool();
  const resumedSender: CascadeSender = {
    name: "restartable-provider",
    async send(_email, options) {
      providerCalls += 1;
      const key = options?.idempotencyKey;
      assert.ok(key);
      const providerMessageId = providerIds.get(key) ?? `provider-${key}`;
      providerIds.set(key, providerMessageId);
      return { providerMessageId };
    },
  };
  const resumed = await runFunnel(resumedPool, { funnelId: funnel.id, now: wednesday }, brain(), resumedSender, {});
  await resumedPool.end();

  assert.equal(resumed.sent, 1);
  assert.equal(providerCalls, 2, "the restarted worker may repeat the provider call");
  assert.equal(providerIds.size, 1, "both provider calls carry the same idempotency identity");
  outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs[0]?.status, "sent");
  assert.equal((await listMemberProgress(pool, funnel.id))[0]?.attempt, 1);
  const events = await listFunnelEvents(pool, funnel.id);
  assert.equal(events.filter((event) => event.type === "attempt_sent").length, 1);
});

test("without a sender the run drafts but skips sends and says so", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "no-sender@example.test");
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);

  const summary = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), null, {});
  assert.equal(summary.drafted, 1);
  assert.equal(summary.sent, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.senderConfigured, null);

  const [member] = await listMemberProgress(pool, funnel.id);
  assert.equal(member?.attempt, 0); // nothing advanced
});

test("a sender failure marks the draft failed and leaves the member in place", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "fail-send@example.test");
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);
  const failing: CascadeSender = {
    name: "failing",
    async send() { throw new Error("provider down"); },
  };

  const summary = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), failing, {});
  assert.equal(summary.failed, 1);
  assert.equal(summary.sent, 0);
  const outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs[0]?.status, "failed");
  assert.equal(outputs[0]?.metadata.error, "provider down");
  const [member] = await listMemberProgress(pool, funnel.id);
  assert.equal(member?.attempt, 0);
});

test("a retryable provider failure preserves the approved line and resumes with the same identity", async () => {
  const pool = await freshSchema();
  const { funnel } = await seed(pool, "retry-send@example.test");
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);
  const keys: string[] = [];
  const retryable: CascadeSender = {
    name: "retryable",
    async send(_email, options) {
      assert.ok(options?.idempotencyKey);
      keys.push(options.idempotencyKey);
      throw new CascadeDeliveryError("Email provider is temporarily unavailable (503).", true, 503);
    },
  };

  const failed = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), retryable, {});
  assert.equal(failed.failed, 1);
  assert.equal((await listStepOutputs(pool, funnel.id))[0]?.status, "approved");
  assert.equal((await listMemberProgress(pool, funnel.id))[0]?.attempt, 0);

  const recovered: CascadeSender = {
    name: "recovered",
    async send(_email, options) {
      assert.ok(options?.idempotencyKey);
      keys.push(options.idempotencyKey);
      return { providerMessageId: `provider-${options.idempotencyKey}` };
    },
  };
  const resumed = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), recovered, {});
  assert.equal(resumed.sent, 1);
  assert.deepEqual(keys, [keys[0], keys[0]], "the retry resumes the exact approved output identity");
  assert.equal((await listStepOutputs(pool, funnel.id))[0]?.status, "sent");
  assert.equal((await listMemberProgress(pool, funnel.id))[0]?.attempt, 1);
});

test("drafts pending human review are never sent", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "review-gate" });
  await putGraph(pool, funnel.id, graph(), {});
  // auto_approve stays false — drafts wait for a human.
  const contact = await createContact(pool, { email: "review-gate@example.test" });
  await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  const sender = recordingSender();
  const now = new Date();
  const wednesday = new Date(now.getTime() + ((3 - now.getUTCDay() + 7) % 7 || 7) * 86_400_000);
  wednesday.setUTCHours(12, 0, 0, 0);

  const summary = await runFunnel(pool, { funnelId: funnel.id, now: wednesday }, brain(), sender, {});
  assert.equal(summary.drafted, 1);
  assert.equal(summary.sent, 0);
  assert.equal(sender.sent.length, 0);
  const outputs = await listStepOutputs(pool, funnel.id);
  assert.equal(outputs[0]?.status, "generated");
});

test("the background pass only sees run-enabled funnels", async () => {
  const pool = await freshSchema();
  const on = await createFunnel(pool, { name: "running-on" });
  const off = await createFunnel(pool, { name: "running-off" });
  await configureFunnel(pool, on.id, { runEnabled: true });

  // The listing is cross-organization by design, so a shared database may
  // hold other enabled funnels — assert containment, never a global count.
  const enabled = await listRunEnabledFunnels(getCascadeAdminPool());
  const ids = enabled.map((entry) => entry.funnelId);
  assert.ok(ids.includes(on.id));
  assert.equal(ids.includes(off.id), false);
});

test("the stub sender reports a provider message id", async () => {
  const result = await stubSender().send({ to: "x@example.test", subject: "s", body: "b" });
  assert.match(result.providerMessageId, /^stub-/);
  const first = await stubSender().send({ to: "x@example.test", subject: "s", body: "b" }, { idempotencyKey: "output-1" });
  const replay = await stubSender().send({ to: "x@example.test", subject: "s", body: "b" }, { idempotencyKey: "output-1" });
  assert.equal(first.providerMessageId, "stub-output-1");
  assert.equal(replay.providerMessageId, first.providerMessageId);
});

test("the HTTP sender classifies safe retryable and permanent failures without exposing provider bodies", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("secret upstream diagnostic", { status: 503 });
    await assert.rejects(
      resendSender("secret", "from@example.test").send({ to: "x@example.test", subject: "s", body: "b" }, { idempotencyKey: "output-1" }),
      (error: unknown) => error instanceof CascadeDeliveryError
        && error.retryable
        && error.status === 503
        && !error.message.includes("secret upstream diagnostic"),
    );
    globalThis.fetch = async () => new Response("recipient detail", { status: 422 });
    await assert.rejects(
      resendSender("secret", "from@example.test").send({ to: "x@example.test", subject: "s", body: "b" }, { idempotencyKey: "output-1" }),
      (error: unknown) => error instanceof CascadeDeliveryError
        && !error.retryable
        && error.status === 422
        && !error.message.includes("recipient detail"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
