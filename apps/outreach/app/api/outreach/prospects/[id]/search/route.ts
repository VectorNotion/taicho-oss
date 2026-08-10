import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { semanticSearchProspect } from '@/products/outreach/services/prospect-semantic-search';
import { NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';

export const maxDuration = 600;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async (context) => {
    const { id } = await params;
    const prospect = await getProspectById(id);
    if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    let body: { query?: unknown; limit?: unknown };
    try {
      body = await request.json() as { query?: unknown; limit?: unknown };
    } catch {
      return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
    }
    if (typeof body.query !== 'string') {
      return NextResponse.json({ error: 'query must be a string.' }, { status: 400 });
    }
    if (body.limit !== undefined && (typeof body.limit !== 'number' || !Number.isFinite(body.limit))) {
      return NextResponse.json({ error: 'limit must be a number.' }, { status: 400 });
    }

    try {
      const result = await semanticSearchProspect({
        organizationId: context.organizationId,
        prospectId: id,
        query: body.query,
        limit: body.limit,
      });
      return NextResponse.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prospect search failed.';
      const status = /not configured/i.test(message) ? 503 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
