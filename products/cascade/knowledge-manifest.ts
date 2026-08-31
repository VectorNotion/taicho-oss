import { defineKnowledgeManifest } from '@content-automation/knowledge/registry/schema';

export const cascadeKnowledgeManifest = defineKnowledgeManifest({
  moduleKey: 'cascade',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [
    { key: 'cascade.member', name: 'Nurture member', description: 'A canonical person participating in a nurture funnel.', baseKind: 'person', extends: 'core.person', sensitivity: 'restricted', allowedUses: ['internal'] },
    { key: 'cascade.funnel', name: 'Funnel', description: 'A named organizational collection for nurture contacts and copy.', baseKind: 'thing', extends: 'core.thing', sensitivity: 'workspace', allowedUses: ['internal'] },
    { key: 'cascade.email', name: 'Nurture email', description: 'Named plain-text email copy stored in a funnel.', baseKind: 'thing', extends: 'core.thing', sensitivity: 'workspace', allowedUses: ['internal'] },
  ],
  predicates: [
    { key: 'cascade.member_in', name: 'Member in funnel', description: 'A person is included in a funnel.', subjectTypes: ['cascade.member'], objectTypes: ['cascade.funnel'], objectKind: 'entity', sensitivity: 'restricted', allowedUses: ['internal'] },
    { key: 'cascade.email_in', name: 'Email in funnel', description: 'An email belongs to a funnel.', subjectTypes: ['cascade.email'], objectTypes: ['cascade.funnel'], objectKind: 'entity', sensitivity: 'workspace', allowedUses: ['internal'] },
  ],
  extractionProfiles: [{
    key: 'cascade.records',
    name: 'Cascade records',
    description: 'Reconcile funnels, memberships, and stored email relationships from authoritative Cascade records.',
    entityTypes: ['cascade.member', 'cascade.funnel', 'cascade.email', 'core.person', 'core.thing'],
    predicates: ['cascade.member_in', 'cascade.email_in', 'core.has_statement'],
    instructions: ['Use only authoritative Cascade record fields.', 'A removed membership or email relationship must supersede its prior claim.'],
  }],
  readProjections: [{ key: 'cascade.member_context', name: 'Nurture member context', description: 'Canonical people and their funnel membership.', entityTypes: ['cascade.member', 'cascade.funnel'], predicates: ['cascade.member_in'], allowedUses: ['internal'], defaultLimit: 100 }],
  capabilityIds: ['cascade.contacts.list', 'cascade.funnels.list'],
  aliases: [],
  migrations: [],
});
