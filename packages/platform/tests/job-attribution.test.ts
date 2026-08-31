import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { migrationPoolConfig, runtimePoolConfig } from "@content-automation/database";
import { runWithExecutionContext } from "@content-automation/observability";
import {
  closePool,
  createJob,
  getJobOrganizationId,
  getJobStatus,
  updateJobStatus,
} from "../jobs/repository";

test("platform jobs enforce RLS and persist attribution across the async boundary", {
  skip: process.env.PLATFORM_DB_TESTS !== "1",
}, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const organizationId = `job_a_${suffix}`;
  const otherOrganizationId = `job_b_${suffix}`;
  const actorId = `service-${randomUUID()}`;
  const requestId = randomUUID();
  const parentExecutionId = randomUUID();
  const verificationPool = new Pool({ ...migrationPoolConfig(), max: 1 });
  let jobId: string | undefined;
  let otherJobId: string | undefined;

  try {
    jobId = await runWithExecutionContext({
      organizationId,
      actorId,
      actorType: "service",
      requestId,
      executionId: parentExecutionId,
    }, () => createJob("do_research", "entity-for-attribution", "research"));

    otherJobId = await runWithExecutionContext({
      organizationId: otherOrganizationId,
      actorId: "other-service",
      actorType: "service",
    }, () => createJob("do_research", "other-entity", "research"));

    const job = await getJobStatus(organizationId, jobId);
    assert.ok(job);
    assert.equal(job.organizationId, organizationId);
    assert.equal(job.initiatingUserId, actorId);
    assert.equal(job.actorType, "service");
    assert.equal(job.requestId, requestId);
    assert.equal(job.parentExecutionId, parentExecutionId);
    assert.equal(await getJobStatus(otherOrganizationId, jobId), null);
    assert.equal(await getJobStatus(organizationId, otherJobId), null);
    assert.equal(await getJobOrganizationId(jobId), organizationId);

    await updateJobStatus(otherOrganizationId, jobId, "failed", {
      error: "cross-tenant write",
    });
    assert.equal((await getJobStatus(organizationId, jobId))?.status, "queued");

    const otherPool = new Pool({
      ...runtimePoolConfig(),
      options: `-capp.organization_id=${otherOrganizationId}`,
    });
    try {
      assert.equal(
        Number((await otherPool.query("SELECT count(*)::int AS count FROM jobs")).rows[0].count),
        1,
      );
      await assert.rejects(
        otherPool.query(
          `INSERT INTO jobs (type, product, entity_id, organization_id)
           VALUES ('do_research', 'content', 'forbidden', $1)`,
          [organizationId],
        ),
        /row-level security policy/,
      );
    } finally {
      await otherPool.end();
    }
  } finally {
    await closePool();
    await verificationPool.query(
      "DELETE FROM jobs WHERE id = ANY($1::uuid[])",
      [[jobId, otherJobId].filter(Boolean)],
    ).catch(() => undefined);
    await verificationPool.end();
  }
});
