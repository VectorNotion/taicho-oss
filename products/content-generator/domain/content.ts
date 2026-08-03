/**
 * Content pipeline types for ideas, drafts, and published content.
 */

/**
 * Formats the content pipeline can generate.
 *
 * Keep this tuple as the single machine-readable registry of type ids. API
 * validation, MCP schemas, generation, and UI labels all derive from it so a
 * new format cannot quietly exist in only one surface.
 */
export const CONTENT_TYPES = [
  "video_script",
  "blog_post",
  "x_post",
  "tweet_thread",
  "linkedin_post",
  "social_post",
  "ad_campaign",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export type ContentStatus = "idea" | "refined" | "draft" | "ready" | "published";

export type ContentPriority = "low" | "medium" | "high";

export type ContentPlatform = "youtube" | "blog" | "x" | "linkedin" | "social" | "ads";

export type PerformanceLevel = "low" | "medium" | "high";

// ============= CONTENT IDEAS =============

export interface ContentIdea {
  id: string;
  title: string;
  description: string;
  rationale: string;
  priority: ContentPriority;
  status: "idea" | "refined";
  // Ideas are format-agnostic - type is only on drafts

  // Refinement data (populated after refine step)
  outline?: string[];
  keyPoints?: string[];
  suggestedCitations?: string[];

  // Source relationships
  sourceTopics?: Array<{ id: string; name: string }>;
  sourceResearch?: Array<{ id: string; title: string }>;

  createdAt: string;
  updatedAt: string;
}

export interface CreateContentIdeaInput {
  title: string;
  description: string;
  rationale: string;
  priority?: ContentPriority;
  sourceTopicIds?: string[];
  sourceResearchIds?: string[];
}

export interface UpdateContentIdeaInput {
  title?: string;
  description?: string;
  rationale?: string;
  priority?: ContentPriority;
  status?: "idea" | "refined";
  outline?: string[];
  keyPoints?: string[];
  suggestedCitations?: string[];
}

export interface ContentIdeaFilters {
  status?: "idea" | "refined";
  priority?: ContentPriority;
  search?: string;
}

// ============= CONTENT DRAFTS =============

export interface ContentDraft {
  id: string;
  ideaId: string;
  title: string;
  type: ContentType;
  content: string;
  status: "draft" | "ready" | "published";

  // Publishing info
  scheduledFor?: string;
  publishedAt?: string;
  publishedUrl?: string;

  // Performance tracking
  performanceLevel?: PerformanceLevel;
  performanceInsights?: string;

  // Relationships
  citations?: string[];
  innerLinks?: string[];

  createdAt: string;
  updatedAt: string;
}

export interface CreateContentDraftInput {
  ideaId: string;
  title: string;
  type: ContentType;
  content: string;
  citations?: string[];
  innerLinks?: string[];
}

export interface UpdateContentDraftInput {
  title?: string;
  content?: string;
  status?: "draft" | "ready" | "published";
  scheduledFor?: string | null;
  publishedAt?: string;
  publishedUrl?: string;
  performanceLevel?: PerformanceLevel;
  performanceInsights?: string;
}

export interface ContentDraftFilters {
  status?: "draft" | "ready" | "published";
  type?: ContentType;
  ideaId?: string;
  search?: string;
}

// ============= CONFIG =============

export const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  {
    label: string;
    shortLabel: string;
    icon: string;
    color: string;
    description: string;
  }
> = {
  video_script: {
    label: "YouTube video script",
    shortLabel: "YouTube",
    icon: "Video",
    color: "text-muted-foreground",
    description: "A complete script with hook, sections, production notes, and CTA.",
  },
  blog_post: {
    label: "Blog post",
    shortLabel: "Blog",
    icon: "FileText",
    color: "text-muted-foreground",
    description: "A long-form MDX article with sections, citations, and internal links.",
  },
  x_post: {
    label: "X post",
    shortLabel: "X post",
    icon: "AtSign",
    color: "text-muted-foreground",
    description: "A standalone post written for X's concise feed format.",
  },
  tweet_thread: {
    label: "X thread",
    shortLabel: "X thread",
    icon: "ListTree",
    color: "text-muted-foreground",
    description: "A connected sequence of five to ten posts for X.",
  },
  linkedin_post: {
    label: "LinkedIn post",
    shortLabel: "LinkedIn",
    icon: "Linkedin",
    color: "text-muted-foreground",
    description: "A professional feed post designed for thought leadership.",
  },
  social_post: {
    label: "Social post",
    shortLabel: "Social",
    icon: "MessageSquareText",
    color: "text-muted-foreground",
    description: "Channel-neutral social copy with a hook, body, CTA, and hashtags.",
  },
  ad_campaign: {
    label: "Ad campaign",
    shortLabel: "Ad",
    icon: "Megaphone",
    color: "text-muted-foreground",
    description: "Structured campaign copy with headline, primary text, description, and CTA.",
  },
};

export function isContentType(value: unknown): value is ContentType {
  return typeof value === "string" && (CONTENT_TYPES as readonly string[]).includes(value);
}

export const CONTENT_STATUS_CONFIG: Record<
  ContentStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  idea: { label: "Idea", variant: "secondary" },
  refined: { label: "Refined", variant: "outline" },
  draft: { label: "Draft", variant: "default" },
  ready: { label: "Ready", variant: "default" },
  published: { label: "Published", variant: "default" },
};

export const CONTENT_PRIORITY_CONFIG: Record<
  ContentPriority,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  low: { label: "Low", variant: "secondary" },
  medium: { label: "Medium", variant: "outline" },
  high: { label: "High", variant: "destructive" },
};

export const CONTENT_PLATFORM_CONFIG: Record<
  ContentPlatform,
  { label: string; icon: string }
> = {
  youtube: { label: "YouTube", icon: "Youtube" },
  blog: { label: "Blog", icon: "Globe" },
  x: { label: "X", icon: "AtSign" },
  linkedin: { label: "LinkedIn", icon: "Linkedin" },
  social: { label: "Social", icon: "MessageSquareText" },
  ads: { label: "Ads", icon: "Megaphone" },
};

export const PERFORMANCE_LEVEL_CONFIG: Record<
  PerformanceLevel,
  { label: string; color: string }
> = {
  low: { label: "Low", color: "text-red-500" },
  medium: { label: "Medium", color: "text-yellow-500" },
  high: { label: "High", color: "text-green-500" },
};
