import { defineCalendarAwareManifest } from "@content-automation/platform/calendar/contracts";

export const chatCalendarManifest = defineCalendarAwareManifest({
  moduleKey: "chat",
  name: "Chat",
  reason: "Chat can inspect authorized calendar context through the shared capability but does not schedule work.",
});

export const supportCalendarManifest = defineCalendarAwareManifest({
  moduleKey: "support",
  name: "Support",
  reason: "Support records feedback and documentation context but does not own scheduled work.",
});
