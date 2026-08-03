import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  closeExecutionLedger,
  enrichExecutionContext,
  observeOperation,
  supportCodeFor,
} from "../index";

const databaseTestsEnabled = process.env.OBSERVABILITY_DB_TESTS === "1";

test("execution ledger retains attribution while excluding payloads", {
  skip: !databaseTestsEnabled,
}, async () => {
  const requestId = randomUUID();
  const executionId = randomUUID();
  const failedExecutionId = randomUUID();
  const lateIdentityExecutionId = randomUUID();
  const organizationId = `org-${randomUUID()}`;
  const actorId = `user-${randomUUID()}`;
  const previous = {
    enabled: process.env.OBSERVABILITY_LEDGER_ENABLED,
    hashKey: process.env.OBSERVABILITY_ID_HASH_KEY,
    logLevel: process.env.OBSERVABILITY_LOG_LEVEL,
  };
  process.env.OBSERVABILITY_LEDGER_ENABLED = "true";
  process.env.OBSERVABILITY_ID_HASH_KEY = "observability-ledger-test-key";
  process.env.OBSERVABILITY_LOG_LEVEL = "silent";

  const verificationPool = new Pool({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "langgraph",
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
  });

  try {
    await observeOperation("test.ledger.attribution", {
      requestId,
      executionId,
      organizationId,
      actorId,
      actorType: "user",
      attributes: {
        "test.kind": "integration",
        "contact.email": "private@example.com",
        prompt: "private prompt text",
      },
    }, async () => undefined);
    await assert.rejects(
      observeOperation("test.ledger.failure", {
        requestId,
        executionId: failedExecutionId,
        organizationId,
        actorId,
        actorType: "user",
        attributes: {
          "test.kind": "failure",
          payload: "private payload",
        },
      }, async () => {
        throw new Error("private@example.com could not be processed");
      }),
    );
    await observeOperation("test.ledger.late_identity", {
      requestId,
      executionId: lateIdentityExecutionId,
      actorType: "system",
    }, async () => {
      enrichExecutionContext({
        organizationId,
        actorId,
        actorType: "user",
        sessionId: "session-learned-after-auth",
      });
    });

    const result = await verificationPool.query<{
      support_code: string;
      execution_id: string;
      request_id: string;
      organization_id: string;
      actor_id: string;
      actor_type: string;
      operation: string;
      status: string;
      safe_attributes: Record<string, unknown>;
      completed_at: Date | null;
      retained_until: Date;
    }>(
      `SELECT support_code, execution_id, request_id, organization_id, actor_id,
              actor_type, operation, status, safe_attributes, completed_at, retained_until
       FROM observability.execution_event
       WHERE execution_id = $1`,
      [executionId],
    );

    assert.equal(result.rowCount, 1);
    const row = result.rows[0];
    assert.equal(row.support_code, supportCodeFor(requestId));
    assert.equal(row.execution_id, executionId);
    assert.equal(row.request_id, requestId);
    assert.equal(row.organization_id, organizationId);
    assert.equal(row.actor_id, actorId);
    assert.equal(row.actor_type, "user");
    assert.equal(row.operation, "test.ledger.attribution");
    assert.equal(row.status, "succeeded");
    assert.deepEqual(row.safe_attributes, { "test.kind": "integration" });
    assert.ok(row.completed_at instanceof Date);
    assert.ok(row.retained_until.getTime() > Date.now());

    const failed = await verificationPool.query<{
      status: string;
      safe_attributes: Record<string, unknown>;
      error_type: string;
      error_fingerprint: string;
      error_code: string | null;
    }>(
      `SELECT status, safe_attributes, error_type, error_fingerprint, error_code
       FROM observability.execution_event
       WHERE execution_id = $1`,
      [failedExecutionId],
    );
    assert.equal(failed.rowCount, 1);
    assert.equal(failed.rows[0].status, "failed");
    assert.deepEqual(failed.rows[0].safe_attributes, { "test.kind": "failure" });
    assert.equal(failed.rows[0].error_type, "Error");
    assert.match(failed.rows[0].error_fingerprint, /^[a-f0-9]{16}$/);
    assert.equal(failed.rows[0].error_code, null);
    assert.doesNotMatch(JSON.stringify(failed.rows[0]), /private|example\.com/i);

    const lateIdentity = await verificationPool.query<{
      organization_id: string;
      actor_id: string;
      actor_type: string;
      session_id: string;
      status: string;
    }>(
      `SELECT organization_id, actor_id, actor_type, session_id, status
       FROM observability.execution_event
       WHERE execution_id = $1`,
      [lateIdentityExecutionId],
    );
    assert.deepEqual(lateIdentity.rows, [{
      organization_id: organizationId,
      actor_id: actorId,
      actor_type: "user",
      session_id: "session-learned-after-auth",
      status: "succeeded",
    }]);
  } finally {
    await verificationPool.query(
      `DELETE FROM observability.execution_event WHERE execution_id = ANY($1::text[])`,
      [[executionId, failedExecutionId, lateIdentityExecutionId]],
    ).catch(() => undefined);
    await verificationPool.end();
    await closeExecutionLedger();
    if (previous.enabled === undefined) delete process.env.OBSERVABILITY_LEDGER_ENABLED;
    else process.env.OBSERVABILITY_LEDGER_ENABLED = previous.enabled;
    if (previous.hashKey === undefined) delete process.env.OBSERVABILITY_ID_HASH_KEY;
    else process.env.OBSERVABILITY_ID_HASH_KEY = previous.hashKey;
    if (previous.logLevel === undefined) delete process.env.OBSERVABILITY_LOG_LEVEL;
    else process.env.OBSERVABILITY_LOG_LEVEL = previous.logLevel;
  }
});
