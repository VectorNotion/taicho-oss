import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRemoteMcpToolSchemas,
  pinRemoteMcpToolSchemas,
  RemoteMcpSchemaDriftError,
  remoteMcpToolSchemaHash,
} from "../integrations/mcp/schema";

test("remote tool schema hashes are stable across object key order", async () => {
  const left = await remoteMcpToolSchemaHash({
    type: "object",
    properties: {
      title: { type: "string" },
      count: { minimum: 1, type: "integer" },
    },
    required: ["title"],
  });
  const right = await remoteMcpToolSchemaHash({
    required: ["title"],
    properties: {
      count: { type: "integer", minimum: 1 },
      title: { type: "string" },
    },
    type: "object",
  });
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("pinning covers every explicitly allowed remote tool", async () => {
  const pins = await pinRemoteMcpToolSchemas([
    { name: "cms.get", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
    { name: "cms.delete", inputSchema: { type: "object", required: ["id"] } },
    { name: "unapproved.tool", inputSchema: {} },
  ], ["cms.delete", "cms.get"]);
  assert.deepEqual(Object.keys(pins), ["cms.delete", "cms.get"]);
  await assertRemoteMcpToolSchemas([
    { name: "cms.get", inputSchema: { properties: { id: { type: "string" } }, type: "object" } },
    { name: "cms.delete", inputSchema: { required: ["id"], type: "object" } },
  ], pins);
});

test("a missing or changed pinned remote schema fails closed", async (t) => {
  const pins = await pinRemoteMcpToolSchemas([
    { name: "cms.delete", inputSchema: { type: "object", required: ["id"] } },
  ], ["cms.delete"]);

  await t.test("missing tool", async () => {
    await assert.rejects(
      () => assertRemoteMcpToolSchemas([], pins),
      (error) => error instanceof RemoteMcpSchemaDriftError
        && error.code === "REMOTE_SCHEMA_DRIFT"
        && error.toolName === "cms.delete",
    );
  });

  await t.test("changed schema", async () => {
    await assert.rejects(
      () => assertRemoteMcpToolSchemas([
        { name: "cms.delete", inputSchema: { type: "object", required: ["id", "confirm"] } },
      ], pins),
      (error) => error instanceof RemoteMcpSchemaDriftError
        && error.code === "REMOTE_SCHEMA_DRIFT"
        && error.toolName === "cms.delete",
    );
  });
});
