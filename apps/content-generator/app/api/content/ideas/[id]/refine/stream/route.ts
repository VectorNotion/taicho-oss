import { actionStreamResponse, streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { runRefineContentIdea } from '@/products/content-generator/agent/actions/refine';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const billing = await reserveBackgroundAction(request, 'refine_content_idea');
  return actionStreamResponse({
    action: 'refine_content_idea', entityId: id, entityType: 'content_idea',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runRefineContentIdea({ ideaId: id }, { deps: { generate: streamingStructuredGenerate(emit) } }) as unknown as Promise<Record<string, unknown>>,
  });
}
