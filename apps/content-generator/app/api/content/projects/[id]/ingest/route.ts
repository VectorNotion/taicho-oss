import { NextRequest, NextResponse } from 'next/server';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runBuildProjectGraph } from '@/products/content-generator/agent/actions/project-graph';

export const maxDuration = 600;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let reservationId: string | undefined;
  try {
    const { id: projectId } = await params;

    const billing = await reserveBackgroundAction(request, 'build_project_graph');
    reservationId = billing.commercial.creditReservationId;
    const result = await runBuildProjectGraph({ projectId });
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'build_project_graph', projectId },
    });

    return NextResponse.json({
      result,
      message: 'Project extraction completed.',
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Project ingestion error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start ingestion job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
