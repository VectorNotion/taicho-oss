import { NextRequest, NextResponse } from 'next/server';
import { getLeadById, getLeadOutreach, createOutreachMessage } from '@/products/outreach/data/lead-repository';
import { generateOutreach } from '@/products/outreach/agent/generator';
import type { OutreachMedium } from '@/products/outreach/domain/types';
import { commercialErrorResponse, reserveVariableCost } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// GET /api/outreach/leads/[id]/outreach - List all outreach messages for a lead
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify lead exists
    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers: corsHeaders });
    }

    const messages = await getLeadOutreach(id);
    return NextResponse.json(messages, { headers: corsHeaders });
  } catch (error) {
    console.error('Error fetching outreach messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outreach messages' },
      { status: 500, headers: corsHeaders }
    );
  }
}

// POST /api/outreach/leads/[id]/outreach - Create or generate an outreach message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Verify lead exists
    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers: corsHeaders });
    }

    // If generate flag is set, generate outreach using Mastra agent
    if (generate) {
      const billing = await reserveVariableCost(request, { action: 'generate_outreach', credits: 30, capability: 'outreach' }); reservationId = billing.reservationId;
      const tenantId = process.env.CMS_TENANT_ID;

      const result = await generateOutreach({
        leadId: id,
        medium: medium as OutreachMedium,
        targetContent,
        tenantId,
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
      leadId: id,
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
}
