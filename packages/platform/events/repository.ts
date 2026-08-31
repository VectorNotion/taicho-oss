import {
  databaseFor,
  external_webhook_delivery as webhookDeliveriesTable,
  external_webhook_endpoint as webhookEndpointsTable,
  product_event_projections as productEventProjectionsTable,
  product_events as productEventsTable,
} from '@content-automation/database';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getJobAdminPool, getJobPool, validateJobOrganizationId } from '../jobs/pool';
import { ensureProductEventsTable } from './schema';

export interface ProductEventInsert {
  organizationId: string;
  name: string;
  eventVersion: number;
  contentId: string | null;
  prospectId: string | null;
  postId: string | null;
  sendId: string | null;
  source: string;
  origin: 'internal' | 'external_connector';
  connectorId: string | null;
  externalEventId: string | null;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
}

export type StoredProductEvent = ProductEventInsert & {
  id: string;
  occurredAt: string;
};

export type ProductEventProjectionOutcome = 'notified' | 'suppressed' | 'projected' | 'ignored';

export async function insertProductEvent(event: ProductEventInsert): Promise<{ id: string; created: boolean }> {
  await ensureProductEventsTable();
  const organizationId = validateJobOrganizationId(event.organizationId);
  return databaseFor(getJobPool(organizationId)).transaction(async (transaction) => {
    if (event.origin === 'external_connector' && (!event.connectorId || !event.externalEventId)) {
      throw new Error('External connector events require connectorId and externalEventId.');
    }
    const [created] = await transaction
      .insert(productEventsTable)
      .values({
        organization_id: organizationId,
        name: event.name,
        event_version: event.eventVersion,
        content_id: event.contentId,
        prospect_id: event.prospectId,
        post_id: event.postId,
        send_id: event.sendId,
        source: event.source,
        origin: event.origin,
        connector_id: event.connectorId,
        external_event_id: event.externalEventId,
        idempotency_key: event.idempotencyKey,
        payload: event.payload,
      })
      .onConflictDoNothing()
      .returning({ id: productEventsTable.id, occurredAt: productEventsTable.occurred_at });
    if (!created) {
      if (event.origin === 'external_connector' && event.connectorId && event.externalEventId) {
        const [existing] = await transaction
          .select({ id: productEventsTable.id })
          .from(productEventsTable)
          .where(and(
            eq(productEventsTable.organization_id, organizationId),
            eq(productEventsTable.connector_id, event.connectorId),
            eq(productEventsTable.external_event_id, event.externalEventId),
            eq(productEventsTable.name, event.name),
          ))
          .limit(1);
        if (existing) return { id: existing.id, created: false };
      }
      if (event.idempotencyKey) {
        const [existing] = await transaction
          .select({ id: productEventsTable.id })
          .from(productEventsTable)
          .where(and(
            eq(productEventsTable.organization_id, organizationId),
            eq(productEventsTable.name, event.name),
            eq(productEventsTable.idempotency_key, event.idempotencyKey),
          ))
          .limit(1);
        if (existing) return { id: existing.id, created: false };
      }
      throw new Error('The product event could not be recorded.');
    }
    // Projection events may contain restricted workspace data. They are
    // durable internal outbox records, never customer webhooks. Calendar
    // provider sync consumes the ledger through its own bounded projector.
    const internalProjectionEvent = event.name.startsWith('knowledge.') || event.name.startsWith('calendar.');
    const endpoints = internalProjectionEvent ? [] : await transaction.select({ id: webhookEndpointsTable.id })
      .from(webhookEndpointsTable)
      .where(and(
        eq(webhookEndpointsTable.organization_id, organizationId),
        eq(webhookEndpointsTable.enabled, true),
        sql`(${event.name} = ANY(${webhookEndpointsTable.event_types}) OR '*' = ANY(${webhookEndpointsTable.event_types}))`,
      ));
    if (endpoints.length > 0) {
      const payload = {
        id: created.id,
        event: event.name,
        apiVersion: '2026-08-01',
        createdAt: created.occurredAt,
        data: event.payload,
      };
      await transaction.insert(webhookDeliveriesTable).values(endpoints.map((endpoint) => ({
        organization_id: organizationId,
        endpoint_id: endpoint.id,
        event_id: created.id,
        event_type: event.name,
        payload,
      }))).onConflictDoNothing();
    }
    return { id: created.id, created: true };
  });
}

function storedEvent(row: typeof productEventsTable.$inferSelect): StoredProductEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    eventVersion: row.event_version,
    occurredAt: row.occurred_at,
    contentId: row.content_id,
    prospectId: row.prospect_id,
    postId: row.post_id,
    sendId: row.send_id,
    source: row.source,
    origin: row.origin as ProductEventInsert['origin'],
    connectorId: row.connector_id,
    externalEventId: row.external_event_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload as Record<string, unknown>,
  };
}

/** Tenant-scoped payload read after the control-plane has discovered an ID. */
export interface ProductEventCursor { occurredAt: string; id: string }

/**
 * Durable cross-tenant walk of the ledger for the automations fan-out sweep
 * (packages/flow/events/fanout.ts). Admin pool by design: the sweep discovers
 * work across organizations, then every enqueue runs through org-scoped
 * paths. `settleSeconds` keeps the sweep away from rows whose same-timestamp
 * neighbours may still be committing; tests pass 0.
 */
export async function listProductEventsAfter(
  cursor: ProductEventCursor | null,
  limit = 200,
  settleSeconds = 5,
): Promise<StoredProductEvent[]> {
  await ensureProductEventsTable();
  const params: unknown[] = [Math.max(0, settleSeconds)];
  let where = `occurred_at < NOW() - make_interval(secs => $1)`;
  if (cursor) {
    params.push(cursor.occurredAt, cursor.id);
    where += ` AND (occurred_at, id) > ($2::timestamptz, $3::uuid)`;
  }
  params.push(Math.max(1, Math.min(limit, 500)));
  const result = await getJobAdminPool().query(
    // occurred_at is rendered with microsecond precision rather than mapped
    // through a JS Date: Date only carries milliseconds, and a truncated cursor
    // re-delivers the row it was taken from on the next pass.
    `SELECT id, organization_id, name, event_version,
            to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
            content_id, prospect_id, post_id, send_id, source, origin,
            connector_id, external_event_id, idempotency_key, payload
     FROM product_events
     WHERE ${where}
     ORDER BY occurred_at, id
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    eventVersion: Number(row.event_version ?? 1),
    occurredAt: String(row.occurred_at),
    contentId: row.content_id ?? null,
    prospectId: row.prospect_id ?? null,
    postId: row.post_id ?? null,
    sendId: row.send_id ?? null,
    source: String(row.source ?? 'product'),
    origin: (row.origin ?? 'internal') as ProductEventInsert['origin'],
    connectorId: row.connector_id ?? null,
    externalEventId: row.external_event_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}

export async function getProductEvent(organizationId: string, eventId: string): Promise<StoredProductEvent | null> {
  const scoped = validateJobOrganizationId(organizationId);
  const [row] = await databaseFor(getJobPool(scoped))
    .select()
    .from(productEventsTable)
    .where(and(eq(productEventsTable.organization_id, scoped), eq(productEventsTable.id, eventId)))
    .limit(1);
  return row ? storedEvent(row) : null;
}

/**
 * Control-plane discovery returns IDs and tenant IDs only. Event payloads are
 * loaded later through the tenant-scoped pool, preserving the RLS boundary.
 */
export async function listUnprojectedProductEventRefs(input: {
  projector: string;
  policyVersion: number;
  eventNames: readonly string[];
  limit?: number;
}): Promise<Array<{ id: string; organizationId: string }>> {
  if (input.eventNames.length === 0) return [];
  const rows = await databaseFor(getJobAdminPool())
    .select({ id: productEventsTable.id, organizationId: productEventsTable.organization_id })
    .from(productEventsTable)
    .leftJoin(productEventProjectionsTable, and(
      eq(productEventProjectionsTable.organization_id, productEventsTable.organization_id),
      eq(productEventProjectionsTable.event_id, productEventsTable.id),
      eq(productEventProjectionsTable.projector, input.projector),
      eq(productEventProjectionsTable.policy_version, input.policyVersion),
    ))
    .where(and(
      inArray(productEventsTable.name, [...input.eventNames]),
      isNull(productEventProjectionsTable.event_id),
    ))
    .orderBy(asc(productEventsTable.occurred_at), asc(productEventsTable.id))
    .limit(Math.max(1, Math.min(input.limit ?? 25, 250)));
  return rows.map((row) => ({ id: row.id, organizationId: validateJobOrganizationId(row.organizationId) }));
}

export async function hasProductEventProjection(input: {
  organizationId: string;
  eventId: string;
  projector: string;
  policyVersion: number;
}): Promise<boolean> {
  const scoped = validateJobOrganizationId(input.organizationId);
  const [row] = await databaseFor(getJobPool(scoped))
    .select({ eventId: productEventProjectionsTable.event_id })
    .from(productEventProjectionsTable)
    .where(and(
      eq(productEventProjectionsTable.organization_id, scoped),
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
  outcome: ProductEventProjectionOutcome;
}): Promise<void> {
  const scoped = validateJobOrganizationId(input.organizationId);
  await databaseFor(getJobPool(scoped))
    .insert(productEventProjectionsTable)
    .values({
      organization_id: scoped,
      event_id: input.eventId,
      projector: input.projector,
      policy_version: input.policyVersion,
      outcome: input.outcome,
    })
    .onConflictDoNothing();
}
