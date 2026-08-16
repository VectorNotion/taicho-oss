import { z } from 'zod';

const scopedEntityIdSchema = z.string().trim().min(1).max(300);

/**
 * The durable context a Taicho conversation belongs to. Keep this allow-list
 * explicit as new embedded chat surfaces are introduced.
 */
export const chatThreadScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('main') }).strict(),
  z.object({
    type: z.literal('lead'),
    id: scopedEntityIdSchema,
  }).strict(),
]);

export type ChatThreadScope = z.infer<typeof chatThreadScopeSchema>;

export const MAIN_CHAT_THREAD_SCOPE: ChatThreadScope = Object.freeze({
  type: 'main',
});

export function parseChatThreadScope(input: unknown): ReturnType<typeof chatThreadScopeSchema.safeParse> {
  return chatThreadScopeSchema.safeParse(input ?? MAIN_CHAT_THREAD_SCOPE);
}

export function chatThreadScopeFromSearchParams(searchParams: URLSearchParams) {
  const type = searchParams.get('scopeType') ?? 'main';
  return parseChatThreadScope(
    type === 'lead'
      ? { type, id: searchParams.get('scopeId') }
      : { type },
  );
}

export function chatThreadScopeSearchParams(scope: ChatThreadScope): URLSearchParams {
  const searchParams = new URLSearchParams({ scopeType: scope.type });
  if (scope.type === 'lead') searchParams.set('scopeId', scope.id);
  return searchParams;
}

export function chatThreadScopeKey(scope: ChatThreadScope): string {
  return scope.type === 'main' ? 'main' : `lead:${scope.id}`;
}

/**
 * Main keeps the historical resource key so existing workspace Chat history is
 * preserved. Entity conversations get their own tenant- and actor-bound key.
 */
export function chatThreadResourceId(input: {
  organizationId: string;
  userId: string;
  scope: ChatThreadScope;
}): string {
  const owner = `${input.organizationId}:${input.userId}`;
  if (input.scope.type === 'main') return owner;
  return `${owner}:lead:${encodeURIComponent(input.scope.id)}`;
}

export function chatThreadScopeMetadata(scope: ChatThreadScope): Record<string, string> {
  return scope.type === 'main'
    ? { chatScopeType: 'main' }
    : { chatScopeType: 'lead', chatScopeId: scope.id };
}
