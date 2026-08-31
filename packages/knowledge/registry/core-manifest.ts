import { defineKnowledgeManifest } from './schema';

const allUses = ['research', 'qualification', 'outreach', 'content', 'citation', 'internal'] as const;

export const coreKnowledgeManifest = defineKnowledgeManifest({
  moduleKey: 'core',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [
    ['person', 'Person', 'One canonical human identity.', 'person'],
    ['organization', 'Organization', 'One canonical company, institution, or group identity.', 'organization'],
    ['concept', 'Concept', 'A reusable subject, technology, theme, or abstract idea.', 'concept'],
    ['place', 'Place', 'A geographic or named location.', 'place'],
    ['event', 'Event', 'A dated occurrence or change.', 'event'],
    ['thing', 'Thing', 'A concrete or generated object not covered by another base kind.', 'thing'],
  ].map(([key, name, description, baseKind]) => ({
    key: `core.${key}`,
    name,
    description,
    baseKind: baseKind as 'person' | 'organization' | 'concept' | 'place' | 'event' | 'thing',
    sensitivity: 'workspace' as const,
    allowedUses: [...allUses],
  })),
  predicates: [
    { key: 'core.related_to', name: 'Related to', description: 'A meaningful non-hierarchical relationship.', subjectTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'], objectTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'], objectKind: 'entity' as const, symmetric: true },
    { key: 'core.about', name: 'About', description: 'The subject is about the object concept or entity.', subjectTypes: ['core.event', 'core.thing', 'core.concept'], objectTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'], objectKind: 'entity' as const },
    { key: 'core.mentions', name: 'Mentions', description: 'The subject explicitly mentions the object.', subjectTypes: ['core.event', 'core.thing', 'core.concept'], objectTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'], objectKind: 'entity' as const },
    { key: 'core.has_statement', name: 'Has statement', description: 'An evidence-backed statement about the subject.', subjectTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'], objectTypes: [], objectKind: 'literal' as const },
  ].map((value) => ({ ...value, sensitivity: 'workspace' as const, allowedUses: [...allUses] })),
  extractionProfiles: [{
    key: 'core.agent_note',
    name: 'Agent note',
    description: 'Durable, attributable statements deliberately written by an agent.',
    entityTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'],
    predicates: ['core.has_statement'],
    instructions: [
      'Preserve the note text verbatim as the evidence-backed statement.',
      'Attach the statement only to explicitly selected canonical subjects.',
      'Never infer additional claims while persisting an agent note.',
    ],
  }],
  readProjections: [{
    key: 'core.agent_memory',
    name: 'Agent memory',
    description: 'Core identities, relationships, and durable agent-written statements.',
    entityTypes: ['core.person', 'core.organization', 'core.concept', 'core.place', 'core.event', 'core.thing'],
    predicates: ['core.related_to', 'core.about', 'core.mentions', 'core.has_statement'],
    allowedUses: [...allUses],
    defaultLimit: 100,
  }],
  capabilityIds: ['knowledge.registry.get', 'knowledge.context.query', 'knowledge.search', 'knowledge.traverse', 'knowledge.entity.get', 'knowledge.explain.get', 'knowledge.coverage.get', 'knowledge.notes.query', 'knowledge.note.create', 'knowledge.note.revise', 'knowledge.note.retract', 'knowledge.lookup.request', 'knowledge.modules.list', 'knowledge.module.activate', 'knowledge.module.disable'],
  aliases: [],
  migrations: [],
});
