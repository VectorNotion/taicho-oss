import { NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';
import { getAccountDetail, getAccountForProspect } from '@/products/outreach/data/account-repository';

/** The prospect's company as an account summary (fit / timing / target + link). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const summary = await getAccountForProspect(id);
      const detail = summary ? await getAccountDetail(summary.id) : null;
      const account = summary
        ? {
            ...summary,
            computedAt: detail?.computedAt,
            icpObservations: detail?.icpObservations ?? [],
            timingSignals: detail?.timingSignals ?? [],
          }
        : null;
      return NextResponse.json({ account });
    } catch (error) {
      console.error('Error fetching account for prospect:', error);
      return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 });
    }
  });
}
