/**
 * The event spine's single emit helper (roadmap spec §2, §6-7).
 *
 * `emitProductEvent` remains the non-blocking telemetry helper. External
 * connector boundaries use `recordProductEvent` so the append-only event and
 * its deterministic notification projection are durable before acknowledging
 * the connector.
 *
 * Every failure is caught and logged. Emitters never break the hot path.
 */
import { createLogger, currentExecutionContext } from '@content-automation/observability';
import { currentGraphOrganizationId } from '../data/organization-context';
import { projectProductEventToAttention } from '../intelligence/event-policy';
import { insertProductEvent, type ProductEventInsert } from './repository';

const log = createLogger('platform.events.emit');

/**
 * Frozen v1 product-event vocabulary. Additive changes keep downstream
 * analytics consumers compatible.
 */
export const PRODUCT_EVENT_NAMES = [
  'prospect.created', 'prospect.researched', 'prospect.qualified',
  'prospect.meeting.scheduled', 'prospect.transcript.updated', 'prospect.insights.updated',
  'outreach.generated', 'outreach.sent', 'prospect.replied',
  'draft.ready', 'post.scheduled', 'post.published', 'post.failed',
  'content.angle.emerged',
  // Feedback spine: emitted by recordMetricSnapshot
  // (packages/platform/metrics/snapshots.ts) after every snapshot.
  'post.metrics.updated',
  // Channel-neutral intelligence outputs and outcomes. Delivery remains
  // outside the platform; external orchestrators report what happened here.
  'intelligence.artifact.ready', 'intelligence.artifact.outcome.reported',
] as const;

export type ProductEventRefs = {
  contentId?: string;
  prospectId?: string;
  postId?: string;
  sendId?: string;
  draftId?: string;
  funnelId?: string;
};

export type ProductEventInput = {
  organizationId: string;
  name: string;
  eventVersion?: number;
  origin?: 'internal' | 'external_connector';
  connectorId?: string;
  externalEventId?: string;
  payload?: Record<string, unknown>;
  refs?: ProductEventRefs;
};

declare global {
  // eslint-disable-next-line no-var
  var __platformEventSink: ((event: ProductEventInsert) => Promise<{ id: string }>) | null | undefined;
  // eslint-disable-next-line no-var
  var __platformEventInFlight: Set<Promise<void>> | undefined;
}

/** Replace the Postgres insert in unit tests. Pass null to restore. */
export function setProductEventSinkForTests(
  sink: ((event: ProductEventInsert) => Promise<{ id: string }>) | null,
): void {
  globalThis.__platformEventSink = sink;
}

/** Await every in-flight detached emit (tests only). */
export async function drainProductEvents(): Promise<void> {
  const inFlight = globalThis.__platformEventInFlight;
  if (!inFlight || inFlight.size === 0) return;
  await Promise.all([...inFlight]);
}

export function emitProductEvent(input: ProductEventInput): void {
  const task = recordProductEvent(input).then(() => undefined).catch((error) => {
    log.error('product_event.emit_failed', error, {
      event_name: input.name,
      organization_id: input.organizationId,
    });
  });
  const inFlight = (globalThis.__platformEventInFlight ??= new Set());
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
}

/** Durable event recording for signed connectors and other acknowledged boundaries. */
export function recordProductEvent(
  input: ProductEventInput,
): Promise<{ id: string; created: boolean }> {
  return deliver(input);
}

/**
 * Emit from ambient organization context. Authenticated routes and workers
 * establish it. Skips with a warning when no
 * organization is resolvable — an emitter must never throw.
 */
export function emitProductEventFromContext(
  input: Omit<ProductEventInput, 'organizationId'> & { organizationId?: string },
): void {
  const organizationId = resolveOrganizationId(input.organizationId);
  if (!organizationId) {
    log.warn('product_event.skipped_no_organization', { event_name: input.name });
    return;
  }
  emitProductEvent({ ...input, organizationId });
}

/** Awaited counterpart to `emitProductEventFromContext`. */
export function recordProductEventFromContext(
  input: Omit<ProductEventInput, 'organizationId'> & { organizationId?: string },
): Promise<{ id: string; created: boolean }> {
  const organizationId = resolveOrganizationId(input.organizationId);
  if (!organizationId) {
    throw new Error(`Organization context is required to record ${input.name}.`);
  }
  return recordProductEvent({ ...input, organizationId });
}

function resolveOrganizationId(explicit?: string): string | undefined {
  return explicit
    ?? currentExecutionContext()?.organizationId
    ?? currentGraphOrganizationId()
    ?? undefined;
}

async function deliver(input: ProductEventInput): Promise<{ id: string; created: boolean }> {
  if (!(PRODUCT_EVENT_NAMES as readonly string[]).includes(input.name)) {
    log.warn('product_event.unregistered_name', { event_name: input.name });
  }
  const refs = input.refs ?? {};
  const payload: Record<string, unknown> = { ...(input.payload ?? {}) };
  for (const [key, value] of Object.entries(refs)) {
    if (value !== undefined) payload[key] = value;
  }
  const execution = currentExecutionContext();
  const origin = input.origin ?? execution?.eventOrigin ?? 'internal';
  const connectorId = input.connectorId ?? execution?.connectorId ?? null;
  const externalEventId = input.externalEventId ?? execution?.externalEventId ?? null;
  const record: ProductEventInsert = {
    organizationId: input.organizationId,
    name: input.name,
    eventVersion: input.eventVersion ?? 1,
    contentId: refs.contentId ?? null,
    prospectId: refs.prospectId ?? null,
    postId: refs.postId ?? null,
    sendId: refs.sendId ?? null,
    source: 'product',
    origin,
    connectorId,
    externalEventId,
    payload,
  };
  const customSink = globalThis.__platformEventSink;
  const insert = customSink ?? insertProductEvent;
  const stored = await insert(record);
  // Unit tests replace the event sink and test projection independently. In
  // production, every stored event passes through the deterministic attention
  // policy; events with no human decision simply return null.
  if (!customSink) {
    await projectProductEventToAttention({ ...record, id: stored.id });
  }
  return {
    id: stored.id,
    created: customSink ? true : (stored as { id: string; created: boolean }).created,
  };
}
