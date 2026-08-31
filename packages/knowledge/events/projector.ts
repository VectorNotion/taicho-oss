import {
  getProductEvent,
  listUnprojectedProductEventRefs,
  recordProductEventProjection,
  type StoredProductEvent,
} from '@content-automation/platform/events/repository';

export const KNOWLEDGE_EVENT_PROJECTOR = 'shared_knowledge';
export const KNOWLEDGE_EVENT_POLICY_VERSION = 1;

export type KnowledgeEventProjectionResult = 'projected' | 'ignored';
export type KnowledgeEventAdapter = (
  event: StoredProductEvent,
) => Promise<KnowledgeEventProjectionResult | void>;

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeEventAdapters: Map<string, KnowledgeEventAdapter> | undefined;
}

function adapters(): Map<string, KnowledgeEventAdapter> {
  return (globalThis.__knowledgeEventAdapters ??= new Map());
}

/** Registration is static at process startup; duplicate ownership is an error. */
export function registerKnowledgeEventAdapter(eventName: string, adapter: KnowledgeEventAdapter): void {
  const name = eventName.trim();
  if (!name.startsWith('knowledge.')) throw new Error(`Knowledge event adapters require a knowledge.* event name: ${name}`);
  const existing = adapters().get(name);
  if (existing && existing !== adapter) throw new Error(`Knowledge event adapter collision: ${name}`);
  adapters().set(name, adapter);
}

export function registeredKnowledgeEventNames(): string[] {
  return [...adapters().keys()].sort();
}

/** Test-only reset; application code must register once at startup. */
export function clearKnowledgeEventAdapters(): void {
  adapters().clear();
}

export async function projectKnowledgeEvent(
  organizationId: string,
  eventId: string,
): Promise<KnowledgeEventProjectionResult> {
  const event = await getProductEvent(organizationId, eventId);
  if (!event) throw new Error(`Product event ${eventId} was not found in organization ${organizationId}.`);
  const adapter = adapters().get(event.name);
  const outcome = adapter ? (await adapter(event) ?? 'projected') : 'ignored';
  await recordProductEventProjection({
    organizationId,
    eventId,
    projector: KNOWLEDGE_EVENT_PROJECTOR,
    policyVersion: KNOWLEDGE_EVENT_POLICY_VERSION,
    outcome,
  });
  return outcome;
}

/**
 * Claims durable events oldest-first. A failed adapter receives no receipt and
 * is retried on a later worker pass; one failure does not block unrelated
 * tenant events in the same batch.
 */
export async function projectPendingKnowledgeEvents(limit = 25): Promise<{
  attempted: number;
  projected: number;
  ignored: number;
  failed: number;
}> {
  const eventNames = registeredKnowledgeEventNames();
  if (eventNames.length === 0) return { attempted: 0, projected: 0, ignored: 0, failed: 0 };
  const refs = await listUnprojectedProductEventRefs({
    projector: KNOWLEDGE_EVENT_PROJECTOR,
    policyVersion: KNOWLEDGE_EVENT_POLICY_VERSION,
    eventNames,
    limit,
  });
  let projected = 0;
  let ignored = 0;
  let failed = 0;
  for (const ref of refs) {
    try {
      const outcome = await projectKnowledgeEvent(ref.organizationId, ref.id);
      if (outcome === 'projected') projected += 1;
      else ignored += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: refs.length, projected, ignored, failed };
}
