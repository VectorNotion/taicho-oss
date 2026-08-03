import type { ModelSelectionKey } from '../models/catalog';

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
  model: ModelSelectionKey;
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
  model: 'auto',
  source: 'auto',
  depth: 'balanced',
  permission: 'ask',
  contact: null,
};
