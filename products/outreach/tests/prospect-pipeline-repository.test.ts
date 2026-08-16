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
  createOutreachMessage,
  createProspect,
  getProspectPipelineCandidates,
} from "../data/prospect-repository";
import { upsertObservation } from "../data/qualification-repository";

const ORGANIZATION_ID = `outreach-pipeline-test-${process.pid}`;

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

test("pipeline evidence follows the current Catalog angle while contact remains global", async () => {
  const prospect = await createProspect({ name: "Pipeline Prospect", source: "manual" });
  const current = async () => {
    const candidates = await getProspectPipelineCandidates();
    return candidates.find(({ prospect: candidate }) => candidate.id === prospect.id)!;
  };

  assert.deepEqual(
    { hasResearch: (await current()).hasResearch, hasDraft: (await current()).hasDraft },
    { hasResearch: false, hasDraft: false },
  );
  await createOutreachMessage({
    prospectId: prospect.id,
    medium: "email",
    content: "Workspace draft",
    status: "draft",
  });
  assert.equal((await current()).hasDraft, true);
  await createOutreachMessage({
    prospectId: prospect.id,
    medium: "email",
    content: "Sent under the workspace angle",
    status: "sent",
  });

  const session = await getSession();
  try {
    await session.run(
      "MATCH (p:Prospect {id: $id}) SET p.catalogItemId = 'catalog-a', p.catalogItemName = 'Catalog A'",
      { id: prospect.id },
    );
  } finally {
    await session.close();
  }
  assert.equal((await current()).hasDraft, false, "a draft for another angle is not ready");

  await createOutreachMessage({
    prospectId: prospect.id,
    medium: "email",
    content: "Catalog draft",
    status: "draft",
    catalogItemId: "catalog-a",
    catalogItemName: "Catalog A",
  });
  await upsertObservation(
    { kind: "prospect", id: prospect.id, catalogItemId: "catalog-a" },
    {
      dimensionKey: "authority",
      shape: "prose",
      observedValue: "Decision maker",
      evidence: [],
      confidence: 1,
      researchedAt: "2026-08-16T00:00:00.000Z",
      runId: "catalog-run",
    },
  );
  assert.equal((await current()).hasDraft, true);
  assert.equal((await current()).hasResearch, true);

  assert.equal((await current()).hasSentMessage, true, "contact history spans Catalog angles");
});
