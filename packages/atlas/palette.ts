import type { BrainNodeType } from './types';

/** FalkorDB label → explorer type. The ONLY place labels are known. */
export const LABEL_TO_TYPE: Record<string, BrainNodeType> = {
  Project: 'project',
  Framework: 'capability', Database: 'capability', Cloud: 'capability',
  Language: 'capability', AIComponent: 'capability', Feature: 'capability',
  Integration: 'capability', BusinessValue: 'capability',
  Topic: 'topic',
  ContentIdea: 'idea',
  ContentDraft: 'draft',
  MediaAsset: 'media',
  ResearchItem: 'research-item',
  ResearchSource: 'source',
  Prospect: 'prospect',
  ProspectResearch: 'prospect-research',
  ProspectQualification: 'qualification',
  Persona: 'persona',
  CanonicalEntity: 'thing',
  Claim: 'fact',
  KnowledgeSource: 'source',
  Evidence: 'evidence',
  SourceRevision: 'source',
  Assessment: 'assessment',
  Artifact: 'thing',
};

export const TYPE_COLOR: Record<BrainNodeType, string> = {
  project: '#8b7cf7', capability: '#5fd4d0', topic: '#d9a15c',
  idea: '#7cc98f', draft: '#7cc98f', media: '#68b7e8', 'research-item': '#d9a15c',
  source: '#d9a15c', prospect: '#d97c8a', 'prospect-research': '#d97c8a',
  qualification: '#d97c8a', persona: '#e6e6f0', agent: '#8b7cf7',
  organization: '#8b7cf7', person: '#d97c8a', concept: '#5fd4d0',
  event: '#d9a15c', place: '#7cc98f', fact: '#e6b566',
  evidence: '#68b7e8', assessment: '#d97c8a', thing: '#a9a9bd',
};

/** Ring-style (hollow) types. */
export const TYPE_RING = new Set<BrainNodeType>(['draft', 'source']);

/** User word shown in the inspector type line. */
export const TYPE_WORD: Record<BrainNodeType, string> = {
  project: 'Project', capability: 'Capability', topic: 'Topic', idea: 'Idea',
  draft: 'Post', media: 'Media', 'research-item': 'Research', source: 'Source', prospect: 'Prospect',
  'prospect-research': 'Research', qualification: 'Qualification',
  persona: 'Persona', agent: 'Agent',
  organization: 'Organization', person: 'Person', concept: 'Concept',
  event: 'Event', place: 'Place', fact: 'Claim', evidence: 'Evidence', assessment: 'Assessment',
  thing: 'Entity',
};

export function nodeRadius(degree: number): number {
  return Math.min(18, 5 + 3 * Math.sqrt(Math.max(0, degree)));
}
