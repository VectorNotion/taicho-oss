// Research Source types
export type ResearchSourceType = 'website' | 'search_term';

export interface ResearchSource {
  id: string;
  name: string;
  type: ResearchSourceType;
  url: string; // URL for websites, search query for search_term
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchSourceInput {
  name: string;
  type: ResearchSourceType;
  url: string;
  enabled?: boolean;
}

export interface UpdateResearchSourceInput {
  name?: string;
  type?: ResearchSourceType;
  url?: string;
  enabled?: boolean;
}

// Research Item types
export type ResearchItemStatus =
  | 'unprocessed'
  | 'flagged_for_video'
  | 'flagged_for_blog'
  | 'flagged_for_tweet'
  | 'processed';

export type ResearchItemPriority = 'low' | 'medium' | 'high';

export interface ResearchItem {
  id: string;
  title: string;
  content: string;
  sourceUrl: string;
  sourceId: string | null;
  sourceName?: string; // Populated via relationship join
  addedBy: 'researcher_agent' | 'manual';
  addedAt: string;
  tags: string[];
  status: ResearchItemStatus;
  priority: ResearchItemPriority;
  humanNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchItemInput {
  title: string;
  content: string;
  sourceUrl: string;
  sourceId?: string;
  addedBy?: 'researcher_agent' | 'manual';
  tags?: string[];
  status?: ResearchItemStatus;
  priority?: ResearchItemPriority;
  humanNote?: string;
}

export interface UpdateResearchItemInput {
  title?: string;
  content?: string;
  status?: ResearchItemStatus;
  priority?: ResearchItemPriority;
  humanNote?: string;
  tags?: string[];
}

// Filter options for research items
export interface ResearchItemFilters {
  status?: ResearchItemStatus;
  priority?: ResearchItemPriority;
  sourceId?: string;
  addedBy?: 'researcher_agent' | 'manual';
}
