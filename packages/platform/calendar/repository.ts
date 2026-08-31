import {
  calendar_entries as calendarEntriesTable,
  databaseFor,
  type Database,
} from "@content-automation/database";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { getJobPool, validateJobOrganizationId } from "../jobs/pool";
import {
  calendarEntryChangeSchema,
  type CalendarEntryChange,
  type CalendarEntryInput,
  type CalendarEntryState,
} from "./contracts";

export interface StoredCalendarEntry extends CalendarEntryInput {
  id: string;
  organizationId: string;
  moduleKey: string;
  kindKey: string;
  sourceId: string;
  revision: string;
  changedAt: string;
  createdAt: string;
  updatedAt: string;
}
type CalendarRow = typeof calendarEntriesTable.$inferSelect;

function storedEntry(row: CalendarRow): StoredCalendarEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    moduleKey: row.module_key,
    kindKey: row.kind_key,
    sourceId: row.source_id,
    revision: row.source_revision,
    state: row.state as CalendarEntryState,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    timezone: row.timezone,
    href: row.href,
    metadata: row.metadata as Record<string, unknown>,
    changedAt: row.event_occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function applyChange(
  database: Database,
  input: {
    organizationId: string;
    eventId?: string | null;
    eventOccurredAt: string;
    change: CalendarEntryChange;
  },
): Promise<void> {
  const change = calendarEntryChangeSchema.parse(input.change) as CalendarEntryChange;
  if (change.operation === "remove") {
    await database
      .delete(calendarEntriesTable)
      .where(and(
        eq(calendarEntriesTable.organization_id, input.organizationId),
        eq(calendarEntriesTable.module_key, change.moduleKey),
        eq(calendarEntriesTable.source_id, change.sourceId),
        lte(calendarEntriesTable.event_occurred_at, input.eventOccurredAt),
      ));
    return;
  }

  await database
    .insert(calendarEntriesTable)
    .values({
      organization_id: input.organizationId,
      module_key: change.moduleKey,
      kind_key: change.kindKey,
      source_id: change.sourceId,
      source_revision: change.revision,
      state: change.entry.state,
      title: change.entry.title,
      description: change.entry.description,
      starts_at: change.entry.startsAt,
      ends_at: change.entry.endsAt,
      all_day: change.entry.allDay,
      timezone: change.entry.timezone,
      href: change.entry.href,
      metadata: change.entry.metadata,
      last_event_id: input.eventId ?? null,
      event_occurred_at: input.eventOccurredAt,
      updated_at: input.eventOccurredAt,
    })
    .onConflictDoUpdate({
      target: [
        calendarEntriesTable.organization_id,
        calendarEntriesTable.module_key,
        calendarEntriesTable.source_id,
      ],
      set: {
        kind_key: change.kindKey,
        source_revision: change.revision,
        state: change.entry.state,
        title: change.entry.title,
        description: change.entry.description,
        starts_at: change.entry.startsAt,
        ends_at: change.entry.endsAt,
        all_day: change.entry.allDay,
        timezone: change.entry.timezone,
        href: change.entry.href,
        metadata: change.entry.metadata,
        last_event_id: input.eventId ?? null,
        event_occurred_at: input.eventOccurredAt,
        updated_at: input.eventOccurredAt,
      },
      setWhere: lte(calendarEntriesTable.event_occurred_at, input.eventOccurredAt),
    });
}

export async function projectCalendarEntryChange(input: {
  organizationId: string;
  eventId: string;
  eventOccurredAt: string;
  change: CalendarEntryChange;
}): Promise<void> {
  const organizationId = validateJobOrganizationId(input.organizationId);
  await applyChange(databaseFor(getJobPool(organizationId)), { ...input, organizationId });
}

/**
 * Repair/backfill seam for module snapshots. Normal writes arrive through the
 * durable event ledger; snapshots make legacy records visible and repair a
 * missed producer event without becoming a second source of truth.
 */
export async function replaceCalendarKindSnapshot(input: {
  organizationId: string;
  moduleKey: string;
  kindKey: string;
  entries: Array<{ sourceId: string; revision: string; changedAt: string; entry: CalendarEntryInput }>;
  snapshotAt?: string;
}): Promise<void> {
  const organizationId = validateJobOrganizationId(input.organizationId);
  const snapshotAt = input.snapshotAt ?? new Date().toISOString();
  const database = databaseFor(getJobPool(organizationId));
  await database.transaction(async (transaction) => {
    for (const item of input.entries) {
      await applyChange(transaction, {
        organizationId,
        eventOccurredAt: item.changedAt || snapshotAt,
        change: {
          operation: "upsert",
          moduleKey: input.moduleKey,
          kindKey: input.kindKey,
          sourceId: item.sourceId,
          revision: item.revision,
          changedAt: item.changedAt || snapshotAt,
          entry: item.entry,
        },
      });
    }

    const currentIds = input.entries.map(({ sourceId }) => sourceId);
    const conditions = [
      eq(calendarEntriesTable.organization_id, organizationId),
      eq(calendarEntriesTable.module_key, input.moduleKey),
      eq(calendarEntriesTable.kind_key, input.kindKey),
      inArray(calendarEntriesTable.state, ["scheduled", "in_progress"]),
      ...(currentIds.length > 0 ? [notInArray(calendarEntriesTable.source_id, currentIds)] : []),
    ];
    await transaction.delete(calendarEntriesTable).where(and(...conditions));
  });
}

export async function listCalendarEntries(input: {
  organizationId: string;
  kindKeys: readonly string[];
  from?: string;
  to?: string;
  states?: readonly CalendarEntryState[];
  limit?: number;
  direction?: "asc" | "desc";
}): Promise<StoredCalendarEntry[]> {
  const organizationId = validateJobOrganizationId(input.organizationId);
  if (input.kindKeys.length === 0) return [];
  const conditions = [
    eq(calendarEntriesTable.organization_id, organizationId),
    inArray(calendarEntriesTable.kind_key, [...input.kindKeys]),
  ];
  if (input.from) {
    conditions.push(or(
      gte(calendarEntriesTable.starts_at, input.from),
      gte(calendarEntriesTable.ends_at, input.from),
    )!);
  }
  if (input.to) conditions.push(lte(calendarEntriesTable.starts_at, input.to));
  if (input.states?.length) conditions.push(inArray(calendarEntriesTable.state, [...input.states]));
  const order = input.direction === "desc"
    ? desc(calendarEntriesTable.starts_at)
    : asc(calendarEntriesTable.starts_at);
  const rows = await databaseFor(getJobPool(organizationId))
    .select()
    .from(calendarEntriesTable)
    .where(and(...conditions))
    .orderBy(order, asc(calendarEntriesTable.id))
    .limit(Math.max(1, Math.min(input.limit ?? 500, 1_000)));
  return rows.map(storedEntry);
}

export async function countCalendarEntries(organizationId: string): Promise<number> {
  const scoped = validateJobOrganizationId(organizationId);
  const [row] = await databaseFor(getJobPool(scoped))
    .select({ count: sql<number>`count(*)::int` })
    .from(calendarEntriesTable)
    .where(eq(calendarEntriesTable.organization_id, scoped));
  return row?.count ?? 0;
}
