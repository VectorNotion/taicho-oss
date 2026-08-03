import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTING_REMINDER_WINDOW_MS,
  selectPostingReminder,
  type ScheduledPostingReminder,
} from "../domain/posting-reminder";

const now = Date.parse("2026-07-30T10:00:00.000Z");

function reminder(
  id: string,
  publishAt: string,
): ScheduledPostingReminder {
  return {
    draftId: `draft-${id}`,
    id,
    label: "LinkedIn",
    publishAt,
  };
}

test("posting reminder prioritizes overdue work and reports the due count", () => {
  const selection = selectPostingReminder([
    reminder("later", "2026-07-30T10:30:00.000Z"),
    reminder("due-2", "2026-07-30T09:50:00.000Z"),
    reminder("due-1", "2026-07-30T09:40:00.000Z"),
  ], now);

  assert.equal(selection?.kind, "due");
  assert.equal(selection?.count, 2);
  assert.equal(selection?.item.id, "due-1");
});

test("posting reminder surfaces the next post inside the reminder window", () => {
  const selection = selectPostingReminder([
    reminder("outside", "2026-07-30T11:00:01.000Z"),
    reminder("next", "2026-07-30T10:45:00.000Z"),
  ], now);

  assert.equal(selection?.kind, "upcoming");
  assert.equal(selection?.item.id, "next");
});

test("posting reminder stays quiet before the notification window", () => {
  const selection = selectPostingReminder(
    [reminder("later", "2026-07-30T11:00:01.000Z")],
    now,
    POSTING_REMINDER_WINDOW_MS,
  );

  assert.equal(selection, null);
});
