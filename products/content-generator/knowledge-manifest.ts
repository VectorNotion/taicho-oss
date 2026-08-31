import { defineKnowledgeManifest } from '@content-automation/knowledge/registry/schema';

const contentUses = ['research', 'content', 'citation', 'internal'] as const;
const conceptType = (key: string, name: string, description: string) => ({
  key: `content.${key}`,
  name,
  description,
  baseKind: 'concept' as const,
  extends: 'core.concept',
  sensitivity: 'workspace' as const,
  allowedUses: [...contentUses],
});

export const contentKnowledgeManifest = defineKnowledgeManifest({
  moduleKey: 'content',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [
    { key: 'content.project', name: 'Project', description: 'A workspace project used as content context.', baseKind: 'thing', extends: 'core.thing', sensitivity: 'workspace', allowedUses: [...contentUses] },
    { key: 'content.topic', name: 'Topic', description: 'A stable topic discovered from accepted knowledge claims.', baseKind: 'concept', extends: 'core.concept', sensitivity: 'workspace', allowedUses: [...contentUses] },
    { key: 'content.idea', name: 'Idea', description: 'A proposed content idea derived from knowledge.', baseKind: 'thing', extends: 'core.thing', sensitivity: 'workspace', allowedUses: [...contentUses] },
    { key: 'content.draft', name: 'Draft', description: 'A generated or edited content draft.', baseKind: 'thing', extends: 'core.thing', sensitivity: 'workspace', allowedUses: [...contentUses] },
    conceptType('framework', 'Framework', 'A reusable technical or business framework.'),
    conceptType('database', 'Database', 'A database technology or data-store concept.'),
    conceptType('cloud', 'Cloud platform', 'A cloud platform or managed infrastructure concept.'),
    conceptType('language', 'Programming language', 'A programming or query language.'),
    conceptType('ai_component', 'AI component', 'An AI or machine-learning capability or subsystem.'),
    conceptType('feature', 'Feature', 'A user-facing product feature.'),
    conceptType('integration', 'Integration', 'A product or system integration.'),
    conceptType('business_value', 'Business value', 'A business outcome or value proposition.'),
  ],
  predicates: [
    { key: 'content.project_has', name: 'Project has', description: 'A project contains or implements the extracted concept.', subjectTypes: ['content.project'], objectTypes: ['content.framework', 'content.database', 'content.cloud', 'content.language', 'content.ai_component', 'content.feature', 'content.integration', 'content.business_value', 'core.concept', 'core.thing', 'core.organization'], objectKind: 'entity', sensitivity: 'workspace', allowedUses: [...contentUses] },
    { key: 'content.topic_about', name: 'Topic about', description: 'A topic is about a canonical concept or entity.', subjectTypes: ['content.topic'], objectTypes: ['core.person', 'core.organization', 'core.concept', 'core.event', 'core.thing'], objectKind: 'entity', sensitivity: 'workspace', allowedUses: [...contentUses] },
    { key: 'content.idea_uses', name: 'Idea uses', description: 'An idea uses a topic or project context.', subjectTypes: ['content.idea'], objectTypes: ['content.topic', 'content.project'], objectKind: 'entity', sensitivity: 'workspace', allowedUses: [...contentUses] },
    { key: 'content.draft_from', name: 'Draft from', description: 'A draft was generated from an idea.', subjectTypes: ['content.draft'], objectTypes: ['content.idea'], objectKind: 'entity', sensitivity: 'workspace', allowedUses: [...contentUses] },
  ],
  extractionProfiles: [
    { key: 'content.project_extraction', name: 'Project extraction', description: 'Extract registered concepts and relationships from a project; concepts no registered type fits stay in the graph under a generic core kind while the ontology learns.', entityTypes: ['content.project', 'content.framework', 'content.database', 'content.cloud', 'content.language', 'content.ai_component', 'content.feature', 'content.integration', 'content.business_value', 'core.concept', 'core.thing', 'core.organization'], predicates: ['content.project_has'], instructions: ['Extract only concepts explicitly supported by the project text.', 'Return the exact evidence span for every candidate.'] },
    { key: 'content.research', name: 'Content research', description: 'Extract reusable claims, topics, entities, and relationships from content research.', entityTypes: ['content.topic', 'core.person', 'core.organization', 'core.concept', 'core.event', 'core.thing'], predicates: ['core.about', 'core.mentions', 'core.related_to', 'core.has_statement', 'content.topic_about'], instructions: ['Prefer claims that can affect topic selection, content ideas, or factual citations.', 'Preserve dates, uncertainty, and exact evidence spans.'] },
  ],
  readProjections: [
    { key: 'content.topic_discovery', name: 'Topic discovery', description: 'Accepted research claims used to assign and discover topics.', entityTypes: ['content.topic', 'core.person', 'core.organization', 'core.concept', 'core.event'], predicates: ['core.about', 'core.mentions', 'core.related_to', 'core.has_statement', 'content.topic_about'], allowedUses: ['research', 'content', 'internal'], defaultLimit: 200 },
    { key: 'content.idea_context', name: 'Idea context', description: 'Grounded context for content idea generation.', entityTypes: ['content.topic', 'content.project', 'core.person', 'core.organization', 'core.concept'], predicates: ['core.about', 'core.related_to', 'core.has_statement', 'content.project_has', 'content.topic_about'], artifactKinds: ['content.topic'], allowedUses: ['content', 'citation', 'internal'], defaultLimit: 80 },
    { key: 'content.draft_context', name: 'Draft context', description: 'Evidence and claims allowed to ground a draft.', entityTypes: ['content.idea', 'content.topic', 'content.project', 'core.person', 'core.organization', 'core.concept', 'core.event'], predicates: ['core.about', 'core.mentions', 'core.related_to', 'core.has_statement', 'content.project_has', 'content.topic_about', 'content.idea_uses'], artifactKinds: ['content.idea'], allowedUses: ['content', 'citation'], defaultLimit: 120 },
  ],
  capabilityIds: ['content.project.get', 'content.research_items.list', 'content.topics.list', 'content.ideas.generate', 'content.draft.generate'],
  aliases: [],
  migrations: [],
});
