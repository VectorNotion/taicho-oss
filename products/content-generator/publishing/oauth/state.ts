import type { CredentialKind } from "../types";

export const PUBLISHING_OAUTH_STATE_COOKIE = "publishing_oauth_state";

export interface PublishingOAuthState {
  nonce: string;
  organizationId: string;
  destination: string;
}

export function encodePublishingOAuthState(state: PublishingOAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodePublishingOAuthState(value: string | undefined): PublishingOAuthState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<PublishingOAuthState>;
    return typeof parsed.nonce === "string"
      && parsed.nonce.length > 0
      && typeof parsed.organizationId === "string"
      && parsed.organizationId.length > 0
      && typeof parsed.destination === "string"
      && parsed.destination.length > 0
      ? parsed as PublishingOAuthState
      : null;
  } catch {
    return null;
  }
}

export function localPublishingOAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.PUBLISHING_OAUTH_MODE?.trim().toLowerCase() === "stub";
}

export function localPublishingOAuthChannel(
  destination: string,
  organizationId: string,
  credentialKind: CredentialKind,
): {
  id: string;
  name: string;
  credentials: Record<string, string>;
  tokenExpiry: Date | null;
  extra: Record<string, string>;
} {
  const label = destination === "youtube"
    ? "YouTube"
    : destination === "x"
      ? "X"
      : destination === "linkedin"
        ? "LinkedIn"
        : destination === "instagram"
          ? "Instagram"
          : destination;
  const credentials: Record<string, string> = credentialKind === "oauth1"
    ? { access_token: `local-${destination}-token`, token_secret: "local-token-secret" }
    : { access_token: `local-${destination}-token`, refresh_token: "local-refresh-token" };
  return {
    id: `browser-qa-${destination}-${organizationId}`,
    name: `Browser QA ${label}`,
    credentials,
    tokenExpiry: credentialKind === "oauth1"
      ? null
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
    extra: { identity: `@browser-qa-${destination}` },
  };
}
