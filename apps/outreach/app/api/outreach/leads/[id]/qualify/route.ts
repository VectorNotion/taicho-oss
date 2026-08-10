import { NextRequest, NextResponse } from 'next/server';
import { getLeadById, getLeadQualification } from '@/products/outreach/data/lead-repository';
import { getProspectQualification } from '@/products/outreach/data/qualification-repository';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runQualifyLead } from '@/products/outreach/agent/qualify-lead';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // New dimension-based qualification first; legacy flat score as fallback
    // for leads qualified before the ICP/Persona/Timing pipeline existed.
    const [prospect, legacy] = await Promise.all([
      getProspectQualification(id),
      getLeadQualification(id),
    ]);

    if (!prospect && !legacy) {
      return NextResponse.json(null);
    }

    return NextResponse.json({ prospect, legacy });
  } catch (error) {
    console.error('Get lead qualification error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get lead qualification',
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

    const billing = await reserveBackgroundAction(request, 'qualify_lead');
    reservationId = billing.commercial.creditReservationId;
    const result = await runQualifyLead(id);
    await settleReservation({
      reservationId,
      actualCredits: billing.estimatedCredits,
      idempotencyKey: `api:${reservationId}:settlement`,
      usageKind: 'agent_action',
      metadata: { action: 'qualify_lead', leadId: id },
    });

    return NextResponse.json({
      result,
      message: 'Lead qualification completed.',
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Qualify lead job error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start qualification job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
