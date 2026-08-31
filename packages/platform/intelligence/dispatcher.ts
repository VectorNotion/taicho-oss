import { actionHandlers } from '../agents/registry';
import { recordProductEvent } from '../events/emit';
import { runWithGraphOrganization } from '../data/organization-context';
import {
  getProspectById,
  getLegacyQualification,
  getProspectResearch,
} from '@/products/outreach/data/prospect-repository';
import { getOutreachKnowledgeLineage } from '@/products/outreach/knowledge-service';
import type { LegacyQualification } from '@/products/outreach/domain/types';
import type {
  ArtifactDraft,
  CanonicalIntelligenceWorkflow,
  IntelligenceRun,
  StructuredArtifact,
  WorkflowTrigger,
} from './contracts';
import {
  INTELLIGENCE_WORKFLOW_DEFINITIONS,
  parseWorkflowInput,
} from './contracts';
import {
  commitIntelligenceArtifact,
  createIntelligenceRun,
  failIntelligenceRun,
  getArtifactForRun,
  getIntelligenceRun,
  setNotificationRecipientStatus,
  setAttentionItemStatus,
} from './repository';

export interface WorkflowExecutionContext {
  organizationId: string;
  actorType: 'user' | 'service' | 'system';
  initiatingUserId?: string;
  trigger: WorkflowTrigger;
  idempotencyKey: string;
  attentionItemId?: string;
}

export interface WorkflowExecutionResult {
  run: IntelligenceRun;
  artifact: StructuredArtifact;
  replayed: boolean;
}

export class IntelligenceWorkflowUnavailableError extends Error {
  constructor(readonly workflow: CanonicalIntelligenceWorkflow) {
    super(`${INTELLIGENCE_WORKFLOW_DEFINITIONS[workflow].name} is defined but not executable yet.`);
    this.name = 'IntelligenceWorkflowUnavailableError';
  }
}

export class IntelligenceWorkflowConflictError extends Error {
  constructor(readonly run: IntelligenceRun) {
    super(`Intelligence run ${run.id} is already ${run.status}.`);
    this.name = 'IntelligenceWorkflowConflictError';
  }
}

export interface WorkflowHandlerContext {
  organizationId: string;
  runId: string;
  actorType: WorkflowExecutionContext['actorType'];
  initiatingUserId?: string;
}

export type WorkflowHandler = (
  input: Record<string, unknown>,
  context: WorkflowHandlerContext,
) => Promise<ArtifactDraft>;

function qualificationSummary(
  name: string,
  qualification: LegacyQualification | null,
): string {
  if (!qualification) {
    return `${name} was researched. Qualification was skipped because no active persona produced a score.`;
  }
  return `${name} scored ${qualification.score}/100 against ${qualification.matchedPersonaName}.`;
}

/** First complete vertical slice: research -> qualification -> prospect dossier. */
export const runProspectIntelligence: WorkflowHandler = async (input, context) => {
  const prospectId = input.prospectId as string;
  const before = await getProspectById(prospectId);
  if (!before) throw new Error(`Prospect not found: ${prospectId}`);

  await actionHandlers.research_prospect({ prospectId }, context.runId);
  const [prospect, research, qualification] = await Promise.all([
    getProspectById(prospectId),
    getProspectResearch(prospectId),
    getLegacyQualification(prospectId),
  ]);
  if (!prospect || !research) {
    throw new Error(`Prospect intelligence did not produce a dossier for ${prospectId}.`);
  }
  const knowledge = await getOutreachKnowledgeLineage(prospect);

  return {
    workflow: 'prospect_intelligence',
    kind: 'prospect_dossier',
    title: `Prospect dossier · ${prospect.name}`,
    summary: qualificationSummary(prospect.name, qualification),
    content: {
      prospect: {
        id: prospect.id,
        name: prospect.name,
        company: prospect.company ?? null,
        title: prospect.title ?? null,
        location: prospect.location ?? null,
        email: prospect.email ?? null,
        status: prospect.status,
        priority: prospect.priority,
        tags: prospect.tags,
      },
      research,
      qualification,
    },
    sourceRefs: [
      { type: 'prospect', id: prospect.id, label: prospect.name },
      ...knowledge.sourceRefs,
    ],
    usedClaimIds: knowledge.usedClaimIds,
    usedEvidenceIds: knowledge.usedEvidenceIds,
    recommendations: [{
      action: 'outreach_intelligence',
      label: 'Create an outreach artifact',
      reason: qualification
        ? `Use the ${qualification.matchedPersonaName} fit and research evidence to personalize the message.`
        : 'Use the completed research to prepare a human-reviewed message.',
      input: { prospectId: prospect.id, medium: 'email' },
    }],
    provenance: {
      workflowVersion: '1.0',
      capabilities: ['research_prospect', 'qualify_prospect'],
      generatedAt: new Date().toISOString(),
    },
  };
};

/** Grounded outreach generation that ends at an artifact; it never delivers. */
export const runOutreachIntelligence: WorkflowHandler = async (input, context) => {
  const prospectId = input.prospectId as string;
  const medium = input.medium as 'inmail' | 'inmail_traditional' | 'email' | 'content_comment';
  const [prospect, research, qualification] = await Promise.all([
    getProspectById(prospectId),
    getProspectResearch(prospectId),
    getLegacyQualification(prospectId),
  ]);
  if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);
  const generated = await actionHandlers.generate_outreach({
    prospectId,
    medium,
    targetContent: input.targetContent,
  }, context.runId) as Record<string, unknown>;
  const message = generated.message as Record<string, unknown> | undefined;
  if (!message || typeof message.content !== 'string') {
    throw new Error(`Outreach intelligence did not produce a message for ${prospectId}.`);
  }
  const usedClaimIds = Array.isArray(message.usedClaimIds)
    ? message.usedClaimIds.filter((id): id is string => typeof id === 'string')
    : undefined;
  const knowledge = await getOutreachKnowledgeLineage(prospect, usedClaimIds);
  return {
    workflow: 'outreach_intelligence',
    kind: 'outreach_message',
    title: `Outreach artifact · ${prospect.name}`,
    summary: `A grounded ${medium.replaceAll('_', ' ')} message is ready for human review and external delivery.`,
    content: {
      prospect: {
        id: prospect.id,
        name: prospect.name,
        company: prospect.company ?? null,
        title: prospect.title ?? null,
        email: prospect.email ?? null,
      },
      medium,
      subject: message.subject ?? null,
      message: message.content,
      messageId: generated.messageId,
      researchSummary: research?.companySummary ?? null,
      qualification,
    },
    sourceRefs: [
      { type: 'prospect', id: prospect.id, label: prospect.name },
      ...knowledge.sourceRefs,
    ],
    usedClaimIds: knowledge.usedClaimIds,
    usedEvidenceIds: knowledge.usedEvidenceIds,
    recommendations: [{
      action: 'external_delivery',
      label: 'Send with the external orchestrator',
      reason: 'Delivery, retries, and provider credentials belong to n8n or another external system.',
      input: { artifactTransport: 'intelligence_api', medium },
    }],
    provenance: {
      workflowVersion: '1.0',
      capabilities: ['generate_outreach'],
      generatedAt: new Date().toISOString(),
    },
  };
};

export const intelligenceWorkflowHandlers: Partial<
  Record<CanonicalIntelligenceWorkflow, WorkflowHandler>
> = {
  prospect_intelligence: runProspectIntelligence,
  outreach_intelligence: runOutreachIntelligence,
};

export interface DispatcherDependencies {
  createRun: typeof createIntelligenceRun;
  failRun: typeof failIntelligenceRun;
  getRun: typeof getIntelligenceRun;
  commitArtifact: typeof commitIntelligenceArtifact;
  getArtifactForRun: typeof getArtifactForRun;
  resolveAttention: typeof setAttentionItemStatus;
  actOnNotification: typeof setNotificationRecipientStatus;
  handlers: typeof intelligenceWorkflowHandlers;
}

const defaultDependencies: DispatcherDependencies = {
  createRun: createIntelligenceRun,
  failRun: failIntelligenceRun,
  getRun: getIntelligenceRun,
  commitArtifact: commitIntelligenceArtifact,
  getArtifactForRun,
  resolveAttention: setAttentionItemStatus,
  actOnNotification: setNotificationRecipientStatus,
  handlers: intelligenceWorkflowHandlers,
};

export async function executeIntelligenceWorkflow(input: {
  workflow: CanonicalIntelligenceWorkflow;
  workflowInput: unknown;
  context: WorkflowExecutionContext;
}, dependencyOverrides: Partial<DispatcherDependencies> = {}): Promise<WorkflowExecutionResult> {
  const deps = { ...defaultDependencies, ...dependencyOverrides };
  const handler = deps.handlers[input.workflow];
  if (!handler) throw new IntelligenceWorkflowUnavailableError(input.workflow);
  const parsedInput = parseWorkflowInput(input.workflow, input.workflowInput);
  const reserved = await deps.createRun({
    organizationId: input.context.organizationId,
    workflow: input.workflow,
    trigger: input.context.trigger,
    workflowInput: parsedInput,
    idempotencyKey: input.context.idempotencyKey,
    initiatingUserId: input.context.initiatingUserId,
    actorType: input.context.actorType,
  });

  if (!reserved.created) {
    const existingArtifact = await deps.getArtifactForRun(
      input.context.organizationId,
      reserved.run.id,
    );
    if (reserved.run.status === 'completed' && existingArtifact) {
      return { run: reserved.run, artifact: existingArtifact, replayed: true };
    }
    throw new IntelligenceWorkflowConflictError(reserved.run);
  }

  try {
    const draft = await runWithGraphOrganization(input.context.organizationId, () => handler(parsedInput, {
        organizationId: input.context.organizationId,
        runId: reserved.run.id,
        actorType: input.context.actorType,
        initiatingUserId: input.context.initiatingUserId,
      }));
    if (draft.workflow !== input.workflow) {
      throw new Error(`Workflow ${input.workflow} returned an artifact for ${draft.workflow}.`);
    }
    if (['prospect_intelligence', 'outreach_intelligence'].includes(input.workflow)) {
      if (!draft.usedClaimIds?.length || !draft.usedEvidenceIds?.length) {
        throw new Error(`Workflow ${input.workflow} produced an artifact without shared claim and evidence lineage.`);
      }
    }
    const artifact = await deps.commitArtifact({
      organizationId: input.context.organizationId,
      runId: reserved.run.id,
      draft,
    });
    if (input.context.attentionItemId) {
      await deps.resolveAttention(
        input.context.organizationId,
        input.context.attentionItemId,
        'resolved',
      );
      if (input.context.initiatingUserId) {
        await deps.actOnNotification(
          input.context.organizationId,
          input.context.initiatingUserId,
          input.context.attentionItemId,
          'acted',
        );
      }
    }
    await recordProductEvent({
      organizationId: input.context.organizationId,
      name: 'intelligence.artifact.ready',
      payload: {
        artifactId: artifact.id,
        runId: reserved.run.id,
        workflow: input.workflow,
        kind: artifact.kind,
      },
      refs: input.workflow === 'prospect_intelligence' || input.workflow === 'outreach_intelligence'
        ? { prospectId: parsedInput.prospectId as string }
        : undefined,
    });
    await recordProductEvent({
      organizationId: input.context.organizationId,
      name: 'knowledge.intelligence.artifact.ready',
      origin: 'internal',
      idempotencyKey: artifact.id,
      payload: { artifactId: artifact.id },
    });
    const completed = await deps.getRun(input.context.organizationId, reserved.run.id);
    if (!completed) throw new Error('The completed intelligence run could not be reloaded.');
    return { run: completed, artifact, replayed: false };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The intelligence workflow failed.';
    await deps.failRun(input.context.organizationId, reserved.run.id, {
      code: 'WORKFLOW_FAILED',
      message,
    }).catch(() => undefined);
    throw cause;
  }
}
