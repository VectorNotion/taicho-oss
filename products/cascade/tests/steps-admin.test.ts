import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import {
  createFunnel,
  deleteFunnel,
  deleteFunnelRoute,
  deleteFunnelStep,
  getFunnelDetail,
  saveFunnelWorkflow,
  setFunnelRoute,
  updateFunnelStep,
} from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { closeCascadePools } from "../data/pool";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { closeExecutionLedger } from "@content-automation/observability";

test.after(async () => {
  await Promise.all([
    closeCascadePools(),
    closeExecutionLedger(),
  ]);
});

test("updateFunnelStep changes what the engine executes", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, steps } = await createFunnel(pool, {
    name: "editable",
    steps: [{ type: "email", config: { subject: "old subject", body: "b" } }],
  });
  await updateFunnelStep(pool, steps[0].id, { subject: "new subject", body: "b2" });

  const contact = await createContact(pool, { email: "edit@example.com" });
  await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool);
  await runSendLoop(pool, mailer);
  assert.equal(mailer.sent[0].subject, "new subject");
});

test("deleteFunnelStep repoints parked enrollments and renumbers positions", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "prunable",
    steps: [
      { type: "email", config: { subject: "e1", body: "b" } },
      { type: "delay", config: { seconds: 604800 } },
      { type: "email", config: { subject: "e2", body: "b" } },
    ],
  });
  const contact = await createContact(pool, { email: "prune@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool); // e1 queued, enrollment parked at step 3 behind the 7d delay? no: delay advances cursor to step 3 with +7d

  // Enrollment now sits at step 3 (email e2), 7 days out. Delete step 3's
  // predecessor is history-protected, so delete the future email instead:
  const result = await deleteFunnelStep(pool, steps[2].id);
  assert.equal(result.warning, null);

  const detail = await getFunnelDetail(pool, funnel.id);
  assert.deepEqual(detail!.steps.map((s) => [s.position, s.type]), [
    [1, "email"],
    [2, "delay"],
  ]);
  // The enrollment that pointed at the deleted step completed (no next step).
  const e = await pool.query(`SELECT state, current_step_id FROM enrollments WHERE id = $1`, [enrollment.id]);
  assert.equal(e.rows[0].state, "completed");
  assert.equal(e.rows[0].current_step_id, null);
});

test("deleteFunnelStep renumbers a middle step without violating position constraints", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "middle-prunable",
    steps: [
      { type: "email", config: { subject: "e1", body: "b" } },
      { type: "delay", config: { seconds: 60 } },
      { type: "goal", config: {} },
    ],
  });

  await deleteFunnelStep(pool, steps[1].id);

  const detail = await getFunnelDetail(pool, funnel.id);
  assert.deepEqual(detail!.steps.map((step) => [step.position, step.type]), [
    [1, "email"],
    [2, "goal"],
  ]);
});

test("deleteFunnelStep refuses steps with send history", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, steps } = await createFunnel(pool, {
    name: "protected",
    steps: [{ type: "email", config: { subject: "sent already", body: "b" } }],
  });
  const contact = await createContact(pool, { email: "hist@example.com" });
  await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool);
  await runSendLoop(pool, mailer);

  await assert.rejects(() => deleteFunnelStep(pool, steps[0].id), /send history/);
});

test("deleteFunnel guards history and cleans routes", async () => {
  const pool = await freshSchema();
  const { funnel: used } = await createFunnel(pool, {
    name: "used",
    steps: [{ type: "delay", config: { seconds: 3600 } }, { type: "email", config: { subject: "x", body: "b" } }],
  });
  const contact = await createContact(pool, { email: "keep@example.com" });
  await enrollContact(pool, used.id, contact.id);
  await assert.rejects(() => deleteFunnel(pool, used.id), /enrollment history/);

  const { funnel: fresh } = await createFunnel(pool, {
    name: "fresh",
    steps: [{ type: "email", config: { subject: "y", body: "b" } }],
  });
  await setFunnelRoute(pool, fresh.id, "completed", used.id);
  await deleteFunnel(pool, fresh.id);
  const routes = await pool.query(`SELECT count(*)::int AS n FROM funnel_routes`);
  assert.equal(routes.rows[0].n, 0);
});

test("deleteFunnelRoute removes a single routing rule", async () => {
  const pool = await freshSchema();
  const { funnel: a } = await createFunnel(pool, { name: "ra", steps: [{ type: "goal", config: {} }] });
  const { funnel: b } = await createFunnel(pool, { name: "rb", steps: [{ type: "goal", config: {} }] });
  await setFunnelRoute(pool, a.id, "completed", b.id);
  await setFunnelRoute(pool, a.id, "interest", b.id);
  await deleteFunnelRoute(pool, a.id, "interest");
  const detail = await getFunnelDetail(pool, a.id);
  assert.deepEqual(detail!.routes.map((r) => r.outcome), ["completed"]);
});

test("saveFunnelWorkflow atomically inserts, reorders, configures, routes, and stores layout", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "visual-workflow",
    steps: [
      { type: "email", config: { subject: "first", body: "body" } },
      { type: "delay", config: { seconds: 60 } },
      { type: "goal", config: {} },
    ],
  });
  const { funnel: target } = await createFunnel(pool, {
    name: "visual-target",
    steps: [{ type: "goal", config: {} }],
  });

  const saved = await saveFunnelWorkflow(pool, funnel.id, {
    expectedVersion: 1,
    steps: [
      {
        clientId: steps[1].id,
        id: steps[1].id,
        type: "delay",
        config: { seconds: 7200 },
        position: { x: 80, y: 100 },
      },
      {
        clientId: "draft-email",
        type: "email",
        config: { subject: "inserted", body: "new body" },
        position: { x: 330, y: 100 },
      },
      {
        clientId: "draft-branch",
        type: "branch",
        config: {
          condition: { kind: "event", type: "click" },
          thenPosition: 4,
          elsePosition: 5,
        },
        position: { x: 580, y: 180 },
      },
      {
        clientId: steps[0].id,
        id: steps[0].id,
        type: "email",
        config: { subject: "first edited", body: "body" },
        position: { x: 830, y: 100 },
      },
      {
        clientId: steps[2].id,
        id: steps[2].id,
        type: "goal",
        config: { outcome: "completed" },
        position: { x: 1080, y: 100 },
      },
    ],
    routes: [{
      outcome: "completed",
      toFunnelId: target.id,
      position: { x: 1330, y: 100 },
    }],
  });

  assert.equal(saved.version, 2);
  assert.match(saved.stepIds["draft-email"], /^[0-9a-f-]{36}$/);
  assert.match(saved.stepIds["draft-branch"], /^[0-9a-f-]{36}$/);
  const detail = await getFunnelDetail(pool, funnel.id);
  assert.deepEqual(
    detail!.steps.map((step) => [step.id, step.position, step.type]),
    [
      [steps[1].id, 1, "delay"],
      [saved.stepIds["draft-email"], 2, "email"],
      [saved.stepIds["draft-branch"], 3, "branch"],
      [steps[0].id, 4, "email"],
      [steps[2].id, 5, "goal"],
    ],
  );
  assert.deepEqual(detail!.steps[2].config, {
    condition: { kind: "event", type: "click" },
    thenPosition: 4,
    elsePosition: 5,
  });
  assert.deepEqual(detail!.routes, [{
    outcome: "completed",
    toFunnelId: target.id,
    toFunnelName: "visual-target",
  }]);
  assert.deepEqual(
    detail!.builderLayout.positions?.[saved.stepIds["draft-email"]],
    { x: 330, y: 100 },
  );
  assert.deepEqual(
    detail!.builderLayout.positions?.["route:completed"],
    { x: 1330, y: 100 },
  );

  await assert.rejects(
    () => saveFunnelWorkflow(pool, funnel.id, {
      expectedVersion: 1,
      steps: [],
      routes: [],
    }),
    /changed since it was opened/,
  );
  assert.equal((await getFunnelDetail(pool, funnel.id))!.steps.length, 5);
});

test("saveFunnelWorkflow advances enrollments from a deleted visual node", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "visual-delete",
    steps: [
      { type: "delay", config: { seconds: 3600 } },
      { type: "email", config: { subject: "next", body: "body" } },
      { type: "goal", config: {} },
    ],
  });
  const contact = await createContact(pool, { email: "visual-delete@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  await saveFunnelWorkflow(pool, funnel.id, {
    expectedVersion: 1,
    steps: [
      {
        clientId: steps[1].id,
        id: steps[1].id,
        type: "email",
        config: { subject: "next", body: "body" },
        position: { x: 80, y: 100 },
      },
      {
        clientId: steps[2].id,
        id: steps[2].id,
        type: "goal",
        config: {},
        position: { x: 330, y: 100 },
      },
    ],
    routes: [],
  });

  const cursor = await pool.query(
    `SELECT current_step_id, state FROM enrollments WHERE id = $1`,
    [enrollment.id],
  );
  assert.equal(cursor.rows[0].current_step_id, steps[1].id);
  assert.equal(cursor.rows[0].state, "active");
});

test("saveFunnelWorkflow rolls back when a removed visual node has history", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, steps } = await createFunnel(pool, {
    name: "visual-history",
    steps: [{ type: "email", config: { subject: "sent", body: "body" } }],
  });
  const contact = await createContact(pool, { email: "visual-history@example.com" });
  await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool);
  await runSendLoop(pool, mailer);

  await assert.rejects(
    () => saveFunnelWorkflow(pool, funnel.id, {
      expectedVersion: 1,
      steps: [],
      routes: [],
    }),
    /send history/,
  );
  const detail = await getFunnelDetail(pool, funnel.id);
  assert.equal(detail!.funnel.version, 1);
  assert.equal(detail!.steps[0].id, steps[0].id);
});
