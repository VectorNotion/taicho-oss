import { getAuthorizationContext } from '@content-automation/auth/server';
import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
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
  const prospect = await getProspectById(id);
  if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  try {
    const insight = await generateProspectInsights({
      organizationId: authorization.organizationId,
      prospectId: id,
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
