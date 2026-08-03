// Topic entity types

export type TopicStatus = 'active' | 'dismissed';
export type TopicSource = 'llm_extracted' | 'manual';

export interface Topic {
  id: string;
  name: string; // Canonical lowercase name for dedup (e.g., "multi-agent-systems")
  displayName: string; // Human-friendly display (e.g., "Multi-Agent Systems")
  description: string; // 1-2 sentence explanation
  status: TopicStatus;
  source: TopicSource;
  createdAt: string;
  updatedAt: string;
  dismissedAt: string | null;
  mentionCount: number; // Computed from COVERS_TOPIC relationships
}

export interface CreateTopicInput {
  name: string;
  displayName: string;
  description: string;
  source?: TopicSource;
}

export interface UpdateTopicInput {
  displayName?: string;
  description?: string;
}

export interface TopicsResponse {
  topics: Topic[];
  total: number;
  activeCount: number;
  dismissedCount: number;
}
