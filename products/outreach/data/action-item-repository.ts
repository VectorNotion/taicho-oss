/**
 * Action items are workflow state (spec 2026-08-10): they ride Postgres like
 * `jobs` and `product_events`, referencing graph entities by id. The graph
 * stays knowledge-only.
 */
import { action_items as actionItemsTable, databaseFor } from '@content-automation/database';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { getJobPool, validateJobOrganizationId } from '@content-automation/platform/jobs/pool';
import { currentGraphOrganizationId } from '@content-automation/platform/data/organization-context';
import {
  FOLLOW_UP_DEFAULT_DAYS,
  generatedFollowUpPayload,
  type ActionItem,
  type ActionItemSource,
  type ActionItemStatus,
  type CreateActionItemInput,
  type UpdateActionItemInput,
  type FollowUpGenerationType,
} from '../domain/action-items';

function organizationId(): string {
  const current = currentGraphOrganizationId();
  if (!current) {
    throw new Error('Organization context is required for action items.');
  }
  return validateJobOrganizationId(current);
}

function database() {
  return databaseFor(getJobPool(organizationId()));
}

type ActionItemRow = typeof actionItemsTable.$inferSelect;

function mapRow(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status as ActionItemStatus,
    dueAt: row.due_at,
    source: row.source as ActionItemSource,
    prospectId: row.prospect_id,
    accountId: row.account_id,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function createActionItem(input: CreateActionItemInput): Promise<ActionItem> {
  const [row] = await database()
    .insert(actionItemsTable)
    .values({
      organization_id: organizationId(),
      title: input.title,
      due_at: input.dueAt,
      source: input.source ?? 'manual',
      prospect_id: input.prospectId ?? null,
      account_id: input.accountId ?? null,
      payload: input.payload ?? null,
    })
    .returning();
  return mapRow(row);
}

/** RLS scopes every query already; the explicit predicate is defense-in-depth
 * for BYPASSRLS connections (dev superuser), matching the jobs/intelligence
 * repository convention. */
function inOrganization() {
  return eq(actionItemsTable.organization_id, organizationId());
}

export async function updateActionItem(
  id: string,
  input: UpdateActionItemInput,
): Promise<ActionItem | null> {
  const [row] = await database()
    .update(actionItemsTable)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
      updated_at: new Date().toISOString(),
    })
    .where(and(eq(actionItemsTable.id, id), inOrganization()))
    .returning();
  return row ? mapRow(row) : null;
}

async function transition(id: string, status: 'done' | 'dismissed'): Promise<ActionItem | null> {
  const now = new Date().toISOString();
  const [row] = await database()
    .update(actionItemsTable)
    .set({ status, completed_at: now, updated_at: now })
    .where(and(eq(actionItemsTable.id, id), eq(actionItemsTable.status, 'open'), inOrganization()))
    .returning();
  return row ? mapRow(row) : null;
}

export function completeActionItem(id: string): Promise<ActionItem | null> {
  return transition(id, 'done');
}

export function dismissActionItem(id: string): Promise<ActionItem | null> {
  return transition(id, 'dismissed');
}

export async function deleteActionItem(id: string): Promise<boolean> {
  const rows = await database()
    .delete(actionItemsTable)
    .where(and(eq(actionItemsTable.id, id), inOrganization()))
    .returning({ id: actionItemsTable.id });
  return rows.length > 0;
}

export async function listOpenActionItems(
  options?: { dueBefore?: string },
): Promise<ActionItem[]> {
  const conditions = [eq(actionItemsTable.status, 'open'), inOrganization()];
  if (options?.dueBefore) conditions.push(lte(actionItemsTable.due_at, options.dueBefore));
  const rows = await database()
    .select()
    .from(actionItemsTable)
    .where(and(...conditions))
    .orderBy(asc(actionItemsTable.due_at));
  return rows.map(mapRow);
}

export async function getOpenActionItemsForProspects(
  prospectIds: string[],
): Promise<Map<string, ActionItem[]>> {
  const grouped = new Map<string, ActionItem[]>();
  if (prospectIds.length === 0) return grouped;
  const rows = await database()
    .select()
    .from(actionItemsTable)
    .where(and(
      eq(actionItemsTable.status, 'open'),
      inArray(actionItemsTable.prospect_id, prospectIds),
      inOrganization(),
    ))
    .orderBy(asc(actionItemsTable.due_at));
  for (const row of rows) {
    const item = mapRow(row);
    if (!item.prospectId) continue;
    const bucket = grouped.get(item.prospectId) ?? [];
    bucket.push(item);
    grouped.set(item.prospectId, bucket);
  }
  return grouped;
}

/**
 * Touchpoint hook target: create the default follow-up unless the prospect
 * already has an open item. A deliberately-set item is never overwritten.
 */
export async function ensureFollowUpForProspect(
  prospectId: string,
  prospectName: string,
): Promise<ActionItem> {
  const [existing] = await database()
    .select()
    .from(actionItemsTable)
    .where(and(
      eq(actionItemsTable.status, 'open'),
      eq(actionItemsTable.source, 'auto_followup'),
      eq(actionItemsTable.prospect_id, prospectId),
      inOrganization(),
    ))
    .limit(1);
  if (existing) return mapRow(existing);
  // onConflictDoNothing + the partial unique index (one open auto follow-up
  // per prospect) close the check-then-insert race between concurrent
  // touchpoints.
  const [created] = await database()
    .insert(actionItemsTable)
    .values({
      organization_id: organizationId(),
      title: `Follow up with ${prospectName}`,
      due_at: new Date(Date.now() + FOLLOW_UP_DEFAULT_DAYS * 86_400_000).toISOString(),
      source: 'auto_followup',
      prospect_id: prospectId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return mapRow(created);
  const [raced] = await database()
    .select()
    .from(actionItemsTable)
    .where(and(
      eq(actionItemsTable.status, 'open'),
      eq(actionItemsTable.source, 'auto_followup'),
      eq(actionItemsTable.prospect_id, prospectId),
      inOrganization(),
    ))
    .limit(1);
  if (!raced) throw new Error(`Could not ensure a follow-up for prospect ${prospectId}.`);
  return mapRow(raced);
}

/**
 * Generation boundary: manual tasks coexist, a retry returns the same next
 * step, and a newly generated follow-up supersedes the previous automatic one.
 */
export async function ensureGeneratedFollowUp(input: {
  prospectId: string;
  prospectName: string;
  messageId: string;
  medium: string;
  generationType: FollowUpGenerationType;
  cadenceKey?: string;
  cadenceVersion?: number;
  cadenceDays?: number;
  now?: Date;
}): Promise<ActionItem> {
  const payload = generatedFollowUpPayload(input);
  const now = input.now ?? new Date();
  return database().transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(actionItemsTable)
      .where(and(
        eq(actionItemsTable.status, 'open'),
        eq(actionItemsTable.source, 'auto_followup'),
        eq(actionItemsTable.prospect_id, input.prospectId),
        inOrganization(),
      ))
      .limit(1);
    const existingPayload = existing?.payload as Record<string, unknown> | null | undefined;
    if (existing && existingPayload?.triggerMessageId === input.messageId
      && existingPayload?.cadenceKey === payload.cadenceKey) {
      return mapRow(existing);
    }
    if (existing) {
      await transaction
        .update(actionItemsTable)
        .set({
          status: 'done',
          completed_at: now.toISOString(),
          updated_at: now.toISOString(),
          payload: {
            ...(existingPayload ?? {}),
            supersededByMessageId: input.messageId,
          },
        })
        .where(and(eq(actionItemsTable.id, existing.id), inOrganization()));
    }
    const [created] = await transaction
      .insert(actionItemsTable)
      .values({
        organization_id: organizationId(),
        title: `Follow up with ${input.prospectName}`,
        due_at: new Date(now.getTime() + payload.cadenceDays * 86_400_000).toISOString(),
        source: 'auto_followup',
        prospect_id: input.prospectId,
        payload,
      })
      .returning();
    return mapRow(created);
  });
}

/** Cross-store cleanup for prospect deletion: open items lose their target. */
export async function dismissOpenActionItemsForProspect(prospectId: string): Promise<void> {
  const now = new Date().toISOString();
  await database()
    .update(actionItemsTable)
    .set({ status: 'dismissed', completed_at: now, updated_at: now })
    .where(and(
      eq(actionItemsTable.prospect_id, prospectId),
      eq(actionItemsTable.status, 'open'),
      inOrganization(),
    ));
}
