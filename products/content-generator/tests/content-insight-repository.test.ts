process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? "content_insight_test";

import assert from "node:assert/strict";
import nodeTest, { after, before } from "node:test";
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from "@content-automation/platform/data/graph";
import { findOrCreateContentIdeaFromInsight } from "../data/content-repository";

const ORGANIZATION_ID = `content-insight-test-organization-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => inOrganization(body));
}

async function clearGraph() {
  const session = await getSession();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
  } finally {
    await session.close();
  }
}

before(() => inOrganization(clearGraph));
after(() => inOrganization(async () => {
  await clearGraph();
  await closeDriver();
}));

test("creating an idea from one provider source is idempotent and preserves provenance", async () => {
  const input = {
    title: "Reduce manual operational review work",
    description: "Northstar has this account-level opportunity.",
    rationale: "Published content coverage is below threshold.",
    priority: "medium" as const,
    sourceInsight: {
      provider: "outreach",
      sourceId: "opportunity-1",
      title: "Reduce manual operational review work",
      contextId: "account-1",
      contextLabel: "Northstar",
      evidence: ["https://example.test/evidence"],
      generatedAt: "2026-08-16T00:00:00.000Z",
    },
  };
  const first = await findOrCreateContentIdeaFromInsight(input);
  const second = await findOrCreateContentIdeaFromInsight({
    ...input,
    title: "A repeat click must not create a duplicate",
  });

  assert.equal(second.id, first.id);
  assert.equal(second.title, first.title);
  assert.deepEqual(first.sourceInsight, input.sourceInsight);

  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (idea:ContentIdea {
         sourceInsightProvider: 'outreach', sourceInsightId: 'opportunity-1'
       }) RETURN count(idea) AS count`,
    );
    assert.equal(result.records[0].get("count").toNumber(), 1);
  } finally {
    await session.close();
  }
});
