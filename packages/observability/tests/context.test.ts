import assert from "node:assert/strict";
import test from "node:test";
import {
  currentExecutionContext,
  externalIdentityRef,
  observeOperation,
  runWithExecutionContext,
} from "../index";
import { serializeLogRecord } from "../testing";

test("execution context follows nested asynchronous work", async () => {
  await runWithExecutionContext({
    executionId: "execution-1",
    requestId: "request-1",
    organizationId: "org-private",
    actorId: "user-private",
    actorType: "user",
    eventOrigin: "external_connector",
    connectorId: "hubspot",
    externalEventId: "delivery-1",
  }, async () => {
    await Promise.resolve();
    assert.equal(currentExecutionContext()?.executionId, "execution-1");
    assert.equal(currentExecutionContext()?.actorId, "user-private");
    assert.equal(currentExecutionContext()?.eventOrigin, "external_connector");
    assert.equal(currentExecutionContext()?.connectorId, "hubspot");
  });
  assert.equal(currentExecutionContext(), undefined);
});

test("nested operations receive unique execution ids and preserve the request chain", async () => {
  const previousLogLevel = process.env.OBSERVABILITY_LOG_LEVEL;
  process.env.OBSERVABILITY_LOG_LEVEL = "silent";
  try {
    await runWithExecutionContext({
      executionId: "http-execution",
      requestId: "request-1",
      actorType: "user",
    }, async () => {
      await observeOperation("test.parent", {}, async (parent) => {
        assert.notEqual(parent.executionId, "http-execution");
        assert.equal(parent.parentExecutionId, "http-execution");
        assert.equal(parent.requestId, "request-1");

        await observeOperation("test.child", {}, async (child) => {
          assert.notEqual(child.executionId, parent.executionId);
          assert.equal(child.parentExecutionId, parent.executionId);
          assert.equal(child.requestId, "request-1");
        });
      });
    });
  } finally {
    if (previousLogLevel === undefined) delete process.env.OBSERVABILITY_LOG_LEVEL;
    else process.env.OBSERVABILITY_LOG_LEVEL = previousLogLevel;
  }
});

test("external identity references are stable and do not expose source ids", () => {
  const first = externalIdentityRef("actor", "user-private");
  const second = externalIdentityRef("actor", "user-private");
  assert.equal(first, second);
  assert.equal(first.includes("user-private"), false);
});

test("structured logs correlate operations without raw tenant, user, or entity ids", () => {
  runWithExecutionContext({
    executionId: "execution-1",
    requestId: "request-1",
    organizationId: "org-private",
    actorId: "user-private",
    actorType: "user",
  }, () => {
    const record = serializeLogRecord("info", "lead.created", undefined, {
      lead_id: "lead-1",
      email: "private@example.com",
      company: "Private Customer",
    });
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("org-private"), false);
    assert.equal(serialized.includes("user-private"), false);
    assert.equal(serialized.includes("private@example.com"), false);
    assert.equal(serialized.includes("Private Customer"), false);
    assert.equal(serialized.includes("lead-1"), false);
    assert.equal(record.execution_id, "execution-1");
    assert.match(record.attributes?.lead_id as string, /^entity_/);
  });
});
