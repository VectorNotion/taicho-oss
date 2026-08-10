import { NextRequest, NextResponse } from 'next/server';
import { getProspectQualification } from '@/products/outreach/data/qualification-repository';
import { withProspectOrg } from '@/lib/prospect-scope';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await ctx.params;
      const qualification = await getProspectQualification(id);
      if (!qualification) {
        return NextResponse.json({ error: 'No qualification found' }, { status: 404 });
      }
      return NextResponse.json(qualification);
    } catch (error) {
      console.error('Error fetching qualification:', error);
      return NextResponse.json({ error: 'Failed to fetch qualification' }, { status: 500 });
    }
  });
}
