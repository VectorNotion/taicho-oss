/**
 * LinkedIn adapter — ported from Relay's `relay/adapters/linkedin.py` (+ the
 * LinkedIn legs of `relay/oauth_flows.py`).
 *
 * Auth: OAuth 2.0 (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET). Access token
 * ~60 days; refresh via refresh_token — refresh tokens are only issued to apps
 * with the "Advertising API" product, so refresh() may fail and surfaces
 * LinkedIn's real error untouched. refreshable = true (slow heartbeat).
 *
 * Publish (video): initializeUpload -> PUT the byte range(s) (collect ETags) ->
 * finalizeUpload -> create a Post referencing the video URN. Publish (no media):
 * create a text-only Post — this branch is new relative to the Python source,
 * which required media.
 *
 * Author URN (urn:li:person:xxx) is stored on channel.extra.author_urn.
 * copy: {body, hashtags?}
 */
import {
  PublishError,
  type ChannelRecord,
  type DestinationAdapter,
  type DestinationOAuth,
  type PublishInput,
  type RefreshResult,
} from "../types";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const VIDEOS_URL = "https://api.linkedin.com/rest/videos";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const LI_VERSION = "202506";
const SCOPES = ["openid", "profile", "email", "w_member_social"];
const DEFAULT_EXPIRES_IN = 60 * 24 * 3600; // ~60 days, LinkedIn's usual TTL

function liHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LI_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

function clientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID ?? "";
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new PublishError("linkedin: set LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

interface UploadInstruction {
  firstByte: number;
  lastByte: number;
  uploadUrl: string;
}

async function uploadVideo(data: Buffer, author: string, h: Record<string, string>): Promise<string> {
  // 1) initialize upload
  const init = await fetch(`${VIDEOS_URL}?action=initializeUpload`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: author,
        fileSizeBytes: data.length,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  const initText = await init.text();
  if (![200, 201].includes(init.status)) {
    throw new PublishError(`linkedin init upload failed: HTTP ${init.status}: ${initText.slice(0, 300)}`);
  }
  const val = parseJson(initText).value ?? {};
  const videoUrn: string | undefined = val.video;
  const uploadToken: string = val.uploadToken ?? "";
  const instructions: UploadInstruction[] = val.uploadInstructions ?? [];
  if (!videoUrn) throw new PublishError(`linkedin init upload: no video URN: ${initText.slice(0, 300)}`);

  // 2) upload each byte range, collecting ETags
  const etags: string[] = [];
  for (const ins of instructions) {
    const part = await fetch(ins.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data.subarray(ins.firstByte, ins.lastByte + 1)),
    });
    if (![200, 201].includes(part.status)) {
      throw new PublishError(
        `linkedin part upload failed: HTTP ${part.status}: ${(await part.text()).slice(0, 200)}`,
      );
    }
    const etag = part.headers.get("etag"); // Headers.get is case-insensitive
    if (!etag) throw new PublishError("linkedin: no ETag returned on part upload");
    etags.push(etag.replace(/^"+|"+$/g, ""));
  }

  // 3) finalize
  const fin = await fetch(`${VIDEOS_URL}?action=finalizeUpload`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({
      finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds: etags },
    }),
  });
  if (![200, 201].includes(fin.status)) {
    throw new PublishError(`linkedin finalize failed: HTTP ${fin.status}: ${(await fin.text()).slice(0, 300)}`);
  }
  return videoUrn;
}

const oauth: DestinationOAuth = {
  async buildAuthUrl(redirectUri: string, state: string): Promise<string> {
    const { clientId } = clientCreds();
    return `${AUTH_URL}?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      state,
    })}`;
  },

  async exchangeCallback(params: Record<string, string>, redirectUri: string) {
    const { clientId, clientSecret } = clientCreds();
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code ?? "",
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const text = await r.text();
    const tok = parseJson(text);
    if (!tok.access_token) throw new PublishError(`linkedin token exchange failed: ${text.slice(0, 300)}`);

    const meRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = parseJson(await meRes.text());
    const sub: string = me.sub ?? "";
    return {
      id: sub || "linkedin",
      name: me.name ?? "LinkedIn",
      credentials: {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? "",
      },
      tokenExpiry: new Date(Date.now() + (tok.expires_in ?? DEFAULT_EXPIRES_IN) * 1000),
      extra: sub ? { author_urn: `urn:li:person:${sub}` } : {},
    };
  },
};

export const linkedinAdapter: DestinationAdapter = {
  oauth,
  destination: "linkedin",
  credentialKind: "oauth2",
  refreshable: true,
  mediaMode: "file",

  async refresh(channel: ChannelRecord): Promise<RefreshResult> {
    const { clientId, clientSecret } = clientCreds();
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: channel.credentials.refresh_token ?? "",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const text = await r.text();
    // Without the "Advertising API" product LinkedIn issues no refresh tokens and
    // this call fails — surface the platform's real error, don't mask it.
    if (r.status !== 200) {
      throw new PublishError(`linkedin token refresh failed: HTTP ${r.status}: ${text.slice(0, 300)}`);
    }
    const d = parseJson(text);
    if (!d.access_token) throw new PublishError(`linkedin token refresh failed: ${text.slice(0, 300)}`);
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: new Date(Date.now() + (d.expires_in ?? DEFAULT_EXPIRES_IN) * 1000),
    };
  },

  async publish(input: PublishInput): Promise<{ url: string }> {
    const { post, channel, mediaBytes } = input;
    const author = typeof channel.extra.author_urn === "string" ? channel.extra.author_urn : "";
    if (!author) throw new PublishError("linkedin: missing channel.extra.author_urn (urn:li:person:...)");

    let bodyText = (typeof post.copy.body === "string" ? post.copy.body : "").trim();
    const tags = Array.isArray(post.copy.hashtags)
      ? post.copy.hashtags.filter((t): t is string => typeof t === "string")
      : [];
    if (tags.length > 0) bodyText = `${bodyText}\n\n${tags.join(" ")}`.trim();

    const h = liHeaders(channel.credentials.access_token ?? "");

    // TEXT-ONLY support (new vs the Python source, which required media): without
    // media bytes the upload steps are skipped and the Post carries no content.
    let videoUrn: string | null = null;
    if (mediaBytes) {
      videoUrn = await uploadVideo(await mediaBytes(), author, h);
    } else if (!bodyText) {
      throw new PublishError("linkedin: text-only post requires copy.body");
    }

    // 4) create the post
    const payload: Record<string, unknown> = {
      author,
      commentary: bodyText,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (videoUrn) payload.content = { media: { id: videoUrn } };

    const pr = await fetch(POSTS_URL, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (![200, 201].includes(pr.status)) {
      throw new PublishError(`linkedin create post failed: HTTP ${pr.status}: ${(await pr.text()).slice(0, 300)}`);
    }
    const urn = pr.headers.get("x-restli-id") ?? pr.headers.get("x-linkedin-id") ?? "";
    return {
      url: urn ? `https://www.linkedin.com/feed/update/${urn}` : "https://www.linkedin.com/feed/",
    };
  },
};
