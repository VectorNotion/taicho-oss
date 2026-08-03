import assert from "node:assert/strict";
import test from "node:test";
import { canManageOrganization, canOpenAdmin, permissionForRequest, roleHasPermission } from "../permissions";

test("roles grant only their product operations", () => {
  assert.equal(roleHasPermission("outreach_operator", "outreach", "research"), true);
  assert.equal(roleHasPermission("outreach_operator", "outreach", "delete"), false);
  assert.equal(roleHasPermission("outreach_operator", "content", "read"), false);
  assert.equal(roleHasPermission("content_editor", "content", "generate"), true);
  assert.equal(roleHasPermission("content_editor", "content", "delete"), false);
  assert.equal(roleHasPermission("viewer", "content", "read"), true);
  assert.equal(roleHasPermission("viewer", "content", "update"), false);
});

test("multiple Better Auth organization roles are combined", () => {
  assert.equal(roleHasPermission("outreach_operator,content_editor", "outreach", "qualify"), true);
  assert.equal(roleHasPermission("outreach_operator,content_editor", "content", "generate"), true);
});

test("administration access distinguishes organization and team scope", () => {
  assert.equal(canOpenAdmin("owner"), true);
  assert.equal(canOpenAdmin("admin"), true);
  assert.equal(canOpenAdmin("outreach_operator,team_admin"), true);
  assert.equal(canOpenAdmin("viewer"), false);
  assert.equal(canManageOrganization("owner"), true);
  assert.equal(canManageOrganization("admin"), true);
  assert.equal(canManageOrganization("team_admin"), false);
});

test("API methods resolve to explicit permissions", () => {
  assert.deepEqual(permissionForRequest("/api/outreach/leads", "GET"), { product: "outreach", action: "read" });
  assert.deepEqual(permissionForRequest("/api/outreach/leads/1/research", "POST"), { product: "outreach", action: "research" });
  assert.deepEqual(permissionForRequest("/api/outreach/leads/1", "DELETE"), { product: "outreach", action: "delete" });
  assert.deepEqual(permissionForRequest("/api/content/generate-ideas", "POST"), { product: "content", action: "generate" });
  assert.deepEqual(permissionForRequest("/api/content/drafts/1", "PATCH"), { product: "content", action: "update" });
  assert.deepEqual(permissionForRequest("/api/cascade/variants/1", "POST"), { product: "cascade", action: "approve" });
  assert.deepEqual(permissionForRequest("/api/cascade/variants/1", "DELETE"), { product: "cascade", action: "delete" });
  assert.deepEqual(permissionForRequest("/api/cascade/emails/preview", "POST"), { product: "cascade", action: "read" });
  assert.deepEqual(permissionForRequest("/api/cascade/delivery-settings", "POST"), { product: "cascade", action: "approve" });
  assert.equal(permissionForRequest("/api/chat", "POST"), null);
  assert.equal(permissionForRequest("/api/chat/threads", "GET"), null);
  assert.equal(permissionForRequest("/api/workspace/agent-profile", "PATCH"), null);
  assert.equal(permissionForRequest("/api/settings", "PATCH"), null);
});
