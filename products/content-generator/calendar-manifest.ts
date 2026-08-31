import { defineCalendarManifest } from "@content-automation/platform/calendar/contracts";

export const contentCalendarManifest = defineCalendarManifest({
  moduleKey: "content",
  name: "Content Studio",
  version: 1,
  readCapabilityId: "calendar.events.list",
  scheduling: { ownsEvents: true },
  eventKinds: [{
    key: "content.reminder",
    name: "Content reminder",
    description: "A human-selected reminder for a ready content draft.",
    authorization: { product: "content", action: "read" },
    actions: [{
      key: "clear",
      label: "Clear reminder",
      capabilityId: "content.draft.update",
      method: "PATCH",
      pathTemplate: "/content/drafts/{sourceId}",
      body: { scheduledFor: null },
      states: ["scheduled"],
      destructive: true,
    }],
  }],
});

export const publishingCalendarManifest = defineCalendarManifest({
  moduleKey: "publishing",
  name: "Publishing",
  version: 1,
  readCapabilityId: "calendar.events.list",
  scheduling: { ownsEvents: true },
  eventKinds: [{
    key: "publishing.post",
    name: "Publication",
    description: "A scheduled or completed publication owned by the publishing engine.",
    authorization: { product: "content", action: "read" },
    actions: [{
      key: "cancel",
      label: "Cancel publication",
      capabilityId: "publishing.post.cancel",
      method: "POST",
      pathTemplate: "/publishing/posts/{sourceId}/cancel",
      body: { confirm: true },
      states: ["scheduled"],
      destructive: true,
    }, {
      key: "retry",
      label: "Retry publication",
      capabilityId: "publishing.post.retry",
      method: "POST",
      pathTemplate: "/publishing/posts/{sourceId}/retry",
      states: ["failed", "cancelled"],
      destructive: false,
    }],
  }],
});
