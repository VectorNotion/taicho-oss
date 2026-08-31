import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runWithGraphOrganization } from "@content-automation/platform/data/organization-context";
import { setProductEventSinkForTests } from "@content-automation/platform/events/emit";
import type { ProductEventInsert } from "@content-automation/platform/events/repository";
import { recordContentReminderCalendarChange } from "../calendar-events";
import type { ContentDraft } from "../domain/content";

test("content reminders publish normalized calendar upserts and removals", async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });

  const draft: ContentDraft = {
    id: "draft-calendar-1",
    ideaId: "idea-calendar-1",
    title: "A useful post",
    type: "linkedin_post",
    content: "Draft body",
    status: "ready",
    scheduledFor: "2026-08-21T09:00:00.000Z",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };

  try {
    await runWithGraphOrganization("org-calendar-events", async () => {
      await recordContentReminderCalendarChange(draft);
      await recordContentReminderCalendarChange({ ...draft, scheduledFor: undefined });
    });

    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded.map((event) => event.name), [
      "calendar.entry.changed",
      "calendar.entry.changed",
    ]);
    assert.equal(recorded[0]?.organizationId, "org-calendar-events");
    assert.equal(recorded[0]?.payload.operation, "upsert");
    assert.equal(recorded[0]?.payload.kindKey, "content.reminder");
    assert.equal(recorded[0]?.payload.sourceId, draft.id);
    assert.equal(
      (recorded[0]?.payload.entry as { startsAt?: string }).startsAt,
      draft.scheduledFor,
    );
    assert.equal(recorded[1]?.payload.operation, "remove");
  } finally {
    setProductEventSinkForTests(null);
  }
});
