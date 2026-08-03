import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { runWithExecutionContext } from "@content-automation/observability";
import {
  closePool,
  createJob,
  getJobOrganizationId,
  getJobStatus,
  updateJobStatus,
} from "../jobs/repository";

function databaseUrl(user?: string, password?: string): string {
  const source = process.env.DATABASE_URL
    ?? `postgresql://${encodeURIComponent(process.env.POSTGRES_USER ?? "postgres")}:${encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "postgres")}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "langgraph"}`;
  const url = new URL(source);
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}

test("platform jobs enforce RLS and persist attribution across the async boundary", {
  skip: process.env.PLATFORM_DB_TESTS !== "1",
}, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const organizationId = `job_a_${suffix}`;
  const otherOrganizationId = `job_b_${suffix}`;
  const actorId = `service-${randomUUID()}`;
  const requestId = randomUUID();
  const parentExecutionId = randomUUID();
  const role = `jobs_test_${process.pid}_${suffix.slice(0, 12)}`;
  const rolePassword = `T3st${suffix}`;
  const verificationPool = new Pool({ connectionString: databaseUrl() });
  const previous = {
    runtimeUrl: process.env.JOBS_DATABASE_URL,
    adminUrl: process.env.JOBS_ADMIN_DATABASE_URL,
    role: process.env.JOBS_DATABASE_ROLE,
  };
  let jobId: string | undefined;
  let otherJobId: string | undefined;

  try {
    await verificationPool.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    process.env.JOBS_DATABASE_URL = databaseUrl(role, rolePassword);
    process.env.JOBS_ADMIN_DATABASE_URL = databaseUrl();
    process.env.JOBS_DATABASE_ROLE = role;

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
      connectionString: process.env.JOBS_DATABASE_URL,
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
    await verificationPool.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await verificationPool.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
    await verificationPool.end();
    if (previous.runtimeUrl === undefined) delete process.env.JOBS_DATABASE_URL;
    else process.env.JOBS_DATABASE_URL = previous.runtimeUrl;
    if (previous.adminUrl === undefined) delete process.env.JOBS_ADMIN_DATABASE_URL;
    else process.env.JOBS_ADMIN_DATABASE_URL = previous.adminUrl;
    if (previous.role === undefined) delete process.env.JOBS_DATABASE_ROLE;
    else process.env.JOBS_DATABASE_ROLE = previous.role;
  }
});
