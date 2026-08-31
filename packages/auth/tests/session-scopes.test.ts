import assert from "node:assert/strict";
import test from "node:test";
import { sessionScopesForRole, SESSION_CLIENT_ID_PREFIX } from "../server";

test("no role ever receives the commercial operator scope from a session", () => {
  for (const role of ["owner", "admin", "member", "team_admin", "viewer", "outreach_manager", "outreach_operator", "content_manager", "content_editor"]) {
    assert.ok(!sessionScopesForRole(role).includes("vn:commercial:operator"), `${role} must not imply vn:commercial:operator`);
  }
});

test("owner and admin sessions receive the full workspace scope set", () => {
  for (const role of ["owner", "admin"]) {
    const scopes = new Set(sessionScopesForRole(role));
    for (const scope of [
      "vn:read", "vn:workspace:read", "vn:operations:read", "vn:user:write",
      "vn:outreach:read", "vn:outreach:write",
      "vn:content:read", "vn:content:write", "vn:content:publish",
      "vn:cascade:read", "vn:cascade:write",
      "vn:ai:execute", "vn:workspace:write", "vn:workspace:admin",
      "vn:integrations:write", "vn:billing:write",
      "vn:webhooks:read", "vn:webhooks:write",
      "vn:intelligence:read", "vn:intelligence:execute", "vn:intelligence:outcomes:write",
    ]) {
      assert.ok(scopes.has(scope as never), `${role} must imply ${scope}`);
    }
  }
});

test("viewer sessions can only mutate their own user preferences", () => {
  const scopes = sessionScopesForRole("viewer");
  assert.ok(scopes.includes("vn:read"));
  assert.ok(scopes.includes("vn:outreach:read"));
  assert.ok(scopes.includes("vn:user:write"));
  for (const scope of scopes) {
    assert.ok((!scope.endsWith(":write") || scope === "vn:user:write") && scope !== "vn:content:publish" && scope !== "vn:ai:execute" && scope !== "vn:workspace:admin", `viewer must not receive ${scope}`);
  }
});

test("content editors write content and use AI without workspace administration", () => {
  const scopes = new Set(sessionScopesForRole("content_editor"));
  assert.ok(scopes.has("vn:content:write"));
  assert.ok(scopes.has("vn:ai:execute"));
  assert.ok(!scopes.has("vn:content:publish"));
  assert.ok(!scopes.has("vn:workspace:admin"));
  assert.ok(!scopes.has("vn:outreach:write"));
});

test("session client ids are namespaced and cannot collide with OAuth client ids", () => {
  assert.equal(SESSION_CLIENT_ID_PREFIX, "session:");
});
