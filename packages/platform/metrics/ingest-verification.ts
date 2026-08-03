/**
 * Package-level verification core for POST /api/metrics/ingest, so security
 * behavior is testable where routes are not (apps/* have no test harness).
 * The caller identifies its org in a non-secret header; the secret token
 * never travels — it only keys the HMAC (same scheme as flow webhooks).
 * All failure modes collapse to null: the route answers a uniform 401,
 * leaking neither org existence nor which check failed.
 */
import { verifyWebhookSignature } from '../network/signed-webhook';
import { getIngestToken } from './ingest-tokens';

const ORGANIZATION_ID = /^[a-zA-Z0-9_-]{1,255}$/;

export interface MetricsIngestHeaders {
  organizationId: string | null;
  timestamp: string | null;
  signature: string | null;
  deliveryId: string | null;
}

export async function verifyMetricsIngest(input: {
  headers: MetricsIngestHeaders;
  body: string;
  now?: number;
}): Promise<{ organizationId: string } | null> {
  const organizationId = input.headers.organizationId?.trim();
  if (!organizationId || !ORGANIZATION_ID.test(organizationId)) return null;
  const token = await getIngestToken(organizationId);
  if (!token) return null;
  if (
    !verifyWebhookSignature({
      token,
      body: input.body,
      deliveryId: input.headers.deliveryId,
      timestamp: input.headers.timestamp,
      signature: input.headers.signature,
      now: input.now,
    })
  ) return null;
  return { organizationId };
}
