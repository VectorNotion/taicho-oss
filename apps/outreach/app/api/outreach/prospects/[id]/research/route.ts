import { NextRequest, NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';
import { getProspectById, getProspectResearch } from '@/products/outreach/data/prospect-repository';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runProspectResearch } from '@/products/outreach/agent/prospect-research';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
   try {
    const { id } = await params;

    const research = await getProspectResearch(id);

    if (!research) {
      return NextResponse.json(null);
    }

    return NextResponse.json(research);
   } catch (error) {
    console.error('Get prospect research error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get prospect research',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
   }
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
   let reservationId: string | undefined;
   try {
    const { id } = await params;

    // Verify prospect exists
    const prospect = await getProspectById(id);
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }

    const billing = await reserveBackgroundAction(request, 'research_prospect');
    reservationId = billing.commercial.creditReservationId;
    const result = await runProspectResearch(id);
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'research_prospect', prospectId: id },
    });

    return NextResponse.json({
      result,
      message: 'Prospect research completed.',
    });
   } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Research prospect job error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start research job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
   }
  });
}
