/**
 * Lead management types for outreach pipeline.
 */

export type LeadStatus =
  | "new"
  | "researched"
  | "contacted"
  | "replied"
  | "unresponsive"
  | "qualified"
  | "converted";

export type LeadSource = "manual" | "sales_navigator";

export type LeadPriority = "low" | "medium" | "high";

// Lead notes (user-entered, timestamped)
export interface LeadNote {
  id: string;
  content: string; // Rich text HTML from TipTap
  createdAt: string;
  updatedAt?: string;
}

export interface Lead {
  id: string;

  // Core info
  name: string;
  company?: string;
  title?: string;
  location?: string;
  photoUrl?: string;

  // Contact info
  email?: string;
  phone?: string;

  // Social profiles
  linkedinUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;

  // Classification
  status: LeadStatus;
  source: LeadSource;
  sourceProvider?: string;
  nameWasDerived?: boolean;
  priority: LeadPriority;
  tags: string[];
  customAttributes?: Record<string, string | number | boolean | string[]>;
  revision?: number;

  // Context
  about?: string; // LinkedIn bio (from Sales Navigator capture)
  notes?: LeadNote[]; // User-entered notes with timestamps
  referredBy?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastContactedAt?: string;
}

export interface CreateLeadInput {
  name: string;
  company?: string;
  title?: string;
  location?: string;
  photoUrl?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  source: LeadSource;
  status?: LeadStatus;
  sourceProvider?: string;
  nameWasDerived?: boolean;
  priority?: LeadPriority;
  tags?: string[];
  customAttributes?: Record<string, string | number | boolean | string[]>;
  about?: string; // LinkedIn bio (from Sales Navigator)
  referredBy?: string;
  lastContactedAt?: string;
}

export interface UpdateLeadInput {
  name?: string;
  company?: string;
  title?: string;
  location?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  status?: LeadStatus;
  source?: LeadSource;
  sourceProvider?: string;
  nameWasDerived?: boolean;
  priority?: LeadPriority;
  tags?: string[];
  customAttributes?: Record<string, string | number | boolean | string[]>;
  about?: string; // LinkedIn bio
  referredBy?: string;
  lastContactedAt?: string;
}

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  priority?: LeadPriority;
  search?: string;
}

// Status display configuration
export const LEAD_STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { label: "New", variant: "secondary" },
  researched: { label: "Researched", variant: "secondary" },
  contacted: { label: "Contacted", variant: "secondary" },
  replied: { label: "Replied", variant: "default" },
  unresponsive: { label: "Unresponsive", variant: "destructive" },
  qualified: { label: "Qualified", variant: "default" },
  converted: { label: "Converted", variant: "default" },
};

export const LEAD_PRIORITY_CONFIG: Record<
  LeadPriority,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  low: { label: "Low", variant: "outline" },
  medium: { label: "Medium", variant: "outline" },
  high: { label: "High", variant: "outline" },
};

export const LEAD_SOURCE_CONFIG: Record<LeadSource, { label: string }> = {
  manual: { label: "Manual" },
  sales_navigator: { label: "Sales Navigator" },
};

// Outreach message types
export type OutreachMedium = "inmail" | "inmail_traditional" | "email" | "content_comment";

export type OutreachStatus = "draft" | "sent";

export interface OutreachMessage {
  id: string;
  leadId: string;
  medium: OutreachMedium;
  subject?: string; // For email/inmail
  content: string;
  targetContent?: string; // For content_comment: the content being commented on
  landingPageUrl?: string; // For inmail: generated landing page URL
  landingPageSlug?: string; // For inmail: generated landing page slug
  reportId?: string; // For inmail: Payload CMS report ID (for deletion)
  linkedContentId?: string; // For inmail_traditional: matched ContentDraft ID
  linkedContentUrl?: string; // For inmail_traditional: URL of matched content
  status: OutreachStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export interface OutreachMessageWithLead {
  message: OutreachMessage;
  lead: Pick<Lead, "id" | "name" | "company" | "title" | "email">;
}

export interface CreateOutreachInput {
  leadId: string;
  medium: OutreachMedium;
  subject?: string;
  content: string;
  targetContent?: string;
  landingPageUrl?: string;
  landingPageSlug?: string;
  reportId?: string;
  linkedContentId?: string;
  linkedContentUrl?: string;
  status?: OutreachStatus;
}

export interface UpdateOutreachInput {
  subject?: string;
  content?: string;
  targetContent?: string;
  status?: OutreachStatus;
  sentAt?: string;
}

export const OUTREACH_MEDIUM_CONFIG: Record<
  OutreachMedium,
  { label: string; icon: string }
> = {
  inmail: { label: "Personalized InMail", icon: "Linkedin" },
  inmail_traditional: { label: "Traditional InMail", icon: "Linkedin" },
  email: { label: "Email", icon: "Mail" },
  content_comment: { label: "Content comment", icon: "MessageSquare" },
};

export const OUTREACH_STATUS_CONFIG: Record<
  OutreachStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent externally", variant: "default" },
};

// Research types
export type InsightCategory =
  | "overview"
  | "products"
  | "culture"
  | "recent_news"
  | "ai_initiatives";

export interface CompanyInsight {
  id: string;
  category: InsightCategory;
  content: string;
  sourceUrl?: string;
  createdAt: string;
}

export interface CompetitorInfo {
  name: string;
  relevance: string;
  aiFocus?: string;
  recentNews?: string;
}

export interface LeadResearch {
  leadId: string;
  industry: string;
  companySummary: string;
  talkingPoints: string[];
  outreachAngle: string;
  companyInsights: CompanyInsight[];
  competitors: CompetitorInfo[];
  updatedAt: string;
}

export const INSIGHT_CATEGORY_CONFIG: Record<
  InsightCategory,
  { label: string }
> = {
  overview: { label: "Overview" },
  products: { label: "Products" },
  culture: { label: "Culture" },
  recent_news: { label: "Recent news" },
  ai_initiatives: { label: "AI initiatives" },
};

// ============= LEAD ACTIVITIES =============

export type LeadActivityType =
  | "reaction_sent"
  | "comment_sent"
  | "connection_request_sent"
  | "connection_accepted"
  | "outreach_sent"
  | "reply_received"
  | "call"
  | "meeting"
  | "observation"
  | "enrichment"
  | "nurture_enrolled"
  | "note"
  | "status_change";

export interface LeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  title: string;
  notes?: string;
  metadata?: {
    oldStatus?: string;
    newStatus?: string;
    outreachMedium?: string;
    outreachMessageId?: string;
    platform?: string;
    reaction?: string;
    postUrl?: string;
    funnelId?: string;
    funnelName?: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface CreateActivityInput {
  type: LeadActivityType;
  title: string;
  notes?: string;
  metadata?: {
    oldStatus?: string;
    newStatus?: string;
    outreachMedium?: string;
    outreachMessageId?: string;
    platform?: string;
    reaction?: string;
    postUrl?: string;
    funnelId?: string;
    funnelName?: string;
  };
}

export interface UpdateActivityInput {
  title?: string;
  notes?: string;
  metadata?: {
    oldStatus?: string;
    newStatus?: string;
    outreachMedium?: string;
    outreachMessageId?: string;
    platform?: string;
    reaction?: string;
    postUrl?: string;
    funnelId?: string;
    funnelName?: string;
  };
}

export const ACTIVITY_TYPE_CONFIG: Record<
  LeadActivityType,
  { label: string; color: string; bgColor: string }
> = {
  reaction_sent: { label: "Reaction sent", color: "text-sky-600", bgColor: "bg-sky-500/10" },
  comment_sent: { label: "Comment sent", color: "text-violet-600", bgColor: "bg-violet-500/10" },
  connection_request_sent: { label: "Connection request", color: "text-blue-600", bgColor: "bg-blue-500/10" },
  connection_accepted: { label: "Connection accepted", color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  outreach_sent: { label: "Outreach sent", color: "text-muted-foreground", bgColor: "bg-muted" },
  reply_received: { label: "Reply received", color: "text-chart-2", bgColor: "bg-chart-2/10" },
  call: { label: "Call", color: "text-muted-foreground", bgColor: "bg-muted" },
  meeting: { label: "Meeting", color: "text-muted-foreground", bgColor: "bg-muted" },
  observation: { label: "Observation", color: "text-muted-foreground", bgColor: "bg-muted" },
  enrichment: { label: "Research", color: "text-muted-foreground", bgColor: "bg-muted" },
  nurture_enrolled: { label: "Added to funnel", color: "text-chart-2", bgColor: "bg-chart-2/10" },
  note: { label: "Note", color: "text-muted-foreground", bgColor: "bg-muted" },
  status_change: { label: "Status change", color: "text-muted-foreground", bgColor: "bg-muted" },
};

// ============= PERSONAS =============

export interface Persona {
  id: string;
  name: string; // e.g., "AI-Curious CTO"
  description: string;
  targetTitles: string[]; // ["CTO", "VP Engineering", "Head of AI"]
  companySizeMin?: number;
  companySizeMax?: number;
  fundingStages?: string[]; // ["Series A", "Series B"]
  targetDomains?: string[]; // ["SaaS", "FinTech"]
  signals: string[]; // ["AI interest", "scaling challenges"]
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreatePersonaInput {
  name: string;
  description: string;
  targetTitles: string[];
  companySizeMin?: number;
  companySizeMax?: number;
  fundingStages?: string[];
  targetDomains?: string[];
  signals: string[];
  isActive?: boolean;
}

export interface UpdatePersonaInput {
  name?: string;
  description?: string;
  targetTitles?: string[];
  companySizeMin?: number;
  companySizeMax?: number;
  fundingStages?: string[];
  targetDomains?: string[];
  signals?: string[];
  isActive?: boolean;
}

// ============= LEAD QUALIFICATION =============

export interface LeadQualification {
  id: string;
  leadId: string;
  matchedPersonaId: string;
  matchedPersonaName: string;
  score: number; // 0-100
  notes: string; // LLM explanation
  qualifiedAt: string;
}

export interface CreateQualificationInput {
  matchedPersonaId: string;
  matchedPersonaName: string;
  score: number;
  notes: string;
}
