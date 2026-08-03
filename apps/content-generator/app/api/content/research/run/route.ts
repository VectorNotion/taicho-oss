import { NextRequest, NextResponse } from 'next/server';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runDoResearch } from '@/products/content-generator/agent/actions/research';

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  let reservationId: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    const { sourceIds, timeRange } = body;

    const billing = await reserveBackgroundAction(request, 'do_research');
    reservationId = billing.commercial.creditReservationId;
    const result = await runDoResearch({
      sourceIds: sourceIds || [],
      timeRange: timeRange || 'week',
    });
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'do_research' },
    });

    return NextResponse.json({
      result,
      message: 'Research completed.',
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Research job error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start research job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
