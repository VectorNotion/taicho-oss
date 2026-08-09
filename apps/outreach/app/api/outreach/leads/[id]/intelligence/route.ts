import { getAuthorizationContext } from '@content-automation/auth/server';
import { getLeadIntelligenceWorkspace } from '@/products/outreach/data/lead-intelligence-repository';
import { getLeadById } from '@/products/outreach/data/lead-repository';
import { recallIsConfigured } from '@/products/outreach/integrations/recall';
import { leadSemanticSearchIsConfigured } from '@/products/outreach/services/lead-semantic-search';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const workspace = await getLeadIntelligenceWorkspace(
    authorization.organizationId,
    id,
    recallIsConfigured(),
    leadSemanticSearchIsConfigured(),
  );
  return NextResponse.json(workspace);
}
