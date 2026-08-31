import {
  hasProductEventProjection,
  recordProductEventProjection,
  type ProductEventInsert,
} from '../events/repository';
import {
  type AttentionItem,
  type NotificationCategory,
} from './contracts';
import {
  createAttentionItem,
  createNotificationRecipients,
  eligibleNotificationUserIds,
  getAttentionItemForEvent,
} from './repository';

export type StoredProductEvent = ProductEventInsert & { id: string };

type AttentionProjection = Omit<
  Parameters<typeof createAttentionItem>[0],
  'organizationId' | 'eventId' | 'category'
> & { category: NotificationCategory };

const PROJECTOR = 'assistant_notifications';
const POLICY_VERSION = 1;

function label(event: StoredProductEvent, key: string, fallback: string): string {
  const value = event.payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Pure event policy. Only events requiring a human decision become attention
 * items; routine telemetry remains in the event ledger.
 */
export function attentionProjectionForEvent(
  event: StoredProductEvent,
): AttentionProjection | null {
  if (event.origin !== 'external_connector') return null;

  if (event.name === 'prospect.created' && event.prospectId) {
    const name = label(event, 'name', 'A new prospect');
    const company = label(event, 'company', '');
    const subject = company ? `${name} at ${company}` : name;
    return {
      priority: 'normal',
      category: 'prospects',
      policyVersion: POLICY_VERSION,
      groupKey: event.connectorId
        ? `${event.connectorId}:prospect.created`
        : undefined,
      title: 'New prospect ready for research',
      message: `${subject} was added through ${event.connectorId ?? 'an external connector'}. Do you want to research and qualify this prospect?`,
      entityType: 'prospect',
      entityId: event.prospectId,
      suggestedAction: {
        workflow: 'prospect_intelligence',
        label: 'Research and qualify',
        input: { prospectId: event.prospectId },
        prompt: `Research and qualify ${subject} (prospect ID: ${event.prospectId}). Use attention item {{attentionItemId}} and show me the resulting prospect dossier.`,
      },
    };
  }

  if (event.name === 'prospect.qualified' && event.prospectId) {
    const score = typeof event.payload.score === 'number'
      ? ` scored ${event.payload.score}/100`
      : ' has been qualified';
    return {
      priority: typeof event.payload.score === 'number' && event.payload.score >= 80
        ? 'high'
        : 'normal',
      category: 'prospects',
      policyVersion: POLICY_VERSION,
      title: 'Qualified prospect needs a next action',
      message: `The prospect${score}. Decide whether to create an outreach artifact or keep researching.`,
      entityType: 'prospect',
      entityId: event.prospectId,
      suggestedAction: {
        workflow: 'outreach_intelligence',
        label: 'Prepare outreach',
        input: { prospectId: event.prospectId, medium: 'email' },
        prompt: `Review qualified prospect ${event.prospectId} and prepare a grounded outreach artifact. Use attention item {{attentionItemId}}.`,
      },
    };
  }

  if (event.name === 'content.angle.emerged') {
    const title = label(event, 'title', 'A new content angle');
    const summary = label(event, 'summary', 'An external source produced a new angle worth reviewing.');
    const contentId = event.contentId ?? label(event, 'contentId', 'external-angle');
    return {
      priority: typeof event.payload.confidence === 'number' && event.payload.confidence >= 0.8
        ? 'high'
        : 'normal',
      category: 'content_insights',
      policyVersion: POLICY_VERSION,
      groupKey: event.connectorId
        ? `${event.connectorId}:content.angle.emerged`
        : undefined,
      title: 'New content angle emerged',
      message: `${title}: ${summary} Do you want to develop it?`,
      entityType: 'content_angle',
      entityId: contentId,
      suggestedAction: {
        workflow: 'content_intelligence',
        label: 'Develop this angle',
        input: { operation: 'generate_ideas', count: 3 },
        prompt: `Review the external content angle “${title}” (reference: ${contentId}). Use attention item {{attentionItemId}}, ground the discussion in the supplied context, and help me develop the strongest direction.`,
      },
    };
  }

  if (event.name === 'intelligence.artifact.ready') {
    const workflow = label(event, 'workflow', 'external workflow');
    const artifactId = label(event, 'artifactId', 'external-artifact');
    return {
      priority: 'normal',
      category: 'workflow_results',
      policyVersion: POLICY_VERSION,
      title: 'External intelligence work is ready',
      message: 'An intelligence workflow started by an external connector produced a new artifact. Do you want to review it?',
      entityType: 'intelligence_artifact',
      entityId: artifactId,
      suggestedAction: {
        workflow: 'feedback_intelligence',
        label: 'Review the artifact',
        input: {
          entityType: 'intelligence_artifact',
          entityId: artifactId,
          outcomes: [event.payload],
        },
        prompt: `Review intelligence artifact ${artifactId} from ${workflow}. Use attention item {{attentionItemId}} and explain the result and recommended next actions.`,
      },
    };
  }

  if (event.name === 'intelligence.artifact.outcome.reported') {
    const artifactId = label(event, 'artifactId', 'external-artifact');
    const status = label(event, 'status', 'updated');
    return {
      priority: status === 'failed' ? 'high' : 'normal',
      category: 'external_outcomes',
      policyVersion: POLICY_VERSION,
      title: 'An external outcome was reported',
      message: `Artifact ${artifactId} was reported as ${status}. Do you want to review what changed?`,
      entityType: 'intelligence_artifact',
      entityId: artifactId,
      suggestedAction: {
        workflow: 'feedback_intelligence',
        label: 'Review the outcome',
        input: { entityType: 'intelligence_artifact', entityId: artifactId, outcomes: [event.payload] },
        prompt: `Review the externally reported ${status} outcome for artifact ${artifactId}. Use attention item {{attentionItemId}} and recommend the next step.`,
      },
    };
  }

  return null;
}

export async function projectProductEventToAttention(
  event: StoredProductEvent,
): Promise<AttentionItem | null> {
  // Internal product activity is deliberately silent and does not need a
  // projection receipt. This keeps routine UI and telemetry traffic from
  // adding a second write to the notification subsystem.
  if (event.origin !== 'external_connector') return null;
  if (await hasProductEventProjection({
    organizationId: event.organizationId,
    eventId: event.id,
    projector: PROJECTOR,
    policyVersion: POLICY_VERSION,
  })) {
    return getAttentionItemForEvent(event.organizationId, event.id);
  }
  const projection = attentionProjectionForEvent(event);
  if (!projection) {
    await recordProductEventProjection({
      organizationId: event.organizationId,
      eventId: event.id,
      projector: PROJECTOR,
      policyVersion: POLICY_VERSION,
      outcome: 'suppressed',
    });
    return null;
  }
  const userIds = await eligibleNotificationUserIds(event.organizationId, projection.category);
  if (userIds.length === 0) {
    await recordProductEventProjection({
      organizationId: event.organizationId,
      eventId: event.id,
      projector: PROJECTOR,
      policyVersion: POLICY_VERSION,
      outcome: 'suppressed',
    });
    return null;
  }
  const created = await createAttentionItem({
    organizationId: event.organizationId,
    eventId: event.id,
    ...projection,
  });
  await createNotificationRecipients({
    organizationId: event.organizationId,
    attentionItemId: created.id,
    userIds,
  });
  await recordProductEventProjection({
    organizationId: event.organizationId,
    eventId: event.id,
    projector: PROJECTOR,
    policyVersion: POLICY_VERSION,
    outcome: 'notified',
  });
  return created;
}
