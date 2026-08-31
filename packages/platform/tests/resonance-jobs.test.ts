import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { migrationPoolConfig } from "@content-automation/database";
import { Pool } from "pg";
import { getActionProduct } from "../agents/contracts";
import {
  closePool,
  createJob,
  getJobStatus,
  listReconcilableJobIds,
  transitionJobStatus,
} from "../jobs/repository";
import {
  clearJobReconcilers,
  kickJobReconcilers,
  registerJobReconciler,
  registeredJobReconcilerNames,
  runJobReconcilers,
} from "../jobs/reconcilers";

// Mirrors the fixture pattern in job-attribution.test.ts: a random suffix
// keeps each run's rows isolated under RLS without needing a shared constant.
const suffix = randomUUID().replaceAll("-", "");
const TEST_ORG = `resonance_test_${suffix}`;
const TEST_USER = `resonance-user-${suffix}`;
const fixturePool = new Pool({ ...migrationPoolConfig(), max: 1 });

after(async () => {
  await fixturePool.query("DELETE FROM jobs WHERE organization_id = $1", [TEST_ORG]).catch(() => undefined);
  await fixturePool.end();
  await closePool();
});

test("resonance_run maps to the resonance product", () => {
  assert.equal(getActionProduct("resonance_run"), "resonance");
});

test("transitionJobStatus completes a queued job exactly once", async () => {
  const jobId = await createJob("resonance_run", "run", undefined, {
    organizationId: TEST_ORG,
    initiatingUserId: TEST_USER,
    walletUserId: TEST_USER,
    creditReservationId: randomUUID(),
  });

  const first = await transitionJobStatus(
    TEST_ORG,
    jobId,
    ["queued", "processing"],
    "completed",
    { result: { ok: true } },
  );
  const replay = await transitionJobStatus(
    TEST_ORG,
    jobId,
    ["queued", "processing"],
    "completed",
    { result: { ok: false } },
  );

  assert.equal(first, true);
  assert.equal(replay, false);

  const job = await getJobStatus(TEST_ORG, jobId);
  assert.equal(job?.status, "completed");
  assert.deepEqual(job?.result, { ok: true });
});

async function backdateProcessingJob(jobId: string, minutesAgo: number): Promise<void> {
  await fixturePool.query(
    `UPDATE jobs
     SET status = 'processing', started_at = NOW() - make_interval(mins => $2::int)
     WHERE id = $1`,
    [jobId, minutesAgo],
  );
}

async function createProcessingJob(
  type: "resonance_run",
  minutesAgo: number,
  reservationId: string,
): Promise<string> {
  const jobId = await createJob(type, "run", undefined, {
    organizationId: TEST_ORG,
    initiatingUserId: TEST_USER,
    walletUserId: TEST_USER,
    creditReservationId: reservationId,
  });
  await backdateProcessingJob(jobId, minutesAgo);
  return jobId;
}

test("listReconcilableJobIds finds processing runs carrying a modalCallId, and nothing else", async () => {
  const withHandle = await createProcessingJob("resonance_run", 1, randomUUID());
  const withoutHandle = await createProcessingJob("resonance_run", 1, randomUUID());
  const completedWithHandle = await createProcessingJob("resonance_run", 1, randomUUID());

  await fixturePool.query(
    `UPDATE jobs SET result = '{"modalCallId":"fc-123"}'::jsonb WHERE id = ANY($1::uuid[])`,
    [[withHandle, completedWithHandle]],
  );
  await fixturePool.query(
    `UPDATE jobs SET status = 'completed' WHERE id = $1`,
    [completedWithHandle],
  );

  const ids = await listReconcilableJobIds("resonance_run", "modalCallId", 500);

  assert.ok(ids.includes(withHandle));
  assert.ok(!ids.includes(withoutHandle), "a run with no Modal handle has nothing to poll");
  assert.ok(!ids.includes(completedWithHandle), "a finished run must not be re-reconciled");
});

test("job reconcilers run, and one that throws never blocks the others", async () => {
  clearJobReconcilers();
  const ran: string[] = [];
  registerJobReconciler("boom", async () => { ran.push("boom"); throw new Error("nope"); });
  registerJobReconciler("ok", async () => { ran.push("ok"); });

  await runJobReconcilers();

  assert.deepEqual(ran, ["boom", "ok"]);
  assert.deepEqual(registeredJobReconcilerNames(), ["boom", "ok"]);

  // Registration is idempotent: re-registering the same name replaces rather
  // than double-runs (instrumentation may execute more than once per process).
  registerJobReconciler("ok", async () => { ran.push("ok-again"); });
  await runJobReconcilers();
  assert.deepEqual(ran, ["boom", "ok", "boom", "ok-again"]);
  clearJobReconcilers();
});

test("kickJobReconcilers returns immediately, without waiting for a slow pass", async () => {
  // Reconciliation must not put sequential remote Modal polls on an unrelated
  // request's critical path.
  clearJobReconcilers();
  let finish: (() => void) | undefined;
  let finished = false;
  registerJobReconciler("slow", async () => {
    await new Promise<void>((resolve) => { finish = () => { finished = true; resolve(); }; });
  });

  const before = Date.now();
  kickJobReconcilers();
  const elapsed = Date.now() - before;

  assert.ok(elapsed < 50, `kick must return immediately, took ${elapsed}ms`);
  assert.equal(finished, false, "the pass is still running - the caller did not wait for it");
  assert.equal(typeof finish, "function", "...but it did start");

  finish?.();
  await runJobReconcilers();
  assert.equal(finished, true);
  clearJobReconcilers();
});

test("reconciler passes do not pile up: a second kick joins the in-flight pass", async () => {
  // Detached kicks fire on every dispatch. Without a guard, a slow remote
  // would accumulate overlapping passes, multiplying outbound polls against a
  // backend that is already struggling.
  clearJobReconcilers();
  let starts = 0;
  let finish: (() => void) | undefined;
  registerJobReconciler("slow", async () => {
    starts++;
    await new Promise<void>((resolve) => { finish = resolve; });
  });

  const first = runJobReconcilers();
  const second = runJobReconcilers();
  kickJobReconcilers();

  assert.equal(starts, 1, "only one pass runs at a time");
  finish?.();
  await Promise.all([first, second]);

  // Once the in-flight pass drains, a later kick starts a fresh one.
  finish = undefined;
  const third = runJobReconcilers();
  assert.equal(starts, 2);
  finish?.();
  await third;
  clearJobReconcilers();
});

test.after(async () => {
  clearJobReconcilers();
  await closePool();
});
