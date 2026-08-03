/**
 * Instagram adapter — direct Instagram Graph API (Instagram API with Instagram
 * Login), ported from Relay's `instagram-standalone`-style provider: talks
 * straight to `graph.instagram.com` (NOT Facebook, NOT upload-post).
 *
 * Publishing a single mp4 is a Reel: create a media container from a public
 * video URL, poll it until Instagram has ingested it, publish it, then read
 * back the permalink. Because Instagram ingests the video by URL, this adapter
 * is mediaMode "url" — the publish engine hands it a public URL, not bytes.
 *
 * copy: {caption, hashtags?}   refreshable (long-lived ~60d token).
 *
 * OAuth connect (Relay's oauth_flows.connect_instagram) lives on the `oauth`
 * member: consent on www.instagram.com (enable_fb_login=0, comma-joined
 * scopes), then the 3-step exchange — short-lived token, ig_exchange_token for
 * the long-lived token, then /me for the account identity.
 */
import {
  PublishError,
  type ChannelRecord,
  type DestinationAdapter,
  type DestinationOAuth,
  type PublishInput,
  type RefreshResult,
} from "../types";

const GRAPH = "https://graph.instagram.com";
const API = "v20.0"; // publish API version (matches Postiz)
const POLL_SECS = 15; // wait between container status polls
const MAX_POLLS = 40; // ~10 min cap before giving up

const AUTH_URL = "https://www.instagram.com/oauth/authorize";
const SHORT_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const DEFAULT_EXPIRES_SECS = 58 * 24 * 3600;

const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
];

function clientCreds(): { appId: string; appSecret: string } {
  const appId = process.env.INSTAGRAM_APP_ID ?? "";
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";
  if (!appId || !appSecret) {
    throw new PublishError("set INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET");
  }
  return { appId, appSecret };
}

const oauth: DestinationOAuth = {
  async buildAuthUrl(redirectUri: string, state: string): Promise<string> {
    // Instagram API with Instagram Login: consent lives on www.instagram.com,
    // enable_fb_login=0. Scopes are comma-joined (NOT space-joined).
    const { appId } = clientCreds();
    const query = new URLSearchParams({
      enable_fb_login: "0",
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      state,
    });
    return `${AUTH_URL}?${query.toString()}`;
  },

  /**
   * 3-step Instagram token exchange (Instagram API with Instagram Login):
   *   1. POST api.instagram.com/oauth/access_token  -> short-lived token + user_id
   *   2. GET  graph.instagram.com/access_token (ig_exchange_token) -> long-lived (~60d) token
   *   3. GET  graph.instagram.com/v21.0/me -> account identity (user_id, username, name)
   */
  async exchangeCallback(params: Record<string, string>, redirectUri: string) {
    const { appId, appSecret } = clientCreds();
    const code = params.code;
    if (!code) {
      throw new PublishError(`instagram authorization failed: ${JSON.stringify(params)}`);
    }

    // 1) short-lived token (form-encoded body)
    const shortRes = await fetch(SHORT_TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortText = await shortRes.text();
    const short = parseJson(shortText) as { access_token?: string; user_id?: unknown };
    if (!short.access_token) {
      throw new PublishError(`instagram short-token exchange failed: ${shortText.slice(0, 300)}`);
    }

    // 2) exchange for a long-lived (~60 day) token
    const longQuery = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      access_token: short.access_token,
    });
    const longRes = await fetch(`${GRAPH}/access_token?${longQuery.toString()}`);
    const longText = await longRes.text();
    const longd = parseJson(longText) as { access_token?: string; expires_in?: number };
    if (!longd.access_token) {
      throw new PublishError(`instagram long-token exchange failed: ${longText.slice(0, 300)}`);
    }
    const longToken = longd.access_token;

    // 3) fetch the account identity
    const meQuery = new URLSearchParams({
      fields: "user_id,username,name,profile_picture_url",
      access_token: longToken,
    });
    const meRes = await fetch(`${GRAPH}/v21.0/me?${meQuery.toString()}`);
    const me = parseJson(await meRes.text()) as {
      user_id?: unknown;
      username?: string;
      name?: string;
    };

    const userId = me.user_id ?? short.user_id;
    const username = me.username ?? "";
    const name = me.name ?? "";
    return {
      id: String(userId),
      name: name || username || "Instagram",
      // The long-lived token refreshes itself (ig_refresh_token) — store it in
      // both slots, like Relay did.
      credentials: { access_token: longToken, refresh_token: longToken },
      tokenExpiry: new Date(Date.now() + (Number(longd.expires_in) || DEFAULT_EXPIRES_SECS) * 1000),
      extra: { username },
    };
  },
};

export const instagramAdapter: DestinationAdapter = {
  destination: "instagram",
  credentialKind: "oauth2",
  refreshable: true,
  mediaMode: "url", // engine hands this adapter a public URL, not bytes
  requiresMedia: true,
  oauth,

  async refresh(channel: ChannelRecord): Promise<RefreshResult> {
    const query = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: channel.credentials.access_token ?? "",
    });
    const res = await fetch(`${GRAPH}/refresh_access_token?${query.toString()}`);
    const text = await res.text();
    if (res.status !== 200) {
      throw new PublishError(
        `instagram token refresh failed: HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const d = parseJson(text) as { access_token?: string; expires_in?: number };
    if (!d.access_token) {
      throw new PublishError(`instagram refresh: no access_token in response: ${text.slice(0, 300)}`);
    }
    const expiresIn = Number(d.expires_in) || DEFAULT_EXPIRES_SECS;
    return {
      accessToken: d.access_token,
      refreshToken: d.access_token,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  },

  async publish(input: PublishInput): Promise<{ url: string }> {
    const videoUrl = input.mediaUrl;
    if (!videoUrl) {
      throw new PublishError("instagram: no public media URL available for this post");
    }
    const token = input.channel.credentials.access_token ?? "";
    const ig = input.channel.id;

    let caption = String(input.post.copy.caption ?? "").trim();
    const tags = Array.isArray(input.post.copy.hashtags) ? input.post.copy.hashtags : [];
    if (tags.length > 0) {
      caption = `${caption}\n\n${tags.join(" ")}`.trim();
    }

    // 1) create the media container from the public video URL
    const createQuery = new URLSearchParams({
      video_url: videoUrl,
      media_type: "REELS",
      thumb_offset: "0",
      access_token: token,
      caption,
    });
    const createRes = await fetch(`${GRAPH}/${API}/${ig}/media?${createQuery.toString()}`, {
      method: "POST",
    });
    const createText = await createRes.text();
    const body = parseJson(createText);
    raiseOnError(body, "create container");
    const creationId = body.id;
    if (!creationId) {
      throw new PublishError(`instagram: no creation id in response: ${createText.slice(0, 300)}`);
    }

    // 2) poll the container until Instagram finishes ingesting the video
    let finished = false;
    for (let i = 0; i < MAX_POLLS; i += 1) {
      const statusQuery = new URLSearchParams({ fields: "status_code", access_token: token });
      const statusRes = await fetch(`${GRAPH}/${API}/${creationId}?${statusQuery.toString()}`);
      const sbody = parseJson(await statusRes.text());
      raiseOnError(sbody, "poll status");
      const status = sbody.status_code;
      if (status === "FINISHED") {
        finished = true;
        break;
      }
      if (status === "ERROR" || status === "EXPIRED") {
        throw new PublishError(`instagram: container ${creationId} status=${status}`);
      }
      await sleep(POLL_SECS * 1000);
    }
    if (!finished) {
      throw new PublishError(
        `instagram: container ${creationId} not ready after ${MAX_POLLS} polls ` +
          `(~${MAX_POLLS * POLL_SECS}s)`,
      );
    }

    // 3) publish the container
    const publishQuery = new URLSearchParams({
      creation_id: String(creationId),
      access_token: token,
    });
    const publishRes = await fetch(`${GRAPH}/${API}/${ig}/media_publish?${publishQuery.toString()}`, {
      method: "POST",
    });
    const publishText = await publishRes.text();
    const pbody = parseJson(publishText);
    raiseOnError(pbody, "publish");
    const mediaId = pbody.id;
    if (!mediaId) {
      throw new PublishError(`instagram: no media id in publish response: ${publishText.slice(0, 300)}`);
    }

    // 4) read back the permalink
    const linkQuery = new URLSearchParams({ fields: "permalink", access_token: token });
    const linkRes = await fetch(`${GRAPH}/${API}/${mediaId}?${linkQuery.toString()}`);
    const lbody = parseJson(await linkRes.text());
    const permalink = typeof lbody.permalink === "string" && lbody.permalink
      ? lbody.permalink
      : "https://www.instagram.com/";
    return { url: permalink };
  },
};

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function raiseOnError(body: Record<string, unknown>, where: string): void {
  if (body.error) {
    throw new PublishError(`instagram (${where}): ${JSON.stringify(body.error)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
