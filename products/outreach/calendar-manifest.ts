import { defineCalendarManifest } from "@content-automation/platform/calendar/contracts";

export const outreachCalendarManifest = defineCalendarManifest({
  moduleKey: "outreach",
  name: "Outreach",
  version: 1,
  readCapabilityId: "calendar.events.list",
  scheduling: { ownsEvents: true },
  eventKinds: [{
    key: "outreach.follow_up",
    name: "Follow-up",
    description: "A dated next action owned by Outreach.",
    authorization: { product: "outreach", action: "read" },
    actions: [{
      key: "complete",
      label: "Mark complete",
      capabilityId: "outreach.action_item.update",
      method: "PATCH",
      pathTemplate: "/outreach/action-items/{sourceId}",
      body: { action: "complete" },
      states: ["scheduled"],
      destructive: false,
    }, {
      key: "dismiss",
      label: "Dismiss follow-up",
      capabilityId: "outreach.action_item.update",
      method: "PATCH",
      pathTemplate: "/outreach/action-items/{sourceId}",
      body: { action: "dismiss" },
      states: ["scheduled"],
      destructive: true,
    }],
  }, {
    key: "outreach.meeting",
    name: "Prospect meeting",
    description: "A prospect meeting with an explicit scheduled time.",
    authorization: { product: "outreach", action: "read" },
    actions: [],
  }],
});
