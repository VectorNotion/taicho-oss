import { z } from 'zod';

/**
 * The platform's fixed product workflows. These keys are API contracts, not
 * user-authored workflow identifiers and not agent names.
 */
export const CANONICAL_INTELLIGENCE_WORKFLOWS = [
  'knowledge_research',
  'content_intelligence',
  'audience_resonance',
  'lead_intelligence',
  'outreach_intelligence',
  'funnel_intelligence',
  'feedback_intelligence',
] as const;

export type CanonicalIntelligenceWorkflow =
  (typeof CANONICAL_INTELLIGENCE_WORKFLOWS)[number];

export const ARTIFACT_KINDS = [
  'research_brief',
  'content_package',
  'audience_evaluation',
  'lead_dossier',
  'outreach_message',
  'funnel_recommendation',
  'feedback_recommendation',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactStatus = 'ready' | 'approved' | 'superseded';
export type WorkflowRunStatus = 'running' | 'completed' | 'failed';
export type WorkflowTrigger = 'chat' | 'event' | 'external' | 'system';

export const NOTIFICATION_CATEGORIES = [
  'leads',
  'content_insights',
  'workflow_results',
  'external_outcomes',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationRecipientStatus = 'unread' | 'seen' | 'dismissed' | 'acted';

export interface WorkflowDefinition {
  key: CanonicalIntelligenceWorkflow;
  name: string;
  purpose: string;
  artifactKind: ArtifactKind;
  implementation: 'available' | 'definition-only';
}

export const INTELLIGENCE_WORKFLOW_DEFINITIONS: Record<
  CanonicalIntelligenceWorkflow,
  WorkflowDefinition
> = {
  knowledge_research: {
    key: 'knowledge_research',
    name: 'Knowledge and research',
    purpose: 'Turn source material into grounded research and reusable knowledge.',
    artifactKind: 'research_brief',
    implementation: 'definition-only',
  },
  content_intelligence: {
    key: 'content_intelligence',
    name: 'Content intelligence',
    purpose: 'Turn knowledge into topics, ideas, outlines, drafts, and media specifications.',
    artifactKind: 'content_package',
    implementation: 'definition-only',
  },
  audience_resonance: {
    key: 'audience_resonance',
    name: 'Audience Resonance',
    purpose: 'Evaluate creative variations and recommend the strongest candidate.',
    artifactKind: 'audience_evaluation',
    implementation: 'definition-only',
  },
  lead_intelligence: {
    key: 'lead_intelligence',
    name: 'Lead intelligence',
    purpose: 'Research a lead, qualify the fit, and recommend the next decision.',
    artifactKind: 'lead_dossier',
    implementation: 'available',
  },
  outreach_intelligence: {
    key: 'outreach_intelligence',
    name: 'Outreach intelligence',
    purpose: 'Create a grounded, personalized outreach artifact for external delivery.',
    artifactKind: 'outreach_message',
    implementation: 'available',
  },
  funnel_intelligence: {
    key: 'funnel_intelligence',
    name: 'Funnel intelligence',
    purpose: 'Recommend a funnel transition and create the next-touch artifact.',
    artifactKind: 'funnel_recommendation',
    implementation: 'definition-only',
  },
  feedback_intelligence: {
    key: 'feedback_intelligence',
    name: 'Feedback intelligence',
    purpose: 'Interpret externally reported outcomes and recommend what to do next.',
    artifactKind: 'feedback_recommendation',
    implementation: 'definition-only',
  },
};

const workflowInputSchemas = {
  knowledge_research: z.object({
    sourceIds: z.array(z.string().min(1).max(200)).max(100).optional(),
    timeRange: z.string().trim().min(1).max(100).optional(),
  }),
  content_intelligence: z.object({
    operation: z.enum(['generate_ideas', 'refine_idea', 'generate_draft']),
    ideaId: z.string().min(1).max(200).optional(),
    contentType: z.string().min(1).max(100).optional(),
    count: z.number().int().min(1).max(20).optional(),
  }),
  audience_resonance: z.object({
    draftId: z.string().min(1).max(200),
    variationCount: z.number().int().min(2).max(6),
    audienceSize: z.number().int().min(100).max(2_000_000),
  }),
  lead_intelligence: z.object({
    leadId: z.string().min(1).max(200),
  }),
  outreach_intelligence: z.object({
    leadId: z.string().min(1).max(200),
    medium: z.enum(['inmail', 'inmail_traditional', 'email', 'content_comment']),
    targetContent: z.string().max(20_000).optional(),
  }),
  funnel_intelligence: z.object({
    leadId: z.string().min(1).max(200).optional(),
    contactId: z.string().min(1).max(200).optional(),
    funnelId: z.string().min(1).max(200),
    objective: z.string().trim().min(1).max(2_000).optional(),
  }).refine((input) => input.leadId || input.contactId, {
    message: 'Provide leadId or contactId.',
  }),
  feedback_intelligence: z.object({
    entityType: z.string().trim().min(1).max(100),
    entityId: z.string().trim().min(1).max(200),
    outcomes: z.array(z.record(z.string(), z.unknown())).min(1).max(1_000),
  }),
} satisfies Record<CanonicalIntelligenceWorkflow, z.ZodType>;

export function parseWorkflowInput(
  workflow: CanonicalIntelligenceWorkflow,
  input: unknown,
): Record<string, unknown> {
  return workflowInputSchemas[workflow].parse(input) as Record<string, unknown>;
}

export function isCanonicalIntelligenceWorkflow(
  value: string,
): value is CanonicalIntelligenceWorkflow {
  return (CANONICAL_INTELLIGENCE_WORKFLOWS as readonly string[]).includes(value);
}

export interface ArtifactSourceRef {
  type: string;
  id?: string;
  url?: string;
  label?: string;
}

export interface ArtifactRecommendation {
  action: string;
  label: string;
  reason?: string;
  input?: Record<string, unknown>;
}

export interface StructuredArtifact {
  id: string;
  organizationId: string;
  runId: string;
  workflow: CanonicalIntelligenceWorkflow;
  kind: ArtifactKind;
  status: ArtifactStatus;
  title: string;
  summary: string | null;
  content: Record<string, unknown>;
  sourceRefs: ArtifactSourceRef[];
  recommendations: ArtifactRecommendation[];
  provenance: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactDraft = Omit<
  StructuredArtifact,
  'id' | 'organizationId' | 'runId' | 'status' | 'createdAt' | 'updatedAt'
> & { status?: ArtifactStatus };

export interface IntelligenceRun {
  id: string;
  organizationId: string;
  workflow: CanonicalIntelligenceWorkflow;
  status: WorkflowRunStatus;
  trigger: WorkflowTrigger;
  input: Record<string, unknown>;
  idempotencyKey: string;
  initiatingUserId: string | null;
  actorType: 'user' | 'service' | 'system';
  error: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
}

export interface AttentionSuggestedAction {
  workflow: CanonicalIntelligenceWorkflow;
  label: string;
  input: Record<string, unknown>;
  prompt: string;
}

export interface AttentionItem {
  id: string;
  organizationId: string;
  eventId: string | null;
  artifactId: string | null;
  status: 'open' | 'seen' | 'resolved' | 'dismissed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: NotificationCategory | 'general';
  policyVersion: number;
  groupKey: string | null;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  suggestedAction: AttentionSuggestedAction;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  expiresAt: string | null;
}

export interface NotificationInboxItem extends AttentionItem {
  recipientStatus: NotificationRecipientStatus;
  deliveredAt: string | null;
  seenAt: string | null;
  actedAt: string | null;
}

export interface NotificationPreference {
  category: NotificationCategory | '*';
  channel: string;
  enabled: boolean;
}
