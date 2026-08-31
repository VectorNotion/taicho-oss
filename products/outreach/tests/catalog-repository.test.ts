process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? "outreach_test";

import assert from "node:assert/strict";
import nodeTest, { after, before } from "node:test";
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from "@content-automation/platform/data/graph";
import {
  assignProspectCatalogItem,
  createCatalogItem,
  deleteCatalogItem,
  getProspectCatalogItem,
  listCatalogItems,
  updateCatalogItem,
} from "../data/catalog-repository";
import { createProspect, getProspectById } from "../data/prospect-repository";

const ORGANIZATION_ID = `outreach-catalog-test-organization-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => inOrganization(body));
}

async function clearGraph() {
  const session = await getSession();
  try { await session.run("MATCH (n) DETACH DELETE n"); }
  finally { await session.close(); }
}

before(() => inOrganization(clearGraph));
after(() => inOrganization(async () => {
  await clearGraph();
  await closeDriver();
}));

test("Catalog CRUD and prospect assignment preserve the commercial context", async () => {
  const item = await createCatalogItem({
    name: "Automation advisory",
    kind: "service",
    summary: "A focused advisory engagement.",
    positioning: "Practical implementation guidance.",
    outcomes: "A prioritized automation roadmap.",
    differentiators: "Operator-led.",
    proof: "Verified delivery examples.",
    researchGuidance: "Look for workflow bottlenecks.",
    voice: "Direct and pragmatic.",
    status: "active",
  });
  assert.ok(item);
  assert.deepEqual((await listCatalogItems()).map(({ id }) => id), [item.id]);
  const updated = await updateCatalogItem(item.id, {
    positioning: "Updated before assignment.",
    expectedRevision: item.revision,
  });
  assert.ok(updated);
  assert.equal(
    updated.positioning,
    "Updated before assignment.",
  );

  const prospect = await createProspect({ name: "Catalog Prospect", source: "manual" });
  assert.equal((await assignProspectCatalogItem(prospect.id, item.id))?.id, item.id);
  assert.equal((await getProspectCatalogItem(prospect.id))?.name, "Automation advisory");
  assert.equal((await getProspectById(prospect.id))?.catalogItemName, "Automation advisory");

  const renamed = await updateCatalogItem(item.id, {
    name: "Automation implementation",
    expectedRevision: updated.revision,
  });
  assert.ok(renamed);
  assert.equal((await getProspectById(prospect.id))?.catalogItemName, "Automation implementation");
  assert.equal(await deleteCatalogItem(item.id, { expectedRevision: renamed.revision }), false, "assigned items cannot be deleted");

  await assignProspectCatalogItem(prospect.id, null);
  assert.equal((await getProspectById(prospect.id))?.catalogItemId, undefined);
  assert.equal(await deleteCatalogItem(item.id, { expectedRevision: renamed.revision }), true);
});

test("an invalid assignment does not clear the existing Catalog item", async () => {
  const item = await createCatalogItem({
    name: "Existing context",
    kind: "product",
    summary: "",
    positioning: "",
    outcomes: "",
    differentiators: "",
    proof: "",
    researchGuidance: "",
    voice: "",
    status: "active",
  });
  assert.ok(item);
  const prospect = await createProspect({ name: "Protected Prospect", source: "manual" });
  await assignProspectCatalogItem(prospect.id, item.id);
  assert.equal(await assignProspectCatalogItem(prospect.id, "missing-item"), null);
  assert.equal((await getProspectCatalogItem(prospect.id))?.id, item.id);
});

test("normalized names are unique and stale mutations cannot replace a newer revision", async () => {
  const first = await createCatalogItem({
    name: "Durable research offering",
    kind: "service",
    summary: "A durable offer.",
    positioning: "Safe updates.",
    outcomes: "Reliable context.",
    differentiators: "Atomic writes.",
    proof: "Browser evidence.",
    researchGuidance: "Inspect durable workflow requirements.",
    voice: "Direct.",
    status: "active",
  });
  assert.ok(first);
  assert.equal(await createCatalogItem({
    name: "  DURABLE RESEARCH OFFERING  ",
    kind: "product",
    summary: "Duplicate.",
    positioning: "",
    outcomes: "",
    differentiators: "",
    proof: "",
    researchGuidance: "Duplicate guidance.",
    voice: "",
    status: "active",
  }), null);

  const winner = await updateCatalogItem(first.id, {
    outcomes: "Winner update",
    expectedRevision: first.revision,
  });
  assert.ok(winner);
  assert.equal(winner.revision, first.revision + 1);
  assert.equal(await updateCatalogItem(first.id, {
    outcomes: "Stale update",
    expectedRevision: first.revision,
  }), null);
  assert.equal(
    await deleteCatalogItem(first.id, { expectedRevision: first.revision }),
    false,
    "a stale delete cannot remove a newer revision",
  );
});
