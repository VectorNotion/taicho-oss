import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { withProspectOrg } from '@/lib/prospect-scope';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 600;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async (context) => {
    const { id } = await ctx.params;
    const prospect = await getProspectById(id);
    if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    try {
      const insight = await generateProspectInsights({
        organizationId: context.organizationId,
        prospectId: id,
        reason: 'manual',
        createdBy: context.session.user.id,
      });
      return NextResponse.json(insight, { status: 201 });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Insights could not be generated.',
      }, { status: 400 });
    }
  });
}
