// Types for tool results in chat interface

export interface ResearchItem {
  title: string;
  content: string;
  source: string;
  tags: string[];
  priority: "high" | "medium" | "low";
}

export interface ResearchResult {
  type: "research_results";
  query: string;
  status: "completed" | "pending" | "failed";
  items: ResearchItem[];
}

export interface ContentIdea {
  title: string;
  format: string;
  platform: string;
  rationale: string;
  difficulty: "low" | "medium" | "high";
  estimated_engagement: "low" | "medium" | "high";
}

export interface ContentIdeasResult {
  type: "content_ideas";
  topic: string;
  platform: string;
  status: "completed" | "pending" | "failed";
  ideas: ContentIdea[];
}

export interface OutreachDraft {
  medium: "email" | "linkedin" | "inmail";
  subject: string | null;
  message: string;
  tone: string;
  word_count: number;
}

export interface OutreachResult {
  type: "outreach_draft";
  lead: {
    name: string;
    company: string;
  };
  status: "completed" | "pending" | "failed";
  drafts: OutreachDraft[];
}

// Union type for all tool results
export type ToolResult = ResearchResult | ContentIdeasResult | OutreachResult;

// Helper to parse JSON tool result
export function parseToolResult(result: string | unknown): ToolResult | null {
  if (typeof result !== "string") return null;
  try {
    return JSON.parse(result) as ToolResult;
  } catch {
    return null;
  }
}
