import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { createMeetingCapture } from '@/products/outreach/services/prospect-meeting-service';
import {
  RecallConfigurationError,
  RecallProviderError,
} from '@/products/outreach/integrations/recall';
import { withProspectOrg } from '@/lib/prospect-scope';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

const inputSchema = z.object({
  meetingUrl: z.string().trim().min(1).max(4_000),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async (context) => {
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Enter a valid meeting link.' }, { status: 400 });
    const { id } = await ctx.params;
    const prospect = await getProspectById(id);
    if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    try {
      const meeting = await createMeetingCapture({
        organizationId: context.organizationId,
        prospectId: id,
        meetingUrl: parsed.data.meetingUrl,
        createdBy: context.session.user.id,
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
  });
}
