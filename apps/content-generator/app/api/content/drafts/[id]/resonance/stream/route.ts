import { reserveVariableCost, commercialErrorResponse } from '@content-automation/auth/commercial';
import { actionStreamResponse, streamingStructuredGenerate } from '@content-automation/platform/agents/streaming';
import { handleCreateRun } from '@content-automation/platform/resonance/provider';
import { getContentDraftById } from '@/products/content-generator/data/content-repository';
import { runGenerateContentVariation } from '@/products/content-generator/agent/actions/draft';
import {
  buildContentResonanceRunRequest,
  CONTENT_GENERATION_CREDITS_PER_VARIATION,
  resonanceProfileFor,
  resonanceExperimentRequestSchema,
  sourceCandidate,
  type ContentResonanceCandidate,
  type ContentResonanceExperimentResult,
} from '@/products/content-generator/domain/resonance-experiment';

export const maxDuration = 600;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = resonanceExperimentRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: 'Choose between 2 and 6 variations and an audience between 100 and 2,000,000.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const draft = await getContentDraftById(id);
  if (!draft) return Response.json({ error: 'Content draft not found.' }, { status: 404 });
  const profile = resonanceProfileFor(draft.type);

  const generationCredits = parsed.data.variationCount * CONTENT_GENERATION_CREDITS_PER_VARIATION;
  let reserved: Awaited<ReturnType<typeof reserveVariableCost>>;
  try {
    reserved = await reserveVariableCost(request, {
      action: 'generate_content_variations',
      credits: generationCredits,
      capability: 'content.full',
    });
  } catch (error) {
    return commercialErrorResponse(error) ?? Response.json(
      { error: 'Could not reserve credits for the variations.' },
      { status: 500 },
    );
  }

  const commercial = {
    organizationId: reserved.context.organizationId,
    initiatingUserId: reserved.context.session.user.id,
    walletUserId: reserved.context.session.user.id,
    creditReservationId: reserved.reservationId,
  };

  // Preserve the authenticated headers for the automatic handoff. Resonance
  // performs its own capability check and reserves its variable scoring cost;
  // generation and scoring therefore remain independently auditable.
  const resonanceHeaders = new Headers(request.headers);
  resonanceHeaders.delete('content-length');
  resonanceHeaders.set('content-type', 'application/json');

  return actionStreamResponse({
    action: 'generate_content_draft',
    entityId: id,
    entityType: 'content',
    commercial,
    estimatedCredits: generationCredits,
    run: async (emit) => {
      const candidates: ContentResonanceCandidate[] = [sourceCandidate(draft)];

      emit({
        type: 'data-progress',
        id: 'source',
        data: { label: 'Source content prepared', state: 'done' },
      });

      for (let index = 1; index <= parsed.data.variationCount; index += 1) {
        const eventId = `variation-${index}`;
        emit({
          type: 'data-progress',
          id: eventId,
          data: { label: `Generating variation ${index}`, state: 'running' },
        });

        const candidate = await runGenerateContentVariation(
          { sourceDraftId: id, variationIndex: index },
          { deps: { generate: streamingStructuredGenerate(emit, { eventId }) } },
        );
        candidates.push(candidate);
        emit({ type: 'data-candidate', id: eventId, data: candidate });
        emit({
          type: 'data-progress',
          id: eventId,
          data: { label: `Variation ${index} ready`, state: 'done' },
        });
      }

      emit({
        type: 'data-progress',
        id: 'audience',
        data: { label: 'Starting audience simulation', state: 'running' },
      });

      const resonanceRequest = new Request(new URL('/api/resonance/runs', request.url), {
        method: 'POST',
        headers: resonanceHeaders,
        body: JSON.stringify(buildContentResonanceRunRequest(
          candidates,
          parsed.data.audienceSize,
        )),
      });
      const response = await handleCreateRun(resonanceRequest);
      const body = await response.json().catch(() => ({})) as {
        jobId?: string;
        estimatedCells?: number;
        estimatedCredits?: number;
        error?: string;
        message?: string;
      };
      if (!response.ok || !body.jobId) {
        throw new Error(body.message ?? body.error ?? 'Audience simulation could not be started.');
      }

      emit({
        type: 'data-progress',
        id: 'audience',
        data: { label: 'Audience simulation queued', state: 'done' },
      });

      const result: ContentResonanceExperimentResult = {
        kind: 'content_resonance_experiment',
        resonanceJobId: body.jobId,
        surface: profile.surface,
        frames: [...profile.frames],
        candidates,
        variationCount: parsed.data.variationCount,
        audienceSize: parsed.data.audienceSize,
        estimatedCells: body.estimatedCells ?? 0,
        estimatedCredits: body.estimatedCredits ?? 0,
      };
      return result as unknown as Record<string, unknown>;
    },
  });
}
