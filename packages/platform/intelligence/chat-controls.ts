import { z } from 'zod';

export type ChatSource = 'auto' | 'workspace' | 'brain' | 'web' | 'funnels';
export type ChatDepth = 'quick' | 'balanced' | 'deep';
export type ChatPermission = 'read-only' | 'ask' | 'workspace-edits' | 'allow-all';
export type ChatContext = 'Projects' | 'Topics';

export interface ChatContactTarget {
  id: string;
  label: string;
  detail?: string;
}

export interface ChatControls {
  contexts: ChatContext[];
  source: ChatSource;
  depth: ChatDepth;
  permission: ChatPermission;
  contact: ChatContactTarget | null;
}

export interface ChatControlAvailability {
  contacts: boolean;
  contexts: Record<ChatContext, boolean>;
  sources: Record<ChatSource, boolean>;
  permissions: Record<ChatPermission, boolean>;
}

export const DEFAULT_CHAT_CONTROLS: ChatControls = {
  contexts: [],
  source: 'auto',
  depth: 'balanced',
  permission: 'ask',
  contact: null,
};

export const chatContactTargetSchema: z.ZodType<ChatContactTarget> = z.object({
  id: z.string().trim().min(1).max(300),
  label: z.string().max(500),
  detail: z.string().max(2_000).optional(),
});

export const chatControlsSchema = z.object({
  contexts: z.array(z.enum(['Projects', 'Topics'])).max(2).default([]),
  // One-release compatibility window: old clients may still send a model
  // control. It is accepted at the boundary and deliberately discarded.
  model: z.unknown().optional(),
  source: z.enum(['auto', 'workspace', 'brain', 'web', 'funnels']).default('auto'),
  depth: z.enum(['quick', 'balanced', 'deep']).default('balanced'),
  permission: z.enum(['read-only', 'ask', 'workspace-edits', 'allow-all']).default('ask'),
  contact: chatContactTargetSchema.nullable().default(null),
}).transform(({ model: _legacyModel, ...controls }): ChatControls => controls);
