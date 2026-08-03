import { getAuthorizationContext } from '@content-automation/auth/server';
import { getLatestJobForEntity } from '@content-automation/platform/jobs/repository';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: 'Unauthenticated.' }, { status: 401 });

  const { id } = await params;
  // Ordinary draft generation jobs are attached to the source idea. The
  // variation coordinator is attached to the finished draft itself, so this
  // lookup cannot accidentally restore an unrelated generation result.
  const job = await getLatestJobForEntity(
    context.organizationId,
    id,
    'generate_content_draft',
  );
  if (!job?.result || job.result.kind !== 'content_resonance_experiment') {
    return new Response(null, { status: 204 });
  }
  return Response.json({
    status: job.status,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
  });
}
