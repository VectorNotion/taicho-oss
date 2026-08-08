import { getAuthorizationContext } from '@content-automation/auth/server';
import { generateLeadInsights } from '@/products/outreach/agent/lead-insights';
import { getLeadById } from '@/products/outreach/data/lead-repository';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  try {
    const insight = await generateLeadInsights({
      organizationId: authorization.organizationId,
      leadId: id,
      reason: 'manual',
      createdBy: authorization.session.user.id,
    });
    return NextResponse.json(insight, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Insights could not be generated.',
    }, { status: 400 });
  }
}
