export type CredentialKind = "oauth2" | "oauth1" | "api_key" | "signing_secret" | "none";

export type PostStatus = "scheduled" | "publishing" | "published" | "failed" | "cancelled";

export interface ChannelRecord {
  id: string;
  destination: string;
  name: string;
  credentialKind: CredentialKind;
  /** Shape depends on credentialKind: oauth tokens, api key + base url, signing secret. */
  credentials: Record<string, string>;
  tokenExpiry: Date | null;
  extra: Record<string, unknown>;
  orgId: string | null;
  disabled: boolean;
}

export interface PostRecord {
  id: string;
  draftId: string | null;
  destination: string;
  channelId: string;
  copy: Record<string, unknown>;
  mediaKey: string | null;
  publishAt: Date;
  status: PostStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  idempotencyKey: string | null;
  resultUrl: string | null;
  error: string | null;
  createdAt: Date;
  organizationId: string | null;
  createdBy: string | null;
  actorType: "user" | "service" | "system";
  requestId: string | null;
  parentExecutionId: string | null;
  traceId: string | null;
  traceparent: string | null;
}

/** Raised by adapters with the platform's real error message. */
export class PublishError extends Error {}

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  /** null = token does not expire */
  expiresAt: Date | null;
}

export interface PublishInput {
  post: PostRecord;
  channel: ChannelRecord;
  /** Public URL for the staged media (set when mediaKey resolves through R2). */
  mediaUrl?: string;
  /** Lazily fetch media bytes (file-mode adapters). */
  mediaBytes?: () => Promise<Buffer>;
}

/** Browser OAuth support for destinations whose channels connect via OAuth. */
export interface DestinationOAuth {
  /** Build the provider authorization URL (async: OAuth 1.0a needs a request-token call first). */
  buildAuthUrl(redirectUri: string, state: string): Promise<string>;
  /** Exchange the provider callback params for a connected channel's fields. */
  exchangeCallback(
    params: Record<string, string>,
    redirectUri: string,
  ): Promise<{
    id: string;
    name: string;
    credentials: Record<string, string>;
    tokenExpiry: Date | null;
    extra?: Record<string, unknown>;
  }>;
}

/**
 * The destination contract. Social networks are four implementations of this
 * interface — not the definition of it. CMS, webhook, and future internal
 * systems implement the same shape.
 */
export interface DestinationAdapter {
  oauth?: DestinationOAuth;
  destination: string;
  credentialKind: CredentialKind;
  /** Whether refresh() can renew this destination's tokens. */
  refreshable: boolean;
  /** "url": adapter needs a public media URL. "file": adapter uploads bytes. */
  mediaMode?: "url" | "file";
  /** Destination cannot publish without media (e.g. Instagram Reels, YouTube). */
  requiresMedia?: boolean;
  refresh?(channel: ChannelRecord): Promise<RefreshResult>;
  /** Publish and return the live URL, or throw PublishError with the real platform error. */
  publish(input: PublishInput): Promise<{ url: string }>;
}
