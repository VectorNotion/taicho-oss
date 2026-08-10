import { NextRequest, NextResponse } from 'next/server';
import { getProspectById, getLegacyQualification } from '@/products/outreach/data/prospect-repository';
import { getProspectQualification } from '@/products/outreach/data/qualification-repository';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { runQualifyProspect } from '@/products/outreach/agent/qualify-prospect';
import { withProspectOrg } from '@/lib/prospect-scope';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await ctx.params;

      // New dimension-based qualification first; legacy flat score as fallback
      // for prospects qualified before the ICP/Persona/Timing pipeline existed.
      const [prospect, legacy] = await Promise.all([
        getProspectQualification(id),
        getLegacyQualification(id),
      ]);

      if (!prospect && !legacy) {
        return NextResponse.json(null);
      }

      return NextResponse.json({ prospect, legacy });
    } catch (error) {
      console.error('Get prospect qualification error:', error);
      return NextResponse.json(
        {
          error: 'Failed to get prospect qualification',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  });
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
    let reservationId: string | undefined;
    try {
      const { id } = await ctx.params;

      // Verify prospect exists
      const prospect = await getProspectById(id);
      if (!prospect) {
        return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
      }

      const billing = await reserveBackgroundAction(request, 'qualify_prospect');
      reservationId = billing.commercial.creditReservationId;
      const result = await runQualifyProspect(id);
      await settleReservation({
        reservationId,
        actualCredits: billing.estimatedCredits,
        idempotencyKey: `api:${reservationId}:settlement`,
        usageKind: 'agent_action',
        metadata: { action: 'qualify_prospect', prospectId: id },
      });

      return NextResponse.json({
        result,
        message: 'Prospect qualification completed.',
      });
    } catch (error) {
      if (reservationId) await releaseReservation(reservationId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
      const commercial = commercialErrorResponse(error); if (commercial) return commercial;
      console.error('Qualify prospect job error:', error);
      return NextResponse.json(
        {
          error: 'Failed to start qualification job',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  });
}
