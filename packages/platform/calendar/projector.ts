import {
  getProductEvent,
  hasProductEventProjection,
  listUnprojectedProductEventRefs,
  recordProductEventProjection,
  type StoredProductEvent,
} from "../events/repository";
import { createLogger } from "@content-automation/observability";
import {
  CALENDAR_ENTRY_CHANGED_EVENT,
  calendarEntryChangeSchema,
  type CalendarEntryChange,
} from "./contracts";
import { projectCalendarEntryChange } from "./repository";
import { calendarRegistry } from "./registry";

const log = createLogger("platform.calendar.projector");
const PROJECTOR = "calendar.entries";
const POLICY_VERSION = 1;

/**
 * Product events deliberately outlive some producers and test workspaces, while
 * the calendar projection has a real organization foreign key. A deleted (or
 * synthetic) organization can therefore never become projectable. Recognize
 * only that exact terminal condition so it cannot poison every future sweep;
 * all other database and transport failures remain retryable.
 */
export function isMissingCalendarOrganizationError(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
    const value = candidate as { cause?: unknown; code?: unknown; constraint?: unknown };
    if (value.code === "23503" && value.constraint === "calendar_entries_organization_fk") return true;
    candidate = value.cause;
  }
  return false;
}

async function project(event: StoredProductEvent): Promise<"projected" | "ignored"> {
  const change = calendarEntryChangeSchema.parse(event.payload) as CalendarEntryChange;
  const registry = calendarRegistry.current();
  const manifest = registry.modules.get(change.moduleKey);
  const kind = registry.eventKinds.get(change.kindKey);
  if (!manifest || !kind || !change.kindKey.startsWith(`${manifest.moduleKey}.`)) {
    log.warn("calendar.event.unregistered_kind", {
      module_key: change.moduleKey,
      kind_key: change.kindKey,
      event_id: event.id,
    });
    return "ignored";
  }
  await projectCalendarEntryChange({
    organizationId: event.organizationId,
    eventId: event.id,
    eventOccurredAt: event.occurredAt,
    change,
  });
  return "projected";
}
export async function projectCalendarEvent(input: {
  organizationId: string;
  eventId: string;
}): Promise<"projected" | "ignored" | "missing"> {
  if (await hasProductEventProjection({
    ...input,
    projector: PROJECTOR,
    policyVersion: POLICY_VERSION,
  })) return "projected";
  const event = await getProductEvent(input.organizationId, input.eventId);
  if (!event) return "missing";
  if (event.name !== CALENDAR_ENTRY_CHANGED_EVENT) return "ignored";
  let outcome: "projected" | "ignored";
  try {
    outcome = await project(event);
  } catch (error) {
    if (!isMissingCalendarOrganizationError(error)) throw error;
    outcome = "ignored";
    log.warn("calendar.event.organization_missing", {
      event_id: event.id,
      organization_id: event.organizationId,
    });
  }
  await recordProductEventProjection({
    ...input,
    projector: PROJECTOR,
    policyVersion: POLICY_VERSION,
    outcome,
  });
  return outcome;
}

export async function projectPendingCalendarEvents(limit = 100): Promise<{
  attempted: number;
  projected: number;
  ignored: number;
  failed: number;
}> {
  const refs = await listUnprojectedProductEventRefs({
    projector: PROJECTOR,
    policyVersion: POLICY_VERSION,
    eventNames: [CALENDAR_ENTRY_CHANGED_EVENT],
    limit,
  });
  const result = { attempted: refs.length, projected: 0, ignored: 0, failed: 0 };
  for (const ref of refs) {
    try {
      const outcome = await projectCalendarEvent({ organizationId: ref.organizationId, eventId: ref.id });
      if (outcome === "projected") result.projected += 1;
      else result.ignored += 1;
    } catch (error) {
      result.failed += 1;
      log.error("calendar.event.projection_failed", error, {
        event_id: ref.id,
        organization_id: ref.organizationId,
      });
    }
  }
  return result;
}
