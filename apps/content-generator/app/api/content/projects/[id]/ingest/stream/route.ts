import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runBuildProjectGraph, streamingExtractEntities } from '@/products/content-generator/agent/actions/project-graph';
import { getProjectProcessingState } from '@/products/content-generator/data/project-repository';
import { reserveBackgroundAction } from '@content-automation/auth/commercial';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const billing = await reserveBackgroundAction(request, 'build_project_graph');
  return actionStreamResponse({
    action: 'build_project_graph', entityId: id, entityType: 'project',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runBuildProjectGraph({ projectId: id }, {
      extractEntities: streamingExtractEntities(emit),
      getProjectProcessingState: async (projectId) => {
        const state = await getProjectProcessingState(projectId);
        return state ? { ...state, processed: false } : null;
      },
    }) as unknown as Promise<Record<string, unknown>>,
  });
}
