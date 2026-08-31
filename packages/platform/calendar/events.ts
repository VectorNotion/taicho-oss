import { recordProductEvent } from "../events/emit";
import {
  CALENDAR_ENTRY_CHANGED_EVENT,
  calendarEntryChangeSchema,
  type CalendarEntryChange,
} from "./contracts";

export async function recordCalendarEntryChange(input: {
  organizationId: string;
  change: CalendarEntryChange;
}): Promise<{ id: string; created: boolean }> {
  const change = calendarEntryChangeSchema.parse(input.change) as CalendarEntryChange;
  return recordProductEvent({
    organizationId: input.organizationId,
    name: CALENDAR_ENTRY_CHANGED_EVENT,
    origin: "internal",
    idempotencyKey: [change.moduleKey, change.sourceId, change.operation, change.revision].join(":"),
    eventVersion: 1,
    payload: change,
  });
}
