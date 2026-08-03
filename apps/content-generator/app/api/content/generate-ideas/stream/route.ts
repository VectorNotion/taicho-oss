import { actionStreamResponse, streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { runGenerateContentIdeas } from '@/products/content-generator/agent/actions/ideas';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request) {
  const { count = 5 } = await request.json().catch(() => ({}));
  const billing = await reserveBackgroundAction(request, 'generate_content_ideas');
  return actionStreamResponse({
    action: 'generate_content_ideas', entityId: 'batch', entityType: 'content',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runGenerateContentIdeas({ count }, { deps: { generate: streamingStructuredGenerate(emit) } }) as unknown as Promise<Record<string, unknown>>,
  });
}
