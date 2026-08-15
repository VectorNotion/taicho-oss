export type ActionItemStatus = "open" | "done" | "dismissed";
export type ActionItemSource = "manual" | "auto_followup";

export const FOLLOW_UP_DEFAULT_DAYS = 3;
export const DEFAULT_FOLLOW_UP_CADENCE_KEY = "default-3-day";
export const DEFAULT_FOLLOW_UP_CADENCE_VERSION = 1;

export type FollowUpGenerationType = "initial" | "follow_up";

export interface GeneratedFollowUpPayload extends Record<string, unknown> {
  automationKind: "generated_outreach_follow_up";
  cadenceKey: string;
  cadenceVersion: number;
  cadenceDays: number;
  triggerMessageId: string;
  triggerMedium: string;
  generationType: FollowUpGenerationType;
}

export interface ActionItem {
  id: string;
  title: string;
  status: ActionItemStatus;
  dueAt: string; // ISO timestamp
  source: ActionItemSource;
  prospectId: string | null;
  accountId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateActionItemInput {
  title: string;
  dueAt: string;
  source?: ActionItemSource;
  prospectId?: string;
  accountId?: string;
  payload?: Record<string, unknown>;
}

export interface UpdateActionItemInput {
  title?: string;
  dueAt?: string;
}

export function generatedFollowUpPayload(input: {
  messageId: string;
  medium: string;
  generationType: FollowUpGenerationType;
  cadenceKey?: string;
  cadenceVersion?: number;
  cadenceDays?: number;
}): GeneratedFollowUpPayload {
  return {
    automationKind: "generated_outreach_follow_up",
    cadenceKey: input.cadenceKey ?? DEFAULT_FOLLOW_UP_CADENCE_KEY,
    cadenceVersion: input.cadenceVersion ?? DEFAULT_FOLLOW_UP_CADENCE_VERSION,
    cadenceDays: input.cadenceDays ?? FOLLOW_UP_DEFAULT_DAYS,
    triggerMessageId: input.messageId,
    triggerMedium: input.medium,
    generationType: input.generationType,
  };
}
