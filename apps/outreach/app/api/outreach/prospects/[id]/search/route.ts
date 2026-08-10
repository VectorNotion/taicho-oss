import { getAuthorizationContext } from '@content-automation/auth/server';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { semanticSearchProspect } from '@/products/outreach/services/prospect-semantic-search';
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
      organizationId: authorization.organizationId,
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
}
