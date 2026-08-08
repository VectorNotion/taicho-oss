import { getAuthorizationContext } from '@content-automation/auth/server';
import { generateLeadInsights } from '@/products/outreach/agent/lead-insights';
import { createManualLeadEvidence } from '@/products/outreach/data/lead-intelligence-repository';
import { getLeadById } from '@/products/outreach/data/lead-repository';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 600;

const inputSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Write an update between 1 and 20,000 characters.' }, { status: 400 });
  }
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const evidence = await createManualLeadEvidence({
    organizationId: authorization.organizationId,
    leadId: id,
    content: parsed.data.content,
    createdBy: authorization.session.user.id,
  });
  try {
    const insight = await generateLeadInsights({
      organizationId: authorization.organizationId,
      leadId: id,
      reason: 'manual_update',
      createdBy: authorization.session.user.id,
    });
    return NextResponse.json({ evidence, insight }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      evidence,
      insight: null,
      warning: error instanceof Error ? error.message : 'The update was saved, but insights could not be refreshed.',
    }, { status: 201 });
  }
}
