import { currentGraphOrganizationId } from "@content-automation/platform/data/organization-context";
import { recordCalendarEntryChange } from "@content-automation/platform/calendar/events";
import type { ContentDraft } from "./domain/content";
import { CONTENT_TYPE_CONFIG } from "./domain/content";

function iso(value: string | undefined): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
export async function recordContentReminderCalendarChange(
  draft: ContentDraft,
  operation?: "upsert" | "remove",
): Promise<void> {
  const organizationId = currentGraphOrganizationId();
  if (!organizationId) return;
  const changedAt = iso(draft.updatedAt);
  const remove = operation === "remove" || !draft.scheduledFor || draft.status !== "ready";
  await recordCalendarEntryChange({
    organizationId,
    change: remove ? {
      operation: "remove",
      moduleKey: "content",
      kindKey: "content.reminder",
      sourceId: draft.id,
      revision: draft.updatedAt || changedAt,
      changedAt,
    } : {
      operation: "upsert",
      moduleKey: "content",
      kindKey: "content.reminder",
      sourceId: draft.id,
      revision: draft.updatedAt || changedAt,
      changedAt,
      entry: {
        state: "scheduled",
        title: draft.title,
        description: `${CONTENT_TYPE_CONFIG[draft.type].shortLabel} posting reminder`,
        startsAt: iso(draft.scheduledFor),
        endsAt: null,
        allDay: false,
        timezone: "UTC",
        href: `/content/${encodeURIComponent(draft.ideaId)}/posts/${encodeURIComponent(draft.id)}`,
        metadata: {
          draftId: draft.id,
          ideaId: draft.ideaId,
          contentType: draft.type,
        },
      },
    },
  });
}
