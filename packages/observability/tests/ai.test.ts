import assert from "node:assert/strict";
import test from "node:test";
import { runWithExecutionContext } from "../context";
import { langfuseClientOptions, MastraPrivacyProcessor } from "../ai";

test("AI trace processor removes content and attaches pseudonymous attribution", () => {
  const previousHashKey = process.env.OBSERVABILITY_ID_HASH_KEY;
  const previousEnvironment = process.env.DD_ENV;
  const previousVersion = process.env.DD_VERSION;
  process.env.OBSERVABILITY_ID_HASH_KEY = "test-key";
  process.env.DD_ENV = "development";
  process.env.DD_VERSION = "test-release";
  const span = {
    name: "private agent name",
    type: "agent_run",
    entityId: "private-agent-id",
    entityName: "Private Agent",
    tags: ["private-tag"],
    attributes: {
      prompt: "private attribute prompt",
      instructions: "private system instructions",
      model: "provider/model",
      usage: { inputTokens: 12, outputTokens: 4 },
      parameters: {
        temperature: 0.2,
        headers: { authorization: "Bearer private" },
      },
    },
    input: { prompt: "private prompt" },
    output: { text: "private answer" },
    metadata: { customerEmail: "private@example.com" },
    errorInfo: { message: "private failure" },
  } as never;

  const result = runWithExecutionContext(
    {
      executionId: "execution-1",
      requestId: "request-1",
      organizationId: "org-raw",
      actorId: "user-raw",
      actorType: "user",
      sessionId: "thread-raw",
    },
    () => new MastraPrivacyProcessor().process(span)!,
  );

  assert.equal(result.input, "[CONTENT REDACTED]");
  assert.equal(result.output, "[CONTENT REDACTED]");
  assert.equal(result.errorInfo?.message, "AI operation failed.");
  assert.equal(result.name, "agent_run");
  assert.equal(result.entityName, undefined);
  assert.match(result.entityId as string, /^entity_/);
  assert.equal(result.tags, undefined);
  assert.equal((result.attributes as { model?: string }).model, "provider/model");
  assert.equal(
    (result.attributes as { usage?: { inputTokens?: number } }).usage?.inputTokens,
    12,
  );
  assert.equal("prompt" in (result.attributes ?? {}), false);
  assert.equal(
    "headers" in ((result.attributes as { parameters?: Record<string, unknown> }).parameters ?? {}),
    false,
  );
  assert.equal(result.metadata?.executionId, "execution-1");
  assert.match(result.metadata?.organizationRef as string, /^organization_/);
  assert.match(result.metadata?.userId as string, /^actor_/);
  assert.match(result.metadata?.sessionId as string, /^session_/);
  assert.deepEqual(langfuseClientOptions(), {
    environment: "development",
    release: "test-release",
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /org-raw|user-raw|thread-raw|private@example\.com|private attribute prompt|private system instructions|Bearer private|Private Agent|private-tag/,
  );
  if (previousHashKey === undefined) delete process.env.OBSERVABILITY_ID_HASH_KEY;
  else process.env.OBSERVABILITY_ID_HASH_KEY = previousHashKey;
  if (previousEnvironment === undefined) delete process.env.DD_ENV;
  else process.env.DD_ENV = previousEnvironment;
  if (previousVersion === undefined) delete process.env.DD_VERSION;
  else process.env.DD_VERSION = previousVersion;
});
