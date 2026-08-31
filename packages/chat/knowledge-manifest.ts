import { defineKnowledgeManifest } from '@content-automation/knowledge/registry/schema';

/**
 * Conversation transcripts and the public support-document Qdrant index are
 * deliberately not workspace graph knowledge. Taicho may read the shared
 * registry, while only an explicit save-to-knowledge capability may promote a
 * user-authored statement later.
 */
export const chatKnowledgeManifest = defineKnowledgeManifest({
  moduleKey: 'chat',
  version: 1,
  knowledge: 'none',
  entityTypes: [],
  predicates: [],
  extractionProfiles: [],
  readProjections: [],
  capabilityIds: ['chat.threads.list', 'chat.thread.get', 'chat.thread.create', 'chat.thread.delete', 'chat.message.send'],
  aliases: [],
  migrations: [],
});

export const supportKnowledgeManifest = defineKnowledgeManifest({
  moduleKey: 'support',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [
    {
      key: 'support.issue',
      name: 'Support issue',
      description: 'A customer-reported problem that may be linked to a product concept or workflow.',
      baseKind: 'thing',
      extends: 'core.thing',
      sensitivity: 'restricted',
      allowedUses: ['internal'],
    },
    {
      key: 'support.request',
      name: 'Feature request',
      description: 'A customer-requested capability or improvement supported by attributable feedback.',
      baseKind: 'concept',
      extends: 'core.concept',
      sensitivity: 'restricted',
      allowedUses: ['internal'],
    },
  ],
  predicates: [
    {
      key: 'support.about',
      name: 'Support feedback about',
      description: 'Connects a support issue or request to the product concept or workflow it concerns.',
      subjectTypes: ['support.issue', 'support.request'],
      objectTypes: ['core.concept', 'core.thing'],
      objectKind: 'entity',
      sensitivity: 'restricted',
      allowedUses: ['internal'],
    },
  ],
  extractionProfiles: [
    {
      key: 'support.feedback',
      name: 'Support feedback extraction',
      description: 'Extract attributable product problems and requests from user-approved support feedback.',
      entityTypes: ['support.issue', 'support.request', 'core.concept', 'core.thing'],
      predicates: ['support.about', 'core.about', 'core.related_to', 'core.has_statement'],
      instructions: ['Extract only the customer problem or request supported by the submitted feedback.', 'Do not promote private conversation text beyond the approved support feedback boundary.'],
    },
  ],
  readProjections: [
    {
      key: 'support.feedback_context',
      name: 'Support feedback context',
      description: 'Restricted support issues and requests available to feedback intelligence.',
      entityTypes: ['support.issue', 'support.request', 'core.concept', 'core.thing'],
      predicates: ['support.about', 'core.about', 'core.related_to', 'core.has_statement'],
      allowedUses: ['internal'],
      defaultLimit: 100,
    },
  ],
  capabilityIds: ['support.feedback.create', 'support.escalation.create', 'support.tickets.list', 'support.history.get'],
  aliases: [],
  migrations: [],
});
