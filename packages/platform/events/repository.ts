import {
  databaseFor,
  external_webhook_delivery as webhookDeliveriesTable,
  external_webhook_endpoint as webhookEndpointsTable,
  product_events as productEventsTable,
} from '@content-automation/database';
import { and, eq, sql } from 'drizzle-orm';
import { getJobPool, validateJobOrganizationId } from '../jobs/pool';
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
  payload: Record<string, unknown>;
}

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
      throw new Error('The product event could not be recorded.');
    }
    const endpoints = await transaction.select({ id: webhookEndpointsTable.id })
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
