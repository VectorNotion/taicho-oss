import { defineKnowledgeManifest } from '@content-automation/knowledge/registry/schema';

/**
 * Agents configure consumers of the shared graph; they do not define a new
 * graph ontology. Their runtime reads and writes through the core knowledge
 * capabilities declared by the graph adapter.
 */
export const agentsKnowledgeManifest = defineKnowledgeManifest({
  moduleKey: 'agents',
  version: 1,
  knowledge: 'none',
  entityTypes: [],
  predicates: [],
  extractionProfiles: [],
  readProjections: [],
  capabilityIds: [
    'agents.list',
    'agents.create',
    'agents.update',
    'agents.deployment.create',
    'agents.deployment.revoke',
  ],
  aliases: [],
  migrations: [],
});
