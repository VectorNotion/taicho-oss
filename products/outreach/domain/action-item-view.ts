/** Pure due-date presentation logic for action items. Calendar-day based. */

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dayDelta(dueAt: string, now: Date): number {
  return Math.round((startOfDay(new Date(dueAt)) - startOfDay(now)) / 86_400_000);
}

function shortDate(dueAt: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(dueAt));
}

export function dueTone(dueAt: string, now: Date): 'overdue' | 'today' | 'upcoming' {
  const delta = dayDelta(dueAt, now);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  return 'upcoming';
}

export function dueLabel(dueAt: string, now: Date): string {
  const delta = dayDelta(dueAt, now);
  if (delta === 0) return 'Due today';
  if (delta === -1) return 'Overdue · yesterday';
  if (delta < 0 && delta >= -6) return `Overdue · ${-delta} days ago`;
  if (delta < 0) return `Overdue · ${shortDate(dueAt)}`;
  if (delta === 1) return 'Tomorrow';
  if (delta <= 6) return `In ${delta} days`;
  return shortDate(dueAt);
}

export function groupByDue<T extends { dueAt: string }>(
  items: T[],
  now: Date,
): { overdue: T[]; today: T[]; upcoming: T[] } {
  const groups = { overdue: [] as T[], today: [] as T[], upcoming: [] as T[] };
  for (const item of items) groups[dueTone(item.dueAt, now)].push(item);
  return groups;
}
