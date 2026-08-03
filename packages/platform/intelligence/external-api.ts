import { signWebhookPayload, verifyWebhookSignature } from '../network/signed-webhook';
import { getIntelligenceApiToken } from './repository';

const ORGANIZATION_ID = /^[a-zA-Z0-9_-]{1,255}$/;

export const INTELLIGENCE_API_HEADERS = {
  organizationId: 'x-intelligence-organization-id',
  timestamp: 'x-intelligence-timestamp',
  signature: 'x-intelligence-signature',
  deliveryId: 'x-intelligence-delivery-id',
} as const;

export interface IntelligenceApiHeaders {
  organizationId: string | null;
  timestamp: string | null;
  signature: string | null;
  deliveryId: string | null;
}

/** Bind the signature to the method and path as well as the request body. */
export function canonicalIntelligenceApiPayload(input: {
  method: string;
  path: string;
  body: string;
}): string {
  return `${input.method.toUpperCase()}\n${input.path}\n${input.body}`;
}

export function signIntelligenceApiRequest(input: {
  token: string;
  method: string;
  path: string;
  body?: string;
  deliveryId: string;
  timestamp?: string;
}) {
  return signWebhookPayload({
    token: input.token,
    body: canonicalIntelligenceApiPayload({
      method: input.method,
      path: input.path,
      body: input.body ?? '',
    }),
    deliveryId: input.deliveryId,
    timestamp: input.timestamp,
  });
}

/** Uniform null result prevents leaking whether an organization or token exists. */
export async function verifyIntelligenceApiRequest(input: {
  headers: IntelligenceApiHeaders;
  method: string;
  path: string;
  body?: string;
  now?: number;
}, dependencies: {
  getToken?: typeof getIntelligenceApiToken;
} = {}): Promise<{ organizationId: string; deliveryId: string } | null> {
  const organizationId = input.headers.organizationId?.trim();
  if (!organizationId || !ORGANIZATION_ID.test(organizationId)) return null;
  const token = await (dependencies.getToken ?? getIntelligenceApiToken)(organizationId);
  if (!token || !input.headers.deliveryId) return null;
  const valid = verifyWebhookSignature({
    token,
    body: canonicalIntelligenceApiPayload({
      method: input.method,
      path: input.path,
      body: input.body ?? '',
    }),
    deliveryId: input.headers.deliveryId,
    timestamp: input.headers.timestamp,
    signature: input.headers.signature,
    now: input.now,
  });
  return valid ? { organizationId, deliveryId: input.headers.deliveryId } : null;
}
