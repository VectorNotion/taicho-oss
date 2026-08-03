import { NextRequest, NextResponse } from 'next/server';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runExtractTopics } from '@/products/content-generator/agent/actions/topics';

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  let reservationId: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    const { daysBack } = body;

    const billing = await reserveBackgroundAction(request, 'extract_topics');
    reservationId = billing.commercial.creditReservationId;
    const result = await runExtractTopics();
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'extract_topics', daysBack: daysBack || 30 },
    });

    return NextResponse.json({
      result,
      message: 'Topic extraction completed.',
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Topic extraction job error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start topic extraction job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
