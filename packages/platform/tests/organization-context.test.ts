import assert from "node:assert/strict";
import test from "node:test";
import {
  currentGraphOrganizationId,
  organizationGraphName,
  requireGraphOrganizationId,
  runWithGraphOrganization,
} from "../data/organization-context";

test("graph organization context is required by default", () => {
  assert.equal(currentGraphOrganizationId(), null);
  assert.throws(() => requireGraphOrganizationId(), /outside an organization context/);
});

test("concurrent graph organization contexts do not leak", async () => {
  const barrier = Promise.withResolvers<void>();
  const first = runWithGraphOrganization("org-a", async () => {
    await barrier.promise;
    return requireGraphOrganizationId();
  });
  const second = runWithGraphOrganization("org-b", async () => {
    barrier.resolve();
    await Promise.resolve();
    return requireGraphOrganizationId();
  });
  assert.deepEqual(await Promise.all([first, second]), ["org-a", "org-b"]);
  assert.equal(currentGraphOrganizationId(), null);
});

test("organization graph names are stable, opaque, and isolated", () => {
  const a = organizationGraphName("org-a", "content");
  assert.equal(a, organizationGraphName("org-a", "content"));
  assert.notEqual(a, organizationGraphName("org-b", "content"));
  assert.match(a, /^content__org_[a-f0-9]{32}$/);
  assert.doesNotMatch(a, /org-a/);
});
