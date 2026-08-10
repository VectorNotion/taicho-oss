import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runQualifyProspect, streamingQualifyProgress } from '@/products/outreach/agent/qualify-prospect';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const billing = await reserveBackgroundAction(request, 'qualify_prospect');
  return actionStreamResponse({
    action: 'qualify_prospect', entityId: id, entityType: 'prospect',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runQualifyProspect(id, { onProgress: streamingQualifyProgress(emit) }) as unknown as Promise<Record<string, unknown>>,
  });
}
