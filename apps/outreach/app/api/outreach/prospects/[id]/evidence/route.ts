import { getAuthorizationContext } from '@content-automation/auth/server';
import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import { createManualProspectEvidence } from '@/products/outreach/data/prospect-intelligence-repository';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
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
  const prospect = await getProspectById(id);
  if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  const evidence = await createManualProspectEvidence({
    organizationId: authorization.organizationId,
    prospectId: id,
    content: parsed.data.content,
    createdBy: authorization.session.user.id,
  });
  try {
    const insight = await generateProspectInsights({
      organizationId: authorization.organizationId,
      prospectId: id,
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
