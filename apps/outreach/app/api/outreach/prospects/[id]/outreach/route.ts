import { NextRequest, NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';
import { getProspectById, getProspectOutreach, createOutreachMessage } from '@/products/outreach/data/prospect-repository';
import { generateOutreach } from '@/products/outreach/agent/generator';
import type { OutreachMedium } from '@/products/outreach/domain/types';
import { commercialErrorResponse, reserveVariableCost } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const maxDuration = 300;
const OUTREACH_TIMEOUT_MS = 3 * 60_000;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// GET /api/outreach/prospects/[id]/outreach - List all outreach messages for a prospect
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
   try {
    const { id } = await params;

    // Verify prospect exists
    const prospect = await getProspectById(id);
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404, headers: corsHeaders });
    }

    const messages = await getProspectOutreach(id);
    return NextResponse.json(messages, { headers: corsHeaders });
   } catch (error) {
    console.error('Error fetching outreach messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outreach messages' },
      { status: 500, headers: corsHeaders }
    );
   }
  }, { headers: corsHeaders });
}

// POST /api/outreach/prospects/[id]/outreach - Create or generate an outreach message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
   let reservationId: string | null = null;
   try {
    const { id } = await params;
    const body = await request.json();
    const { medium, content, subject, targetContent, generate } = body;

    // Validate medium
    const validMediums = ['inmail', 'inmail_traditional', 'email', 'content_comment'];
    if (!medium || !validMediums.includes(medium)) {
      return NextResponse.json(
        { error: `Invalid medium. Must be one of: ${validMediums.join(', ')}` },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify prospect exists
    const prospect = await getProspectById(id);
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404, headers: corsHeaders });
    }

    // If generate flag is set, generate outreach using Mastra agent
    if (generate) {
      const billing = await reserveVariableCost(request, { action: 'generate_outreach', credits: 30, capability: 'outreach' }); reservationId = billing.reservationId;
      const result = await generateOutreach({
        prospectId: id,
        medium: medium as OutreachMedium,
        targetContent,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(OUTREACH_TIMEOUT_MS)]),
      });

      if (!result.success) {
        await releaseReservation(reservationId); reservationId = null;
        return NextResponse.json(
          { error: result.error || 'Failed to generate outreach' },
          { status: 500, headers: corsHeaders }
        );
      }

      await settleReservation({ reservationId, actualCredits: billing.estimatedCredits, idempotencyKey: `outreach:${reservationId}`, usageKind: 'agent_action' });

      return NextResponse.json(result.message, { status: 201, headers: corsHeaders });
    }

    // Otherwise, create a manual outreach message
    if (!content) {
      return NextResponse.json(
        { error: 'Content is required when not generating' },
        { status: 400, headers: corsHeaders }
      );
    }

    const message = await createOutreachMessage({
      prospectId: id,
      medium,
      content,
      subject,
      targetContent,
      status: 'draft',
    });

    return NextResponse.json(message, { status: 201, headers: corsHeaders });
   } catch (error) {
    if (reservationId) await releaseReservation(reservationId).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    console.error('Outreach creation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to create outreach message',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
   }
  }, { headers: corsHeaders });
}
