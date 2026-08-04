import { randomUUID } from 'node:crypto';
import {
  attention_items as attentionItemsTable,
  databaseFor,
  intelligence_api_tokens as apiTokensTable,
  intelligence_artifact_outcomes as artifactOutcomesTable,
  intelligence_artifacts as artifactsTable,
  intelligence_runs as runsTable,
  jobWorkspaceMemberIds as workspaceMemberIdsView,
  notification_preferences as notificationPreferencesTable,
  notification_recipients as notificationRecipientsTable,
  product_events as productEventsTable,
  product_event_projections as productEventProjectionsTable,
} from '@content-automation/database';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { getJobPool, validateJobOrganizationId } from '../jobs/pool';
import type {
  ArtifactDraft,
  AttentionItem,
  AttentionSuggestedAction,
  CanonicalIntelligenceWorkflow,
  IntelligenceRun,
  NotificationCategory,
  NotificationInboxItem,
  NotificationPreference,
  NotificationRecipientStatus,
  StructuredArtifact,
  WorkflowTrigger,
} from './contracts';

type ActorType = 'user' | 'service' | 'system';

function dbFor(organizationId: string) {
  const scoped = validateJobOrganizationId(organizationId);
  return { db: databaseFor(getJobPool(scoped)), organizationId: scoped };
}

function runFromRow(row: typeof runsTable.$inferSelect): IntelligenceRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workflow: row.workflow_key as CanonicalIntelligenceWorkflow,
    status: row.status as IntelligenceRun['status'],
    trigger: row.trigger as WorkflowTrigger,
    input: row.input as Record<string, unknown>,
    idempotencyKey: row.idempotency_key,
    initiatingUserId: row.initiating_user_id,
    actorType: row.actor_type as ActorType,
    error: row.error as Record<string, unknown> | null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function artifactFromRow(row: typeof artifactsTable.$inferSelect): StructuredArtifact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    runId: row.run_id,
    workflow: row.workflow_key as CanonicalIntelligenceWorkflow,
    kind: row.kind as StructuredArtifact['kind'],
    status: row.status as StructuredArtifact['status'],
    title: row.title,
    summary: row.summary,
    content: row.content as Record<string, unknown>,
    sourceRefs: row.source_refs as StructuredArtifact['sourceRefs'],
    recommendations: row.recommendations as StructuredArtifact['recommendations'],
    provenance: row.provenance as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function attentionFromRow(row: typeof attentionItemsTable.$inferSelect): AttentionItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    artifactId: row.artifact_id,
    status: row.status as AttentionItem['status'],
    priority: row.priority as AttentionItem['priority'],
    category: row.category as AttentionItem['category'],
    policyVersion: row.policy_version,
    groupKey: row.group_key,
    title: row.title,
    message: row.message,
    entityType: row.entity_type,
    entityId: row.entity_id,
    suggestedAction: row.suggested_action as unknown as AttentionSuggestedAction,
    assignedUserId: row.assigned_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    expiresAt: row.expires_at,
  };
}

export async function createIntelligenceRun(input: {
  organizationId: string;
  workflow: CanonicalIntelligenceWorkflow;
  trigger: WorkflowTrigger;
  workflowInput: Record<string, unknown>;
  idempotencyKey: string;
  initiatingUserId?: string;
  actorType: ActorType;
}): Promise<{ run: IntelligenceRun; created: boolean }> {
  const { db, organizationId } = dbFor(input.organizationId);
  const inserted = await db
    .insert(runsTable)
    .values({
      organization_id: organizationId,
      workflow_key: input.workflow,
      trigger: input.trigger,
      input: input.workflowInput,
      idempotency_key: input.idempotencyKey,
      initiating_user_id: input.initiatingUserId ?? null,
      actor_type: input.actorType,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { run: runFromRow(inserted[0]), created: true };

  const [existing] = await db
    .select()
    .from(runsTable)
    .where(and(
      eq(runsTable.organization_id, organizationId),
      eq(runsTable.workflow_key, input.workflow),
      eq(runsTable.idempotency_key, input.idempotencyKey),
    ))
    .limit(1);
  if (!existing) throw new Error('The intelligence run could not be reserved.');
  return { run: runFromRow(existing), created: false };
}

export async function failIntelligenceRun(
  organizationId: string,
  runId: string,
  error: Record<string, unknown>,
): Promise<void> {
  const scoped = dbFor(organizationId);
  await scoped.db
    .update(runsTable)
    .set({ status: 'failed', completed_at: new Date().toISOString(), error })
    .where(and(eq(runsTable.organization_id, scoped.organizationId), eq(runsTable.id, runId)));
}

export async function getIntelligenceRun(
  organizationId: string,
  runId: string,
): Promise<IntelligenceRun | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.organization_id, scoped.organizationId), eq(runsTable.id, runId)))
    .limit(1);
  return row ? runFromRow(row) : null;
}

export async function listIntelligenceRuns(
  organizationId: string,
  options: { limit?: number } = {},
): Promise<IntelligenceRun[]> {
  const scoped = dbFor(organizationId);
  const rows = await scoped.db
    .select()
    .from(runsTable)
    .where(eq(runsTable.organization_id, scoped.organizationId))
    .orderBy(desc(runsTable.created_at))
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));
  return rows.map(runFromRow);
}

/** Atomically persist the workflow's only handoff artifact and complete its run. */
export async function commitIntelligenceArtifact(input: {
  organizationId: string;
  runId: string;
  draft: ArtifactDraft;
}): Promise<StructuredArtifact> {
  const scoped = dbFor(input.organizationId);
  return scoped.db.transaction(async (transaction) => {
    const [row] = await transaction
      .insert(artifactsTable)
      .values({
        organization_id: scoped.organizationId,
        run_id: input.runId,
        workflow_key: input.draft.workflow,
        kind: input.draft.kind,
        status: input.draft.status ?? 'ready',
        title: input.draft.title,
        summary: input.draft.summary,
        content: input.draft.content,
        source_refs: input.draft.sourceRefs,
        recommendations: input.draft.recommendations,
        provenance: input.draft.provenance,
      })
      .returning();
    const completed = await transaction
      .update(runsTable)
      .set({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error: null,
      })
      .where(and(
        eq(runsTable.organization_id, scoped.organizationId),
        eq(runsTable.id, input.runId),
        eq(runsTable.status, 'running'),
      ))
      .returning({ id: runsTable.id });
    if (!row || !completed[0]) {
      throw new Error('The intelligence artifact could not be committed to its run.');
    }
    return artifactFromRow(row);
  });
}

export async function getArtifact(
  organizationId: string,
  artifactId: string,
): Promise<StructuredArtifact | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select()
    .from(artifactsTable)
    .where(and(
      eq(artifactsTable.organization_id, scoped.organizationId),
      eq(artifactsTable.id, artifactId),
    ))
    .limit(1);
  return row ? artifactFromRow(row) : null;
}

export async function listIntelligenceArtifacts(
  organizationId: string,
  options: { limit?: number } = {},
): Promise<StructuredArtifact[]> {
  const scoped = dbFor(organizationId);
  const rows = await scoped.db
    .select()
    .from(artifactsTable)
    .where(eq(artifactsTable.organization_id, scoped.organizationId))
    .orderBy(desc(artifactsTable.created_at))
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));
  return rows.map(artifactFromRow);
}

export async function getArtifactForRun(
  organizationId: string,
  runId: string,
): Promise<StructuredArtifact | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select()
    .from(artifactsTable)
    .where(and(
      eq(artifactsTable.organization_id, scoped.organizationId),
      eq(artifactsTable.run_id, runId),
    ))
    .orderBy(desc(artifactsTable.created_at))
    .limit(1);
  return row ? artifactFromRow(row) : null;
}

export async function createAttentionItem(input: {
  organizationId: string;
  eventId?: string;
  artifactId?: string;
  priority?: AttentionItem['priority'];
  category?: AttentionItem['category'];
  policyVersion?: number;
  groupKey?: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  suggestedAction: AttentionSuggestedAction;
  assignedUserId?: string;
  expiresAt?: string;
}): Promise<AttentionItem> {
  const scoped = dbFor(input.organizationId);
  const id = randomUUID();
  const suggestedAction = {
    ...input.suggestedAction,
    prompt: input.suggestedAction.prompt.replaceAll('{{attentionItemId}}', id),
  };
  const inserted = await scoped.db
    .insert(attentionItemsTable)
    .values({
      id,
      organization_id: scoped.organizationId,
      event_id: input.eventId ?? null,
      artifact_id: input.artifactId ?? null,
      priority: input.priority ?? 'normal',
      category: input.category ?? 'general',
      policy_version: input.policyVersion ?? 1,
      group_key: input.groupKey ?? null,
      title: input.title,
      message: input.message,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      suggested_action: suggestedAction,
      assigned_user_id: input.assignedUserId ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return attentionFromRow(inserted[0]);
  if (!input.eventId) throw new Error('The attention item could not be created.');
  const [existing] = await scoped.db
    .select()
    .from(attentionItemsTable)
    .where(and(
      eq(attentionItemsTable.organization_id, scoped.organizationId),
      eq(attentionItemsTable.event_id, input.eventId),
    ))
    .limit(1);
  if (!existing) throw new Error('The attention item could not be resolved.');
  return attentionFromRow(existing);
}

export async function getAttentionItemForEvent(
  organizationId: string,
  eventId: string,
): Promise<AttentionItem | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select()
    .from(attentionItemsTable)
    .where(and(
      eq(attentionItemsTable.organization_id, scoped.organizationId),
      eq(attentionItemsTable.event_id, eventId),
    ))
    .limit(1);
  return row ? attentionFromRow(row) : null;
}

export async function hasProductEventProjection(input: {
  organizationId: string;
  eventId: string;
  projector: string;
  policyVersion: number;
}): Promise<boolean> {
  const scoped = dbFor(input.organizationId);
  const [row] = await scoped.db
    .select({ eventId: productEventProjectionsTable.event_id })
    .from(productEventProjectionsTable)
    .where(and(
      eq(productEventProjectionsTable.organization_id, scoped.organizationId),
      eq(productEventProjectionsTable.event_id, input.eventId),
      eq(productEventProjectionsTable.projector, input.projector),
      eq(productEventProjectionsTable.policy_version, input.policyVersion),
    ))
    .limit(1);
  return Boolean(row);
}

export async function recordProductEventProjection(input: {
  organizationId: string;
  eventId: string;
  projector: string;
  policyVersion: number;
  outcome: 'notified' | 'suppressed';
}): Promise<void> {
  const scoped = dbFor(input.organizationId);
  await scoped.db
    .insert(productEventProjectionsTable)
    .values({
      organization_id: scoped.organizationId,
      event_id: input.eventId,
      projector: input.projector,
      policy_version: input.policyVersion,
      outcome: input.outcome,
    })
    .onConflictDoNothing();
}

async function workspaceMemberIds(organizationId: string): Promise<string[]> {
  const scoped = dbFor(organizationId);
  const rows = await scoped.db
    .select({ userId: workspaceMemberIdsView.user_id })
    .from(workspaceMemberIdsView)
    .where(eq(workspaceMemberIdsView.organization_id, scoped.organizationId));
  return rows.map((row) => row.userId);
}

export async function getNotificationPreferences(
  organizationId: string,
  userId: string,
  categories: readonly NotificationCategory[],
  channel = 'in_app',
): Promise<NotificationPreference[]> {
  const scoped = dbFor(organizationId);
  const requested = ['*', ...categories];
  const rows = await scoped.db
    .select({
      category: notificationPreferencesTable.category,
      enabled: notificationPreferencesTable.enabled,
    })
    .from(notificationPreferencesTable)
    .where(and(
      eq(notificationPreferencesTable.organization_id, scoped.organizationId),
      eq(notificationPreferencesTable.user_id, userId),
      eq(notificationPreferencesTable.channel, channel),
      inArray(notificationPreferencesTable.category, requested),
    ));
  const overrides = new Map(rows.map((row) => [row.category, row.enabled]));
  return [
    { category: '*', channel, enabled: overrides.get('*') ?? true },
    ...categories.map((category) => ({
      category,
      channel,
      enabled: overrides.get(category) ?? true,
    })),
  ];
}

export async function setNotificationPreferences(input: {
  organizationId: string;
  userId: string;
  channel?: string;
  preferences: Array<{ category: NotificationCategory | '*'; enabled: boolean }>;
}): Promise<NotificationPreference[]> {
  const scoped = dbFor(input.organizationId);
  const channel = input.channel ?? 'in_app';
  if (input.preferences.length > 0) {
    const now = new Date().toISOString();
    await scoped.db
      .insert(notificationPreferencesTable)
      .values(input.preferences.map((preference) => ({
        organization_id: scoped.organizationId,
        user_id: input.userId,
        category: preference.category,
        channel,
        enabled: preference.enabled,
        updated_at: now,
      })))
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.organization_id,
          notificationPreferencesTable.user_id,
          notificationPreferencesTable.category,
          notificationPreferencesTable.channel,
        ],
        set: {
          enabled: sql`excluded.enabled`,
          updated_at: sql`excluded.updated_at`,
        },
      });
  }
  const categories = input.preferences
    .map((preference) => preference.category)
    .filter((category): category is NotificationCategory => category !== '*');
  return getNotificationPreferences(scoped.organizationId, input.userId, categories, channel);
}

export async function eligibleNotificationUserIds(
  organizationId: string,
  category: NotificationCategory,
): Promise<string[]> {
  const userIds = await workspaceMemberIds(organizationId);
  const decisions = await Promise.all(userIds.map(async (userId) => {
    const preferences = await getNotificationPreferences(organizationId, userId, [category]);
    const masterEnabled = preferences.find((preference) => preference.category === '*')?.enabled ?? true;
    const categoryEnabled = preferences.find((preference) => preference.category === category)?.enabled ?? true;
    return masterEnabled && categoryEnabled
      ? userId
      : null;
  }));
  return decisions.filter((userId): userId is string => Boolean(userId));
}

export async function createNotificationRecipients(input: {
  organizationId: string;
  attentionItemId: string;
  userIds: string[];
}): Promise<number> {
  const scoped = dbFor(input.organizationId);
  if (input.userIds.length === 0) return 0;
  const rows = await scoped.db
    .insert(notificationRecipientsTable)
    .values(input.userIds.map((userId) => ({
      organization_id: scoped.organizationId,
      attention_item_id: input.attentionItemId,
      user_id: userId,
    })))
    .onConflictDoNothing()
    .returning({ id: notificationRecipientsTable.id });
  return rows.length;
}

function inboxItemFromRows(
  item: typeof attentionItemsTable.$inferSelect,
  recipient: typeof notificationRecipientsTable.$inferSelect,
): NotificationInboxItem {
  return {
    ...attentionFromRow(item),
    recipientStatus: recipient.status as NotificationRecipientStatus,
    deliveredAt: recipient.delivered_at,
    seenAt: recipient.seen_at,
    actedAt: recipient.acted_at,
  };
}

export async function listUserNotifications(
  organizationId: string,
  userId: string,
  options: {
    statuses?: NotificationRecipientStatus[];
    limit?: number;
  } = {},
): Promise<NotificationInboxItem[]> {
  const scoped = dbFor(organizationId);
  const statuses = options.statuses ?? ['unread', 'seen'];
  const rows = await scoped.db
    .select({ item: attentionItemsTable, recipient: notificationRecipientsTable })
    .from(notificationRecipientsTable)
    .innerJoin(attentionItemsTable, and(
      eq(attentionItemsTable.organization_id, notificationRecipientsTable.organization_id),
      eq(attentionItemsTable.id, notificationRecipientsTable.attention_item_id),
    ))
    .where(and(
      eq(notificationRecipientsTable.organization_id, scoped.organizationId),
      eq(notificationRecipientsTable.user_id, userId),
      inArray(notificationRecipientsTable.status, statuses),
    ))
    .orderBy(desc(notificationRecipientsTable.created_at))
    .limit(Math.min(100, Math.max(1, options.limit ?? 20)));
  return rows.map((row) => inboxItemFromRows(row.item, row.recipient));
}

export async function getUserNotification(
  organizationId: string,
  userId: string,
  attentionItemId: string,
): Promise<NotificationInboxItem | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select({ item: attentionItemsTable, recipient: notificationRecipientsTable })
    .from(notificationRecipientsTable)
    .innerJoin(attentionItemsTable, and(
      eq(attentionItemsTable.organization_id, notificationRecipientsTable.organization_id),
      eq(attentionItemsTable.id, notificationRecipientsTable.attention_item_id),
    ))
    .where(and(
      eq(notificationRecipientsTable.organization_id, scoped.organizationId),
      eq(notificationRecipientsTable.user_id, userId),
      eq(notificationRecipientsTable.attention_item_id, attentionItemId),
    ))
    .limit(1);
  return row ? inboxItemFromRows(row.item, row.recipient) : null;
}

export async function setNotificationRecipientStatus(
  organizationId: string,
  userId: string,
  attentionItemId: string,
  status: NotificationRecipientStatus,
): Promise<NotificationInboxItem | null> {
  const scoped = dbFor(organizationId);
  const now = new Date().toISOString();
  await scoped.db
    .update(notificationRecipientsTable)
    .set({
      status,
      updated_at: now,
      delivered_at: now,
      seen_at: status === 'unread' ? null : now,
      acted_at: status === 'acted' ? now : null,
    })
    .where(and(
      eq(notificationRecipientsTable.organization_id, scoped.organizationId),
      eq(notificationRecipientsTable.user_id, userId),
      eq(notificationRecipientsTable.attention_item_id, attentionItemId),
    ));
  return getUserNotification(scoped.organizationId, userId, attentionItemId);
}

export async function listAttentionItemsSince(
  organizationId: string,
  options: { after?: string; limit?: number } = {},
): Promise<AttentionItem[]> {
  const scoped = dbFor(organizationId);
  const rows = await scoped.db
    .select({ item: attentionItemsTable })
    .from(attentionItemsTable)
    .innerJoin(productEventsTable, and(
      eq(productEventsTable.organization_id, attentionItemsTable.organization_id),
      eq(productEventsTable.id, attentionItemsTable.event_id),
    ))
    .where(and(
      eq(attentionItemsTable.organization_id, scoped.organizationId),
      eq(productEventsTable.origin, 'external_connector'),
      options.after ? gt(attentionItemsTable.created_at, options.after) : undefined,
    ))
    .orderBy(asc(attentionItemsTable.created_at))
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));
  return rows.map((row) => attentionFromRow(row.item));
}

export async function getAttentionItem(
  organizationId: string,
  attentionItemId: string,
): Promise<AttentionItem | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select()
    .from(attentionItemsTable)
    .where(and(
      eq(attentionItemsTable.organization_id, scoped.organizationId),
      eq(attentionItemsTable.id, attentionItemId),
    ))
    .limit(1);
  return row ? attentionFromRow(row) : null;
}

export async function listAttentionItems(
  organizationId: string,
  options: { statuses?: AttentionItem['status'][]; limit?: number } = {},
): Promise<AttentionItem[]> {
  const scoped = dbFor(organizationId);
  const statuses = options.statuses ?? ['open', 'seen'];
  const rows = await scoped.db
    .select()
    .from(attentionItemsTable)
    .where(and(
      eq(attentionItemsTable.organization_id, scoped.organizationId),
      inArray(attentionItemsTable.status, statuses),
    ))
    .orderBy(desc(attentionItemsTable.created_at))
    .limit(Math.min(100, Math.max(1, options.limit ?? 20)));
  return rows.map(attentionFromRow);
}

export async function setAttentionItemStatus(
  organizationId: string,
  attentionItemId: string,
  status: AttentionItem['status'],
): Promise<AttentionItem | null> {
  const scoped = dbFor(organizationId);
  const now = new Date().toISOString();
  const [row] = await scoped.db
    .update(attentionItemsTable)
    .set({
      status,
      updated_at: now,
      resolved_at: status === 'resolved' || status === 'dismissed' ? now : null,
    })
    .where(and(
      eq(attentionItemsTable.organization_id, scoped.organizationId),
      eq(attentionItemsTable.id, attentionItemId),
    ))
    .returning();
  return row ? attentionFromRow(row) : null;
}

export interface ArtifactOutcome {
  id: string;
  artifactId: string;
  deliveryId: string;
  status: string;
  channel: string | null;
  externalRef: string | null;
  metrics: Record<string, unknown>;
  payload: Record<string, unknown>;
  occurredAt: string;
  reportedAt: string;
}

function outcomeFromRow(row: typeof artifactOutcomesTable.$inferSelect): ArtifactOutcome {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    deliveryId: row.delivery_id,
    status: row.status,
    channel: row.channel,
    externalRef: row.external_ref,
    metrics: row.metrics as Record<string, unknown>,
    payload: row.payload as Record<string, unknown>,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
  };
}

export async function listArtifactOutcomes(
  organizationId: string,
  artifactId: string,
  options: { limit?: number } = {},
): Promise<ArtifactOutcome[]> {
  const scoped = dbFor(organizationId);
  const rows = await scoped.db
    .select()
    .from(artifactOutcomesTable)
    .where(and(
      eq(artifactOutcomesTable.organization_id, scoped.organizationId),
      eq(artifactOutcomesTable.artifact_id, artifactId),
    ))
    .orderBy(desc(artifactOutcomesTable.occurred_at))
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));
  return rows.map(outcomeFromRow);
}

export async function recordArtifactOutcome(input: {
  organizationId: string;
  artifactId: string;
  deliveryId: string;
  status: string;
  channel?: string;
  externalRef?: string;
  metrics?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  occurredAt: string;
}): Promise<{ outcome: ArtifactOutcome; created: boolean }> {
  const scoped = dbFor(input.organizationId);
  const inserted = await scoped.db
    .insert(artifactOutcomesTable)
    .values({
      organization_id: scoped.organizationId,
      artifact_id: input.artifactId,
      delivery_id: input.deliveryId,
      status: input.status,
      channel: input.channel ?? null,
      external_ref: input.externalRef ?? null,
      metrics: input.metrics ?? {},
      payload: input.payload ?? {},
      occurred_at: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted[0] ?? (await scoped.db
    .select()
    .from(artifactOutcomesTable)
    .where(and(
      eq(artifactOutcomesTable.organization_id, scoped.organizationId),
      eq(artifactOutcomesTable.delivery_id, input.deliveryId),
    ))
    .limit(1))[0];
  if (!row) throw new Error('The artifact outcome could not be recorded.');
  return {
    created: Boolean(inserted[0]),
    outcome: outcomeFromRow(row),
  };
}

export async function getOrCreateIntelligenceApiToken(
  organizationId: string,
): Promise<{ token: string }> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .insert(apiTokensTable)
    .values({ organization_id: scoped.organizationId })
    .onConflictDoUpdate({
      target: apiTokensTable.organization_id,
      set: { organization_id: scoped.organizationId },
    })
    .returning({ token: apiTokensTable.token });
  return row;
}

export async function rotateIntelligenceApiToken(
  organizationId: string,
): Promise<{ token: string }> {
  const scoped = dbFor(organizationId);
  const token = randomUUID();
  const [row] = await scoped.db
    .insert(apiTokensTable)
    .values({
      organization_id: scoped.organizationId,
      token,
      rotated_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: apiTokensTable.organization_id,
      set: { token, rotated_at: new Date().toISOString() },
    })
    .returning({ token: apiTokensTable.token });
  return row;
}

export async function getIntelligenceApiToken(
  organizationId: string,
): Promise<string | null> {
  const scoped = dbFor(organizationId);
  const [row] = await scoped.db
    .select({ token: apiTokensTable.token })
    .from(apiTokensTable)
    .where(eq(apiTokensTable.organization_id, scoped.organizationId))
    .limit(1);
  return row?.token ?? null;
}
