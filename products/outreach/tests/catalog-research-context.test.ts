process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? "outreach_test";

import assert from "node:assert/strict";
import nodeTest, { after, before } from "node:test";
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from "@content-automation/platform/data/graph";
import { resolveAccountForProspect } from "../data/account-repository";
import { createProspect } from "../data/prospect-repository";
import {
  getAccountScore,
  getObservations,
  hasAnyResearchRun,
  recordResearchRun,
  saveAccountScore,
  upsertObservation,
} from "../data/qualification-repository";

const ORGANIZATION_ID = `outreach-catalog-context-test-${process.pid}`;

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

test("research evidence and scores remain isolated by Catalog item", async () => {
  const prospect = await createProspect({ name: "Context Prospect", company: "Context Co", source: "manual" });
  const account = await resolveAccountForProspect(prospect);
  assert.ok(account);

  const score = (icpScore: number) => ({
    icpScore,
    icpScoreConfident: icpScore,
    timingScore: 20,
    hardExcluded: false,
    timingBreakdown: [],
    computedAt: "2026-08-16T00:00:00.000Z",
  });
  await saveAccountScore(account.id, score(30));
  await saveAccountScore(account.id, score(85), "catalog-a");
  assert.equal((await getAccountScore(account.id))?.icpScore, 30);
  assert.equal((await getAccountScore(account.id, "catalog-a"))?.icpScore, 85);
  assert.equal(await getAccountScore(account.id, "catalog-b"), null);

  const observation = (observedValue: string) => ({
    dimensionKey: "industry_fit",
    shape: "prose" as const,
    observedValue,
    evidence: [],
    confidence: 1,
    researchedAt: "2026-08-16T00:00:00.000Z",
    runId: observedValue,
  });
  await upsertObservation({ kind: "account", id: account.id }, observation("workspace finding"));
  await upsertObservation({ kind: "account", id: account.id, catalogItemId: "catalog-a" }, observation("catalog finding"));
  assert.equal((await getObservations({ kind: "account", id: account.id }))[0]?.observedValue, "workspace finding");
  assert.equal((await getObservations({ kind: "account", id: account.id, catalogItemId: "catalog-a" }))[0]?.observedValue, "catalog finding");

  await recordResearchRun(account.id, { runType: "full", refreshedDimensions: ["industry_fit"] }, "catalog-a");
  assert.equal(await hasAnyResearchRun(account.id), false);
  assert.equal(await hasAnyResearchRun(account.id, "catalog-a"), true);
});
