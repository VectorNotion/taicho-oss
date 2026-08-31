import {
  FalkorKnowledgeRepository,
  knowledgeRegistry,
  normalizeSourceDocument,
  registerKnowledgeEventAdapter,
  type ReconcileClaimInput,
} from '@content-automation/knowledge';
import { z } from 'zod';

export const CASCADE_FUNNEL_KNOWLEDGE_EVENT = 'knowledge.cascade.funnel.changed';
export const CASCADE_MEMBER_KNOWLEDGE_EVENT = 'knowledge.cascade.member.changed';
export const CASCADE_EMAIL_KNOWLEDGE_EVENT = 'knowledge.cascade.email.changed';
export const CASCADE_GRAPH_KNOWLEDGE_EVENT = 'knowledge.cascade.graph.changed';

const funnelSchema = z.object({ id: z.string().min(1), name: z.string().min(1), createdAt: z.string().optional() });
const memberSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  workspaceContactId: z.string().nullable(),
  email: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  addedAt: z.string(),
});
const emailSchema = z.object({
  id: z.string().min(1),
  funnelId: z.string().min(1),
  name: z.string().min(1),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

async function sourceAndEvidence(input: {
  organizationId: string;
  uri: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}) {
  const repository = new FalkorKnowledgeRepository(input.organizationId, knowledgeRegistry.current());
  const document = normalizeSourceDocument({
    kind: 'product', canonicalUri: input.uri, title: input.title, content: input.content,
    sensitivity: 'restricted', allowedUses: ['internal'], metadata: input.metadata,
  });
  const source = await repository.upsertSource(document);
  const { revision } = await repository.putSourceRevision({
    sourceId: source.id, content: document.content, contentHash: document.contentHash, metadata: document.metadata,
  });
  const evidence = (await repository.putEvidenceSpans(revision.id, [{ start: 0, end: document.content.length, excerpt: document.content }]))[0];
  return { repository, revision, evidence };
}

async function projectFunnel(event: { organizationId: string; payload: Record<string, unknown> }) {
  const { funnel, removed } = z.object({ funnel: funnelSchema, removed: z.boolean().default(false) }).parse(event.payload);
  const data = await sourceAndEvidence({
    organizationId: event.organizationId,
    uri: `cascade-funnel:${funnel.id}`,
    title: `Cascade funnel: ${funnel.name}`,
    content: removed ? `Funnel removed: ${funnel.name}` : `Funnel: ${funnel.name}`,
    metadata: { funnelId: funnel.id, removed },
  });
  const entity = await data.repository.resolveEntity({ typeKey: 'cascade.funnel', name: funnel.name, externalIds: { cascade_funnel: funnel.id } });
  if (entity.status === 'review_required') throw new Error(`Cascade funnel ${funnel.id} requires identity review.`);
  const claims: ReconcileClaimInput[] = removed ? [] : [{
    subjectEntityId: entity.entity.id,
    predicateKey: 'core.has_statement',
    object: { kind: 'literal', value: `Funnel: ${funnel.name}`, valueType: 'string' },
    statement: `${funnel.name} is a Cascade nurture funnel.`,
    evidenceIds: [data.evidence.id], confidence: 1, sensitivity: 'workspace', allowedUses: ['internal'],
  }];
  await data.repository.reconcileClaims({ ownerProfile: 'cascade.records', revisionId: data.revision.id, extractionVersion: 'cascade-records@1', claims });
  return 'projected' as const;
}

async function projectMember(event: { organizationId: string; payload: Record<string, unknown> }) {
  const { member, funnel, removed } = z.object({ member: memberSchema, funnel: funnelSchema, removed: z.boolean().default(false) }).parse(event.payload);
  const name = typeof member.attributes.name === 'string' && member.attributes.name.trim() ? member.attributes.name.trim() : member.email;
  const data = await sourceAndEvidence({
    organizationId: event.organizationId,
    uri: `cascade-membership:${funnel.id}:${member.contactId}`,
    title: `${name} in ${funnel.name}`,
    content: removed ? `${name} removed from funnel ${funnel.name}.` : `${name} (${member.email}) is a member of funnel ${funnel.name}.`,
    metadata: { funnelId: funnel.id, contactId: member.contactId, workspaceContactId: member.workspaceContactId, removed },
  });
  const externalIds: Record<string, string> = { cascade_contact: member.contactId, email: member.email.toLowerCase() };
  if (member.workspaceContactId) {
    externalIds.workspace_contact = member.workspaceContactId;
    externalIds.outreach_prospect = member.workspaceContactId;
  }
  const [person, funnelEntity] = await Promise.all([
    data.repository.resolveEntity({ typeKey: 'cascade.member', name, externalIds, sensitivity: 'restricted' }),
    data.repository.resolveEntity({ typeKey: 'cascade.funnel', name: funnel.name, externalIds: { cascade_funnel: funnel.id } }),
  ]);
  if (person.status === 'review_required' || funnelEntity.status === 'review_required') throw new Error('Cascade membership requires identity review.');
  const claims: ReconcileClaimInput[] = removed ? [] : [{
    subjectEntityId: person.entity.id,
    predicateKey: 'cascade.member_in',
    object: { kind: 'entity', entityId: funnelEntity.entity.id },
    statement: `${name} is a member of ${funnel.name}.`,
    evidenceIds: [data.evidence.id], confidence: 1, sensitivity: 'restricted', allowedUses: ['internal'],
    validFrom: member.addedAt,
  }];
  await data.repository.reconcileClaims({ ownerProfile: 'cascade.records', revisionId: data.revision.id, extractionVersion: 'cascade-records@1', claims });
  return 'projected' as const;
}

async function projectEmail(event: { organizationId: string; payload: Record<string, unknown> }) {
  const { email, funnel, removed } = z.object({ email: emailSchema, funnel: funnelSchema, removed: z.boolean().default(false) }).parse(event.payload);
  const data = await sourceAndEvidence({
    organizationId: event.organizationId,
    uri: `cascade-email:${email.id}`,
    title: email.name,
    content: removed ? `Stored email removed: ${email.name}` : `Name: ${email.name}\nSubject: ${email.subject}\n\n${email.body}`,
    metadata: { emailId: email.id, funnelId: funnel.id, removed },
  });
  const [emailEntity, funnelEntity] = await Promise.all([
    data.repository.resolveEntity({ typeKey: 'cascade.email', name: email.name, externalIds: { cascade_email: email.id } }),
    data.repository.resolveEntity({ typeKey: 'cascade.funnel', name: funnel.name, externalIds: { cascade_funnel: funnel.id } }),
  ]);
  if (emailEntity.status === 'review_required' || funnelEntity.status === 'review_required') throw new Error('Cascade email requires identity review.');
  const claims: ReconcileClaimInput[] = removed ? [] : [{
    subjectEntityId: emailEntity.entity.id,
    predicateKey: 'cascade.email_in',
    object: { kind: 'entity', entityId: funnelEntity.entity.id },
    statement: `${email.name} belongs to ${funnel.name}.`,
    evidenceIds: [data.evidence.id], confidence: 1, sensitivity: 'workspace', allowedUses: ['internal'],
  }];
  await data.repository.reconcileClaims({ ownerProfile: 'cascade.records', revisionId: data.revision.id, extractionVersion: 'cascade-records@1', claims });
  return 'projected' as const;
}

async function projectGraph(event: { organizationId: string; payload: Record<string, unknown> }) {
  const { funnelId, nodeCount, edgeCount } = z.object({
    funnelId: z.string().min(1),
    nodeCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
  }).parse(event.payload);
  const data = await sourceAndEvidence({
    organizationId: event.organizationId,
    uri: `cascade-graph:${funnelId}`,
    title: `Cascade funnel automation: ${funnelId}`,
    content: `Funnel automation updated — ${nodeCount} steps, ${edgeCount} arrows.`,
    metadata: { funnelId, nodeCount, edgeCount },
  });
  await data.repository.reconcileClaims({ ownerProfile: 'cascade.records', revisionId: data.revision.id, extractionVersion: 'cascade-records@1', claims: [] });
  return 'projected' as const;
}

export function registerCascadeKnowledgeEventAdapters(): void {
  registerKnowledgeEventAdapter(CASCADE_FUNNEL_KNOWLEDGE_EVENT, projectFunnel);
  registerKnowledgeEventAdapter(CASCADE_MEMBER_KNOWLEDGE_EVENT, projectMember);
  registerKnowledgeEventAdapter(CASCADE_EMAIL_KNOWLEDGE_EVENT, projectEmail);
  registerKnowledgeEventAdapter(CASCADE_GRAPH_KNOWLEDGE_EVENT, projectGraph);
}
