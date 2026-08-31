import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarEntryChangeSchema,
  defineCalendarManifest,
} from "../calendar/contracts";
import {
  calendarActionsFor,
  compileCalendarRegistry,
} from "../calendar/registry";

const example = defineCalendarManifest({
  moduleKey: "example",
  name: "Example",
  version: 1,
  readCapabilityId: "calendar.events.list",
  scheduling: { ownsEvents: true },
  eventKinds: [{
    key: "example.deadline",
    name: "Deadline",
    description: "A deadline owned by the example module.",
    authorization: { product: "content", action: "read" },
    actions: [{
      key: "complete",
      label: "Complete",
      capabilityId: "example.deadline.complete",
      method: "POST",
      pathTemplate: "/example/deadlines/{sourceId}/complete",
      states: ["scheduled"],
      destructive: false,
    }],
  }],
});

test("calendar manifests compile event kinds and resolve source-owned actions", () => {
  const registry = compileCalendarRegistry([example]);
  assert.equal(registry.modules.get("example")?.name, "Example");
  assert.equal(registry.eventKinds.get("example.deadline")?.name, "Deadline");
  assert.deepEqual(calendarActionsFor(registry, "example.deadline", "source / one", "scheduled"), [{
    key: "complete",
    label: "Complete",
    capabilityId: "example.deadline.complete",
    method: "POST",
    path: "/example/deadlines/source%20%2F%20one/complete",
    destructive: false,
  }]);
  assert.deepEqual(calendarActionsFor(registry, "example.deadline", "source", "completed"), []);
});

test("calendar manifests fail closed on collisions and foreign namespaces", () => {
  assert.throws(() => compileCalendarRegistry([example, example]), /Duplicate calendar module/);
  assert.throws(() => defineCalendarManifest({
    ...example,
    moduleKey: "other",
  }), /must use the other namespace/);
  assert.throws(() => defineCalendarManifest({
    ...example,
    scheduling: { ownsEvents: false, reason: "No scheduler." },
  }), /cannot declare event kinds/);
  assert.throws(() => defineCalendarManifest({
    ...example,
    scheduling: { ownsEvents: true },
    eventKinds: [],
  }), /must declare at least one event kind/);
});

test("normalized changes require evidence-bearing display fields and valid time order", () => {
  const change = calendarEntryChangeSchema.parse({
    operation: "upsert",
    moduleKey: "example",
    kindKey: "example.deadline",
    sourceId: "deadline-1",
    revision: "3",
    changedAt: "2026-08-20T10:00:00.000Z",
    entry: {
      state: "scheduled",
      title: "Review the launch",
      description: "Owned by Example",
      startsAt: "2026-08-21T10:00:00.000Z",
      endsAt: "2026-08-21T11:00:00.000Z",
      allDay: false,
      timezone: "UTC",
      href: "/example/deadlines/deadline-1",
      metadata: { proofId: "record-1" },
    },
  });
  assert.equal(change.operation, "upsert");
  assert.throws(() => calendarEntryChangeSchema.parse({
    ...change,
    entry: { ...change.entry, endsAt: "2026-08-21T09:00:00.000Z" },
  }));
});
