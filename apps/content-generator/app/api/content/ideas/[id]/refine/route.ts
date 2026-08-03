import { NextRequest, NextResponse } from 'next/server';
import { getContentIdeaById } from '@/products/content-generator/data/content-repository';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runRefineContentIdea } from '@/products/content-generator/agent/actions/refine';

export const maxDuration = 600;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let reservationId: string | undefined;
  try {
    const { id } = await params;

    // Verify idea exists
    const idea = await getContentIdeaById(id);
    if (!idea) {
      return NextResponse.json({ error: 'Content idea not found' }, { status: 404 });
    }

    // Check if already refined
    if (idea.status === 'refined') {
      return NextResponse.json(
        { error: 'Idea is already refined' },
        { status: 400 }
      );
    }

    const billing = await reserveBackgroundAction(request, 'refine_content_idea');
    reservationId = billing.commercial.creditReservationId;
    const result = await runRefineContentIdea({ ideaId: id });
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'refine_content_idea', ideaId: id },
    });

    return NextResponse.json({
      success: true,
      result,
      message: 'Idea refined',
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Error triggering refine:', error);
    return NextResponse.json(
      { error: 'Failed to trigger refine' },
      { status: 500 }
    );
  }
}
