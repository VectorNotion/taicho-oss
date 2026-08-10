import { getAuthorizationContext } from '@content-automation/auth/server';
import { getProspectIntelligenceWorkspace } from '@/products/outreach/data/prospect-intelligence-repository';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { recallIsConfigured } from '@/products/outreach/integrations/recall';
import { prospectSemanticSearchIsConfigured } from '@/products/outreach/services/prospect-semantic-search';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  const prospect = await getProspectById(id);
  if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  const workspace = await getProspectIntelligenceWorkspace(
    authorization.organizationId,
    id,
    recallIsConfigured(),
    prospectSemanticSearchIsConfigured(),
  );
  return NextResponse.json(workspace);
}
