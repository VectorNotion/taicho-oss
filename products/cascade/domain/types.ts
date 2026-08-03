export type StepType = "email" | "delay" | "branch" | "goal";

export interface EmailStepConfig {
  subject: string;
  body: string;
}

/** Email step referencing a composed email record instead of inline copy. */
export interface EmailRefStepConfig {
  emailId: string;
}

export interface DelayStepConfig {
  /** Non-negative. Phase 1 ignores timezone/quiet hours (Phase 2 concern). */
  seconds: number;
}

export type BranchCondition =
  | { kind: "event"; type: "open" | "click" | "interest" }
  | { kind: "attribute"; key: string; equals: string };

export interface BranchStepConfig {
  condition: BranchCondition;
  thenPosition: number;
  elsePosition: number;
}

export interface GoalStepConfig {
  outcome?: RouteOutcome;
}

export type StepInput =
  | { type: "email"; config: EmailStepConfig | EmailRefStepConfig }
  | { type: "delay"; config: DelayStepConfig }
  | { type: "branch"; config: BranchStepConfig }
  | { type: "goal"; config: GoalStepConfig };

export interface Funnel {
  id: string;
  name: string;
  version: number;
  openEnded: boolean;
}

export interface FunnelStep {
  id: string;
  funnelId: string;
  position: number;
  type: StepType;
  config: EmailStepConfig | DelayStepConfig;
}

export interface Contact {
  id: string;
  email: string;
  timezone: string | null;
  attributes: Record<string, unknown>;
  subscriptionStatus: "subscribed" | "unsubscribed" | "suppressed";
  workspaceContactId: string | null;
  /** @deprecated Use workspaceContactId. Kept for stored-data compatibility. */
  outreachLeadId: string | null;
}

export interface EmailRecord {
  id: string;
  name: string;
  templateId: string;
  contentId: string;
  fromEmail: string;
  fromName: string | null;
  interestUrl: string | null;
}

export interface AssetInput {
  sourceId: string;
  type: string;
  title: string;
  url: string;
  topics: string[];
  publishedAt?: Date;
}

export type RouteOutcome = "completed" | "interest";

export type EnrollmentState = "active" | "completed" | "stopped";

export interface Enrollment {
  id: string;
  funnelId: string;
  contactId: string;
  currentStepId: string | null;
  state: EnrollmentState;
  nextRunAt: Date;
}
