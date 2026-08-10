export type ActionItemStatus = "open" | "done" | "dismissed";
export type ActionItemSource = "manual" | "auto_followup";

export const FOLLOW_UP_DEFAULT_DAYS = 3;

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
