import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { randomUUID } from "node:crypto";
import { runWithExecutionContext } from "@content-automation/observability";
import { runWithGraphOrganization } from "../data/organization-context";
import {
  PRODUCT_EVENT_NAMES,
  drainProductEvents,
  emitProductEvent,
  emitProductEventFromContext,
  setProductEventSinkForTests,
} from "../events/emit";
import type { ProductEventInsert } from "../events/repository";

function captureSink(): ProductEventInsert[] {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  return recorded;
}

beforeEach(() => {
  setProductEventSinkForTests(null);
});

test("emitProductEvent maps refs to columns and merges refs into the payload", async () => {
  const recorded = captureSink();
  emitProductEvent({
    organizationId: "org_events_a",
    name: "lead.qualified",
    payload: { score: 82 },
    refs: { leadId: "lead-1", draftId: "draft-9" },
  });
  await drainProductEvents();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].organizationId, "org_events_a");
  assert.equal(recorded[0].name, "lead.qualified");
  assert.equal(recorded[0].leadId, "lead-1");
  assert.equal(recorded[0].contentId, null);
  assert.equal(recorded[0].postId, null);
  assert.equal(recorded[0].sendId, null);
  assert.equal(recorded[0].source, "product");
  assert.equal(recorded[0].eventVersion, 1);
  assert.equal(recorded[0].origin, "internal");
  assert.equal(recorded[0].connectorId, null);
  assert.equal(recorded[0].externalEventId, null);
  // draftId has no column of its own: it must survive in the payload.
  assert.deepEqual(recorded[0].payload, { score: 82, leadId: "lead-1", draftId: "draft-9" });
});

test("emitProductEvent never throws and never rejects when the insert fails", async () => {
  setProductEventSinkForTests(async () => { throw new Error("db down"); });
  assert.doesNotThrow(() =>
    emitProductEvent({ organizationId: "org_events_a", name: "lead.created" }));
  await drainProductEvents(); // must resolve, not reject
});

test("emitProductEventFromContext resolves the organization from execution context and skips without one", async () => {
  const recorded = captureSink();
  runWithExecutionContext(
    { organizationId: "org_ctx", actorId: "t", actorType: "service" },
    () => emitProductEventFromContext({ name: "lead.researched", refs: { leadId: "lead-2" } }),
  );
  emitProductEventFromContext({ name: "lead.researched", refs: { leadId: "lead-3" } }); // no context: skip
  await drainProductEvents();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].organizationId, "org_ctx");
});

test("trusted connector attribution is copied into the durable event envelope", async () => {
  const recorded = captureSink();
  runWithExecutionContext(
    {
      organizationId: "org_connector",
      actorId: "n8n",
      actorType: "service",
      eventOrigin: "external_connector",
      connectorId: "hubspot",
      externalEventId: "delivery-42",
    },
    () => emitProductEventFromContext({ name: "lead.created", refs: { leadId: "lead-42" } }),
  );
  await drainProductEvents();
  assert.equal(recorded[0].origin, "external_connector");
  assert.equal(recorded[0].connectorId, "hubspot");
  assert.equal(recorded[0].externalEventId, "delivery-42");
});

test("emitProductEventFromContext falls back to the graph organization boundary", async () => {
  const recorded = captureSink();
  runWithGraphOrganization("org_graph", () =>
    emitProductEventFromContext({ name: "outreach.sent", refs: { leadId: "lead-4" } }));
  await drainProductEvents();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].organizationId, "org_graph");
});

test("the frozen v1 vocabulary is exactly the spec §7 lead and content chains", () => {
  // `lead.replied` closes the lead chain (spec §7, emitted from the activity
  // choke point); `post.metrics.updated` closes the feedback chain (emitted by
  // recordMetricSnapshot, plan 2026-07-31-metrics-groundwork). The Cascade
  // email/funnel chain stays Phase 2.
  assert.deepEqual([...PRODUCT_EVENT_NAMES], [
    "lead.created", "lead.researched", "lead.qualified",
    "outreach.generated", "outreach.sent", "lead.replied",
    "draft.ready", "post.scheduled", "post.published", "post.failed",
    "content.angle.emerged",
    "post.metrics.updated",
    "intelligence.artifact.ready", "intelligence.artifact.outcome.reported",
  ]);
});
