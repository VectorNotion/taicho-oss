import { NextRequest, NextResponse } from 'next/server';
import { getLeadById, getLeadResearch } from '@/products/outreach/data/lead-repository';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { buildResearchInput, runLeadResearch } from '@/products/outreach/agent/lead-research';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const research = await getLeadResearch(id);

    if (!research) {
      return NextResponse.json(null);
    }

    return NextResponse.json(research);
  } catch (error) {
    console.error('Get lead research error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get lead research',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let reservationId: string | undefined;
  try {
    const { id } = await params;

    // Verify lead exists
    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const billing = await reserveBackgroundAction(request, 'research_lead');
    reservationId = billing.commercial.creditReservationId;
    const result = await runLeadResearch(buildResearchInput(lead));
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'research_lead', leadId: id },
    });

    return NextResponse.json({
      result,
      message: 'Lead research completed.',
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Research lead job error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start research job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
