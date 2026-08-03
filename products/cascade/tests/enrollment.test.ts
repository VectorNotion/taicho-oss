import assert from "node:assert/strict";
import test from "node:test";
import { runWithExecutionContext } from "@content-automation/observability";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";

test("createFunnel assigns ordered positions", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "onboarding",
    steps: [
      { type: "email", config: { subject: "hi", body: "welcome" } },
      { type: "delay", config: { seconds: 60 } },
      { type: "email", config: { subject: "again", body: "follow-up" } },
    ],
  });
  assert.equal(funnel.name, "onboarding");
  assert.deepEqual(steps.map((s) => s.position), [1, 2, 3]);
  assert.deepEqual(steps.map((s) => s.type), ["email", "delay", "email"]);
});

test("enrollContact starts active at the first step, due immediately", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "onboarding",
    steps: [{ type: "email", config: { subject: "hi", body: "welcome" } }],
  });
  const contact = await createContact(pool, { email: "lead@example.com" });
  const enrollment = await runWithExecutionContext({
    executionId: "cascade-parent-execution",
    requestId: "cascade-request",
    organizationId: "legacy",
    actorId: "cascade-user",
    actorType: "user",
  }, () => enrollContact(pool, funnel.id, contact.id));
  assert.equal(enrollment.state, "active");
  assert.equal(enrollment.currentStepId, steps[0].id);
  const attribution = await pool.query(
    `SELECT created_by,actor_type,request_id,parent_execution_id
     FROM enrollments WHERE id=$1`,
    [enrollment.id],
  );
  assert.deepEqual(attribution.rows[0], {
    created_by: "cascade-user",
    actor_type: "user",
    request_id: "cascade-request",
    parent_execution_id: "cascade-parent-execution",
  });
  // DB now() may drift a few seconds from the host clock (container VM skew).
  assert.ok(enrollment.nextRunAt.getTime() <= Date.now() + 5000);
});

test("enrollContact rejects a funnel with no steps", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, { name: "empty", steps: [] });
  const contact = await createContact(pool, { email: "lead2@example.com" });
  await assert.rejects(() => enrollContact(pool, funnel.id, contact.id), /has no steps/);
});
