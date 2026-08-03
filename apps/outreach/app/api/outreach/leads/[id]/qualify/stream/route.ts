import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runQualifyLead, streamingScorePersona } from '@/products/outreach/agent/qualify-lead';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const billing = await reserveBackgroundAction(request, 'qualify_lead');
  return actionStreamResponse({
    action: 'qualify_lead', entityId: id, entityType: 'lead',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runQualifyLead(id, { scorePersona: streamingScorePersona(emit) }) as unknown as Promise<Record<string, unknown>>,
  });
}
