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
  createProspect,
  getProspectNavigation,
} from "../data/prospect-repository";

const ORGANIZATION_ID = `outreach-navigation-test-organization-${process.pid}`;

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

test("returns prospect neighbours in the pipeline's newest-first order", async () => {
  const oldest = await createProspect({ name: "Oldest", source: "manual" });
  const middle = await createProspect({ name: "Middle", source: "manual" });
  const newest = await createProspect({ name: "Newest", source: "manual" });

  const session = await getSession();
  try {
    await session.run(
      `
      MATCH (p:Prospect)
      SET p.createdAt = CASE p.id
        WHEN $oldestId THEN localdatetime("2026-01-01T00:00:00")
        WHEN $middleId THEN localdatetime("2026-02-01T00:00:00")
        ELSE localdatetime("2026-03-01T00:00:00")
      END
      `,
      { oldestId: oldest.id, middleId: middle.id },
    );
  } finally {
    await session.close();
  }

  const navigation = await getProspectNavigation(middle.id);
  assert.deepEqual(navigation, {
    previous: { id: newest.id, name: "Newest", company: undefined, title: undefined },
    next: { id: oldest.id, name: "Oldest", company: undefined, title: undefined },
    position: 2,
    total: 3,
  });

  const first = await getProspectNavigation(newest.id);
  assert.equal(first?.previous, null);
  assert.equal(first?.next?.id, middle.id);
  assert.equal(await getProspectNavigation("missing"), null);
});
