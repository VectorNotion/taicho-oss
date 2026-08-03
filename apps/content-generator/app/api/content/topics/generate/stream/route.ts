import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { makeDefaultTopicsDeps, runExtractTopics, streamingGenerateTopics } from '@/products/content-generator/agent/actions/topics';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request) {
  const billing = await reserveBackgroundAction(request, 'extract_topics');
  return actionStreamResponse({
    action: 'extract_topics', entityId: 'topics', entityType: 'topic',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runExtractTopics({ deps: { ...makeDefaultTopicsDeps(), generateTopics: streamingGenerateTopics(emit) } }) as unknown as Promise<Record<string, unknown>>,
  });
}
