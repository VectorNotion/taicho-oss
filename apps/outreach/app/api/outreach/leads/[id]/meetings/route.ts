import { getAuthorizationContext } from '@content-automation/auth/server';
import { getLeadById } from '@/products/outreach/data/lead-repository';
import { createMeetingCapture } from '@/products/outreach/services/lead-meeting-service';
import {
  RecallConfigurationError,
  RecallProviderError,
} from '@/products/outreach/integrations/recall';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

const inputSchema = z.object({
  meetingUrl: z.string().trim().min(1).max(4_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid meeting link.' }, { status: 400 });
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  try {
    const meeting = await createMeetingCapture({
      organizationId: authorization.organizationId,
      leadId: id,
      leadName: lead.name,
      meetingUrl: parsed.data.meetingUrl,
      createdBy: authorization.session.user.id,
    });
    return NextResponse.json(meeting, { status: 201 });
  } catch (error) {
    if (error instanceof RecallConfigurationError) {
      return NextResponse.json({ error: error.message, code: 'RECALL_NOT_CONFIGURED' }, { status: 503 });
    }
    if (error instanceof RecallProviderError) {
      return NextResponse.json({ error: error.message, code: 'RECALL_UNAVAILABLE' }, { status: 502 });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The meeting bot could not be started.',
    }, { status: 400 });
  }
}
