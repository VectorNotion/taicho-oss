/** Atlas (the Brain) — shared vocabulary. User-facing words only; graph
 *  labels are translated at the repository boundary and never leave it. */

export type BrainNodeType =
  | 'project' | 'capability' | 'topic' | 'idea' | 'draft' | 'media'
  | 'research-item' | 'source' | 'prospect' | 'prospect-research'
  | 'qualification' | 'persona' | 'agent'
  | 'organization' | 'person' | 'concept' | 'event' | 'place'
  | 'fact' | 'evidence' | 'assessment' | 'thing';

export type BrainNode = {
  id: string;
  label: string;
  type: BrainNodeType;
  degree: number;
  createdAt: string | null;
  meta: Record<string, string | number | null>;
  proofs?: BrainProof[];
  knowledge?: BrainKnowledgeItem[];
};

export type BrainProof = {
  id: string;
  excerpt: string;
  url: string;
};

export type BrainKnowledgeItem = {
  id: string;
  statement: string;
  proofs: BrainProof[];
};

export type BrainLink = { a: string; b: string; kind: string };
export type BrainGraph = { nodes: BrainNode[]; links: BrainLink[] };

export type BrainSearchResult = Pick<BrainNode, 'id' | 'label' | 'type'> & { sub: string };
