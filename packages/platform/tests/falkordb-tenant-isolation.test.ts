import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from "../data/graph";

test("FalkorDB reads and writes stay inside the organization graph", {
  skip: process.env.PLATFORM_DB_TESTS !== "1",
}, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const orgA = `graph_a_${suffix}`;
  const orgB = `graph_b_${suffix}`;
  const probeId = `probe_${suffix}`;

  async function inOrganization<T>(
    organizationId: string,
    callback: (session: Awaited<ReturnType<typeof getSession>>) => Promise<T>,
  ): Promise<T> {
    return runWithGraphOrganization(organizationId, async () => {
      const session = await getSession();
      try {
        return await callback(session);
      } finally {
        await session.close();
      }
    });
  }

  try {
    await inOrganization(orgA, (session) => session.run(
      "CREATE (:TenantIsolationProbe {id: $id, value: 'private-a'})",
      { id: probeId },
    ));
    await inOrganization(orgB, (session) => session.run(
      "CREATE (:TenantIsolationProbe {id: $id, value: 'private-b'})",
      { id: probeId },
    ));

    const a = await inOrganization(orgA, (session) => session.run(
      "MATCH (n:TenantIsolationProbe {id: $id}) RETURN n.value AS value",
      { id: probeId },
    ));
    const b = await inOrganization(orgB, (session) => session.run(
      "MATCH (n:TenantIsolationProbe {id: $id}) RETURN n.value AS value",
      { id: probeId },
    ));
    assert.equal(a.records[0]?.get("value"), "private-a");
    assert.equal(b.records[0]?.get("value"), "private-b");

    await inOrganization(orgB, (session) => session.run(
      "MATCH (n:TenantIsolationProbe {id: $id, value: 'private-a'}) SET n.value='forbidden'",
      { id: probeId },
    ));
    const unchanged = await inOrganization(orgA, (session) => session.run(
      "MATCH (n:TenantIsolationProbe {id: $id}) RETURN n.value AS value",
      { id: probeId },
    ));
    assert.equal(unchanged.records[0]?.get("value"), "private-a");
  } finally {
    await Promise.all([orgA, orgB].map((organizationId) => (
      inOrganization(organizationId, (session) => session.run(
        "MATCH (n:TenantIsolationProbe {id: $id}) DETACH DELETE n",
        { id: probeId },
      )).catch(() => undefined)
    )));
    await closeDriver();
  }
});
