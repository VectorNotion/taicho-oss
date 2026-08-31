import { defineCalendarAwareManifest } from "@content-automation/platform/calendar/contracts";

/**
 * Nurture deliberately has no scheduler today. Keeping an empty contribution
 * makes the extension boundary explicit without inventing delivery behavior.
 */
export const cascadeCalendarManifest = defineCalendarAwareManifest({
  moduleKey: "cascade",
  name: "Nurture",
  version: 1,
  reason: "Nurture is a CRUD-only people list and email store; it does not schedule or deliver messages.",
});
