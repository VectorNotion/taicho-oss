/**
 * Raw, dependency-free manifests owned by platform modules. They are parsed by
 * the dashboard composition root so Platform does not depend back on the
 * knowledge runtime (which already depends on Platform's graph boundary).
 */
export const workspaceKnowledgeManifestInput = {
  moduleKey: 'workspace',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [
    {
      key: 'workspace.contact',
      name: 'Workspace contact',
      description: 'The workspace role of one canonical person shared by product modules.',
      baseKind: 'person',
      extends: 'core.person',
      sensitivity: 'restricted',
      allowedUses: ['qualification', 'outreach', 'internal'],
    },
  ],
  predicates: [],
  extractionProfiles: [
    {
      key: 'workspace.contact_record',
      name: 'Workspace contact record',
      description: 'Reconcile canonical contact attributes and product roles from the workspace directory.',
      entityTypes: ['workspace.contact', 'core.person', 'core.organization'],
      predicates: ['core.related_to', 'core.has_statement'],
      instructions: ['Treat the contact identifier and exact contact fields as authoritative product evidence.', 'Do not infer missing personal or company attributes.'],
    },
  ],
  readProjections: [
    {
      key: 'workspace.contact_context',
      name: 'Workspace contact context',
      description: 'Canonical identity and authorized knowledge connected to a workspace person.',
      entityTypes: ['workspace.contact', 'core.person', 'core.organization', 'core.concept', 'core.event', 'core.thing'],
      predicates: ['core.about', 'core.related_to', 'core.has_statement'],
      allowedUses: ['qualification', 'outreach', 'internal'],
      defaultLimit: 120,
    },
  ],
  capabilityIds: ['workspace.contacts.list', 'workspace.contact.create', 'workspace.contact.update', 'workspace.contact.outreach.start'],
  aliases: [],
  migrations: [],
};

export const publishingKnowledgeManifestInput = {
  moduleKey: 'publishing',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [
    {
      key: 'publishing.publication',
      name: 'Publication',
      description: 'An externally published representation of a content artifact.',
      baseKind: 'thing',
      extends: 'core.thing',
      sensitivity: 'workspace',
      allowedUses: ['research', 'content', 'citation', 'internal'],
    },
    {
      key: 'publishing.channel',
      name: 'Publishing channel',
      description: 'A destination account or endpoint used to publish content.',
      baseKind: 'thing',
      extends: 'core.thing',
      sensitivity: 'workspace',
      allowedUses: ['content', 'internal'],
    },
  ],
  predicates: [
    {
      key: 'publishing.from_draft',
      name: 'Published from draft',
      description: 'Connects an observed publication to the content draft from which it was produced.',
      subjectTypes: ['publishing.publication'],
      objectTypes: ['content.draft'],
      objectKind: 'entity',
      sensitivity: 'workspace',
      allowedUses: ['research', 'content', 'citation', 'internal'],
    },
    {
      key: 'publishing.on_channel',
      name: 'Published on channel',
      description: 'Connects an observed publication to its external destination channel.',
      subjectTypes: ['publishing.publication'],
      objectTypes: ['publishing.channel'],
      objectKind: 'entity',
      sensitivity: 'workspace',
      allowedUses: ['content', 'internal'],
    },
  ],
  extractionProfiles: [
    {
      key: 'publishing.records',
      name: 'Publishing records',
      description: 'Reconcile publication state, channel lineage, and observed metrics from first-party publishing records.',
      entityTypes: ['publishing.publication', 'publishing.channel', 'content.draft'],
      predicates: ['publishing.from_draft', 'publishing.on_channel', 'core.has_statement'],
      instructions: ['Treat destination URLs and platform status as observed product facts.', 'Treat metrics as time-stamped observations, never as permanent attributes.'],
    },
  ],
  readProjections: [
    {
      key: 'publishing.performance_context',
      name: 'Publishing performance context',
      description: 'Published content and observed performance facts available to content and feedback workflows.',
      entityTypes: ['publishing.publication', 'publishing.channel', 'content.draft', 'content.idea', 'content.topic', 'core.concept'],
      predicates: ['publishing.from_draft', 'publishing.on_channel', 'content.draft_from', 'content.idea_uses', 'core.about', 'core.related_to', 'core.has_statement'],
      artifactKinds: ['content.draft'],
      assessmentKinds: ['publishing.performance'],
      allowedUses: ['research', 'content', 'internal'],
      defaultLimit: 200,
    },
  ],
  capabilityIds: ['publishing.overview.get', 'publishing.draft.posts.list', 'publishing.draft.publish', 'publishing.post.get', 'publishing.post.schedule'],
  aliases: [],
  migrations: [],
};

function noKnowledge(moduleKey: string, capabilityIds: string[]) {
  return {
    moduleKey,
    version: 1,
    knowledge: 'none',
    entityTypes: [],
    predicates: [],
    extractionProfiles: [],
    readProjections: [],
    capabilityIds,
    aliases: [],
    migrations: [],
  };
}

export const administrationKnowledgeManifestInput = noKnowledge('administration', ['workspace.admin_console.get']);
export const integrationsKnowledgeManifestInput = noKnowledge('integrations', ['integration.mcp.list']);
export const webhooksKnowledgeManifestInput = noKnowledge('webhooks', ['webhooks.endpoints.list']);
export const automationsKnowledgeManifestInput = noKnowledge('automations', [
  'automation.list', 'automation.runtime', 'automation.get', 'automation.runs.list',
  'automation.run.get', 'automation.run.events', 'automation.create', 'automation.update',
  'automation.delete', 'automation.run', 'automation.run.signal',
]);
