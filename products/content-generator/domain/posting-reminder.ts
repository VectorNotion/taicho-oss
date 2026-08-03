export const POSTING_REMINDER_WINDOW_MS = 60 * 60 * 1_000;

export interface ScheduledPostingReminder {
  contentBaseId?: string | null;
  draftId: string | null;
  id: string;
  label: string;
  publishAt: string;
}

export interface PostingReminderSelection {
  count: number;
  item: ScheduledPostingReminder;
  kind: "due" | "upcoming";
}

export function selectPostingReminder(
  reminders: ScheduledPostingReminder[],
  now: number,
  windowMs = POSTING_REMINDER_WINDOW_MS,
): PostingReminderSelection | null {
  const scheduled = reminders
    .map((item) => ({ item, timestamp: new Date(item.publishAt).getTime() }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  const due = scheduled.filter((entry) => entry.timestamp <= now);
  if (due.length > 0) {
    return {
      count: due.length,
      item: due[0].item,
      kind: "due",
    };
  }

  const upcoming = scheduled.find(
    (entry) => entry.timestamp <= now + windowMs,
  );
  return upcoming
    ? {
        count: 1,
        item: upcoming.item,
        kind: "upcoming",
      }
    : null;
}
