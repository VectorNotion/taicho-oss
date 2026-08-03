/** Atlas (the Brain) — shared vocabulary. User-facing words only; graph
 *  labels are translated at the repository boundary and never leave it. */

export type BrainNodeType =
  | 'project' | 'capability' | 'topic' | 'idea' | 'draft'
  | 'research-item' | 'source' | 'lead' | 'lead-research'
  | 'qualification' | 'persona' | 'agent';

export type BrainNode = {
  id: string;
  label: string;
  type: BrainNodeType;
  degree: number;
  createdAt: string | null;
  meta: Record<string, string | number | null>;
};

export type BrainLink = { a: string; b: string; kind: string };
export type BrainGraph = { nodes: BrainNode[]; links: BrainLink[] };

export type BrainSearchResult = Pick<BrainNode, 'id' | 'label' | 'type'> & { sub: string };
