import { defineCalendarAwareManifest } from "@content-automation/platform/calendar/contracts";

export const coreCalendarManifest = defineCalendarAwareManifest({
  moduleKey: "core",
  name: "Core Knowledge",
  reason: "Core Knowledge supplies shared graph context and does not own scheduled work.",
});
