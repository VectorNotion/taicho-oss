import assert from "node:assert/strict";
import test from "node:test";
import { safeError } from "../privacy";
import { serializeLogRecord } from "../testing";

test("errors are identifiable without ever exporting their messages or stacks", () => {
  process.env.OBSERVABILITY_INCLUDE_ERROR_MESSAGES = "true";
  process.env.OBSERVABILITY_INCLUDE_STACKS = "true";
  const first = safeError(new Error("customer@example.com could not be processed"));
  const second = safeError(new Error("customer@example.com could not be processed"));
  const differentPrivateMessage = safeError(new Error("another customer's private value"));

  assert.equal(first.message, "Operation failed.");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprint, differentPrivateMessage.fingerprint);
  assert.doesNotMatch(JSON.stringify(first), /customer@example\.com/);
  assert.equal(first.stack, undefined);

  const sensitiveMetadata = new Error("private");
  sensitiveMetadata.name = "customer@example.com";
  Object.assign(sensitiveMetadata, { code: "sk-private-value" });
  const sanitized = safeError(sensitiveMetadata);
  assert.equal(sanitized.type, "Error");
  assert.equal(sanitized.code, undefined);
  assert.doesNotMatch(JSON.stringify(sanitized), /customer|private/);

  delete process.env.OBSERVABILITY_INCLUDE_ERROR_MESSAGES;
  delete process.env.OBSERVABILITY_INCLUDE_STACKS;
});

test("free-form log messages are always excluded", () => {
  process.env.OBSERVABILITY_INCLUDE_LOG_MESSAGES = "true";
  const record = serializeLogRecord(
    "info",
    "operation.completed",
    "customer@example.com",
  );
  assert.equal(record.message, undefined);
  assert.doesNotMatch(JSON.stringify(record), /customer@example\.com/);
  delete process.env.OBSERVABILITY_INCLUDE_LOG_MESSAGES;
});
