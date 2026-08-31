import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runWithGraphOrganization } from "@content-automation/platform/data/organization-context";
import { setProductEventSinkForTests } from "@content-automation/platform/events/emit";
import type { ProductEventInsert } from "@content-automation/platform/events/repository";
import {
  recordActionItemCalendarChange,
  recordMeetingCalendarChange,
} from "../calendar-events";
import type { ActionItem } from "../domain/action-items";
import type { ProspectMeeting } from "../domain/prospect-intelligence";

test("Outreach follow-ups and meetings emit normalized calendar lifecycles", async (context) => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  context.after(() => setProductEventSinkForTests(null));

  const action: ActionItem = {
    id: "action-calendar-1",
    title: "Follow up with Ada",
    status: "open",
    dueAt: "2026-08-22T09:00:00.000Z",
    source: "manual",
    prospectId: "prospect-1",
    accountId: null,
    payload: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    completedAt: null,
  };
  const meeting: ProspectMeeting = {
    id: "meeting-calendar-1",
    prospectId: "prospect-1",
    provider: "recall",
    providerBotId: "bot-1",
    meetingUrl: "https://meet.example/ada",
    status: "joining",
    statusDetail: null,
    scheduledFor: "2026-08-23T09:00:00.000Z",
    startedAt: null,
    endedAt: null,
    createdBy: "user-1",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:30:00.000Z",
  };

  await runWithGraphOrganization("org-outreach-calendar", async () => {
    await recordActionItemCalendarChange(action);
    await recordActionItemCalendarChange({
      ...action,
      status: "done",
      completedAt: "2026-08-20T11:00:00.000Z",
      updatedAt: "2026-08-20T11:00:00.000Z",
    });
    await recordActionItemCalendarChange(action, "remove");
    await recordMeetingCalendarChange({
      organizationId: "org-outreach-calendar",
      meeting,
    });
  });

  assert.deepEqual(recorded.map((event) => ({
    kindKey: event.payload.kindKey,
    operation: event.payload.operation,
    state: (event.payload.entry as { state?: string } | undefined)?.state,
  })), [
    { kindKey: "outreach.follow_up", operation: "upsert", state: "scheduled" },
    { kindKey: "outreach.follow_up", operation: "upsert", state: "completed" },
    { kindKey: "outreach.follow_up", operation: "remove", state: undefined },
    { kindKey: "outreach.meeting", operation: "upsert", state: "in_progress" },
  ]);
  assert.ok(recorded.every((event) => event.name === "calendar.entry.changed"));
  assert.ok(recorded.every((event) => event.organizationId === "org-outreach-calendar"));
});
