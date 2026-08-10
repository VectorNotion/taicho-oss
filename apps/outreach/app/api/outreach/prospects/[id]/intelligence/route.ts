import { getProspectIntelligenceWorkspace } from '@/products/outreach/data/prospect-intelligence-repository';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { recallIsConfigured } from '@/products/outreach/integrations/recall';
import { prospectSemanticSearchIsConfigured } from '@/products/outreach/services/prospect-semantic-search';
import { withProspectOrg } from '@/lib/prospect-scope';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async (context) => {
    const { id } = await ctx.params;
    const prospect = await getProspectById(id);
    if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    const workspace = await getProspectIntelligenceWorkspace(
      context.organizationId,
      id,
      recallIsConfigured(),
      prospectSemanticSearchIsConfigured(),
    );
    return NextResponse.json(workspace);
  });
}
