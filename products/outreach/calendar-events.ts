import { currentGraphOrganizationId } from "@content-automation/platform/data/organization-context";
import { recordCalendarEntryChange } from "@content-automation/platform/calendar/events";
import type { ActionItem } from "./domain/action-items";
import type { ProspectMeeting } from "./domain/prospect-intelligence";

const actionState = {
  open: "scheduled",
  done: "completed",
  dismissed: "cancelled",
} as const;

export async function recordActionItemCalendarChange(
  item: ActionItem,
  operation?: "upsert" | "remove",
): Promise<void> {
  const organizationId = currentGraphOrganizationId();
  if (!organizationId) return;
  const changedAt = new Date(item.updatedAt).toISOString();
  await recordCalendarEntryChange({
    organizationId,
    change: operation === "remove" ? {
      operation: "remove",
      moduleKey: "outreach",
      kindKey: "outreach.follow_up",
      sourceId: item.id,
      revision: item.updatedAt,
      changedAt,
    } : {
      operation: "upsert",
      moduleKey: "outreach",
      kindKey: "outreach.follow_up",
      sourceId: item.id,
      revision: item.updatedAt,
      changedAt,
      entry: {
        state: actionState[item.status],
        title: item.title,
        description: item.source === "auto_followup" ? "Automatic outreach follow-up" : "Outreach next action",
        startsAt: new Date(item.dueAt).toISOString(),
        endsAt: null,
        allDay: false,
        timezone: "UTC",
        href: item.prospectId
          ? `/outreach/prospects/${encodeURIComponent(item.prospectId)}`
          : "/outreach",
        metadata: {
          actionItemId: item.id,
          prospectId: item.prospectId,
          accountId: item.accountId,
          source: item.source,
        },
      },
    },
  });
}
const meetingState = {
  provisioning: "scheduled",
  joining: "in_progress",
  in_meeting: "in_progress",
  post_processing: "in_progress",
  completed: "completed",
  failed: "failed",
} as const;

export async function recordMeetingCalendarChange(input: {
  organizationId: string;
  meeting: ProspectMeeting;
}): Promise<void> {
  if (!input.meeting.scheduledFor) return;
  const changedAt = new Date(input.meeting.updatedAt).toISOString();
  await recordCalendarEntryChange({
    organizationId: input.organizationId,
    change: {
      operation: "upsert",
      moduleKey: "outreach",
      kindKey: "outreach.meeting",
      sourceId: input.meeting.id,
      revision: input.meeting.updatedAt,
      changedAt,
      entry: {
        state: meetingState[input.meeting.status],
        title: "Prospect meeting",
        description: `Meeting capture · ${input.meeting.status.replaceAll("_", " ")}`,
        startsAt: new Date(input.meeting.scheduledFor).toISOString(),
        endsAt: input.meeting.endedAt ? new Date(input.meeting.endedAt).toISOString() : null,
        allDay: false,
        timezone: "UTC",
        href: `/outreach/prospects/${encodeURIComponent(input.meeting.prospectId)}`,
        metadata: {
          meetingId: input.meeting.id,
          prospectId: input.meeting.prospectId,
          provider: input.meeting.provider,
        },
      },
    },
  });
}
