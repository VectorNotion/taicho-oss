import { actionStreamResponse, streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { runGenerateContentDraft } from '@/products/content-generator/agent/actions/draft';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { contentType } = await request.json();
  const billing = await reserveBackgroundAction(request, 'generate_content_draft');
  return actionStreamResponse({
    action: 'generate_content_draft', entityId: id, entityType: 'content_idea',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runGenerateContentDraft({ ideaId: id, contentType }, { deps: { generate: streamingStructuredGenerate(emit) } }) as unknown as Promise<Record<string, unknown>>,
  });
}
