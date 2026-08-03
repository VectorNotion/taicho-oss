import { NextRequest, NextResponse } from 'next/server';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runGenerateContentIdeas } from '@/products/content-generator/agent/actions/ideas';

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  let reservationId: string | undefined;
  try {
    const body = await request.json();
    const count = body.count ?? 5;

    const billing = await reserveBackgroundAction(request, 'generate_content_ideas');
    reservationId = billing.commercial.creditReservationId;
    const result = await runGenerateContentIdeas({ count });
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'generate_content_ideas' },
    });

    return NextResponse.json({
      success: true,
      result,
      message: `Generated ${count} content ideas`,
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Error triggering idea generation:', error);
    return NextResponse.json(
      { error: 'Failed to trigger idea generation' },
      { status: 500 }
    );
  }
}
