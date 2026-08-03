import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { makeDefaultResearchDeps, runDoResearch, streamingGenerateItems } from '@/products/content-generator/agent/actions/research';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const billing = await reserveBackgroundAction(request, 'do_research');
  return actionStreamResponse({
    action: 'do_research', entityId: 'research', entityType: 'research',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runDoResearch({ sourceIds: body.sourceIds ?? [], timeRange: body.timeRange ?? 'week' }, {
      deps: { ...makeDefaultResearchDeps(), generateItems: streamingGenerateItems(emit) },
    }) as unknown as Promise<Record<string, unknown>>,
  });
}
