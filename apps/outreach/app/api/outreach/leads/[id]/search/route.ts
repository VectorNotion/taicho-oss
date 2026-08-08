import { getAuthorizationContext } from '@content-automation/auth/server';
import { getLeadById } from '@/products/outreach/data/lead-repository';
import { semanticSearchLead } from '@/products/outreach/services/lead-semantic-search';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export const maxDuration = 600;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

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
    const result = await semanticSearchLead({
      organizationId: authorization.organizationId,
      leadId: id,
      query: body.query,
      limit: body.limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead search failed.';
    const status = /not configured/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
