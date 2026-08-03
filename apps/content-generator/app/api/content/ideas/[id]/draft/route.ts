import { NextRequest, NextResponse } from 'next/server';
import { getContentIdeaById, getContentDraftByIdeaId } from '@/products/content-generator/data/content-repository';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { CONTENT_TYPES, isContentType } from '@/products/content-generator/domain/content';
import { runGenerateContentDraft } from '@/products/content-generator/agent/actions/draft';

export const maxDuration = 600;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let reservationId: string | undefined;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Get contentType from request body (ideas are format-agnostic)
    const contentType = body.contentType;
    if (!contentType) {
      return NextResponse.json(
        { error: `contentType is required (${CONTENT_TYPES.join(', ')})` },
        { status: 400 }
      );
    }

    if (!isContentType(contentType)) {
      return NextResponse.json(
        { error: `Invalid contentType. Must be one of: ${CONTENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Verify idea exists
    const idea = await getContentIdeaById(id);
    if (!idea) {
      return NextResponse.json({ error: 'Content idea not found' }, { status: 404 });
    }

    // Check if idea is refined
    if (idea.status !== 'refined') {
      return NextResponse.json(
        { error: 'Idea must be refined before generating draft' },
        { status: 400 }
      );
    }

    const billing = await reserveBackgroundAction(request, 'generate_content_draft');
    reservationId = billing.commercial.creditReservationId;
    const result = await runGenerateContentDraft({
      ideaId: id,
      contentType,
    });
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'generate_content_draft', ideaId: id },
    });

    return NextResponse.json({
      success: true,
      result,
      message: `Draft generated (${contentType})`,
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Error triggering draft generation:', error);
    return NextResponse.json(
      { error: 'Failed to trigger draft generation' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get draft for this idea
    const draft = await getContentDraftByIdeaId(id);

    if (!draft) {
      return NextResponse.json({ error: 'No draft found for this idea' }, { status: 404 });
    }

    return NextResponse.json(draft);
  } catch (error) {
    console.error('Error fetching draft:', error);
    return NextResponse.json(
      { error: 'Failed to fetch draft' },
      { status: 500 }
    );
  }
}
