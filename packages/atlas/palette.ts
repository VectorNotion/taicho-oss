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
  ResearchItem: 'research-item',
  ResearchSource: 'source',
  Prospect: 'prospect',
  ProspectResearch: 'prospect-research',
  ProspectQualification: 'qualification',
  Persona: 'persona',
};

export const TYPE_COLOR: Record<BrainNodeType, string> = {
  project: '#8b7cf7', capability: '#5fd4d0', topic: '#d9a15c',
  idea: '#7cc98f', draft: '#7cc98f', 'research-item': '#d9a15c',
  source: '#d9a15c', prospect: '#d97c8a', 'prospect-research': '#d97c8a',
  qualification: '#d97c8a', persona: '#e6e6f0', agent: '#8b7cf7',
};

/** Ring-style (hollow) types. */
export const TYPE_RING = new Set<BrainNodeType>(['draft', 'source']);

/** User word shown in the inspector type line. */
export const TYPE_WORD: Record<BrainNodeType, string> = {
  project: 'Project', capability: 'Capability', topic: 'Topic', idea: 'Idea',
  draft: 'Post', 'research-item': 'Research', source: 'Source', prospect: 'Prospect',
  'prospect-research': 'Research', qualification: 'Qualification',
  persona: 'Persona', agent: 'Agent',
};

export function nodeRadius(degree: number): number {
  return Math.min(18, 5 + 3 * Math.sqrt(Math.max(0, degree)));
}
