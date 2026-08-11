import { NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';
import { getAccountForProspect } from '@/products/outreach/data/account-repository';

/** The prospect's company as an account summary (fit / timing / target + link). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const account = await getAccountForProspect(id);
      return NextResponse.json({ account });
    } catch (error) {
      console.error('Error fetching account for prospect:', error);
      return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 });
    }
  });
}
