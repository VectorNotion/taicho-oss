/**
 * YouTube adapter — ported from Relay's reference implementation.
 *
 * Encodes exactly what was verified by hand:
 *   - refresh  -> POST oauth2.googleapis.com/token (grant_type=refresh_token)
 *   - publish  -> resumable upload: init (snippet+status) then PUT the bytes
 *   - copy fields: title (2-100 chars), description, tags,
 *     privacy ('public'|'private'|'unlisted'), made_for_kids.
 *     categoryId 28 = Science & Technology.
 *
 * Access tokens live ONE HOUR — this is the destination the refresh heartbeat
 * exists for. OAuth connect (Relay's oauth_flows.connect_youtube) lives on the
 * `oauth` member: build the Google consent URL, exchange the callback code,
 * then fetch the channel identity from youtube/v3/channels.
 */
import {
  PublishError,
  type ChannelRecord,
  type DestinationAdapter,
  type DestinationOAuth,
  type PublishInput,
  type RefreshResult,
} from "../types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const WATCH = "https://www.youtube.com/watch?v=";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "openid",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function clientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.YOUTUBE_CLIENT_ID ?? "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new PublishError("set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

interface VideoMetadata {
  snippet: { title: string; description: string; tags: unknown[]; categoryId: string };
  status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
}

/** Validate copy and build the videos.insert body. Pure — matches Relay's build_metadata. */
function buildMetadata(copy: Record<string, unknown>): VideoMetadata {
  const title = String(copy.title ?? "").trim();
  if (title.length < 2 || title.length > 100) {
    throw new PublishError("youtube: title must be 2-100 chars");
  }
  const privacy = String(copy.privacy ?? "public");
  if (privacy !== "public" && privacy !== "private" && privacy !== "unlisted") {
    throw new PublishError("youtube: privacy must be public|private|unlisted");
  }
  return {
    snippet: {
      title,
      description: String(copy.description ?? ""),
      tags: Array.isArray(copy.tags) ? copy.tags : [],
      categoryId: String(copy.category_id ?? "28"),
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: Boolean(copy.made_for_kids ?? false),
    },
  };
}

const oauth: DestinationOAuth = {
  async buildAuthUrl(redirectUri: string, state: string): Promise<string> {
    const { clientId } = clientCreds();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH_URL}?${query.toString()}`;
  },

  async exchangeCallback(params: Record<string, string>, redirectUri: string) {
    const { clientId, clientSecret } = clientCreds();
    const code = params.code;
    if (!code) {
      throw new PublishError(`youtube authorization failed: ${JSON.stringify(params)}`);
    }
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenText = await tokenRes.text();
    const tok = parseJson(tokenText) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tok.access_token) {
      throw new PublishError(`youtube token exchange failed: ${tokenText.slice(0, 300)}`);
    }

    // Fetch the account identity, like Relay's exchange_youtube.
    const infoRes = await fetch(`${CHANNELS_URL}?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const info = parseJson(await infoRes.text()) as {
      items?: Array<{ id?: string; snippet?: { title?: string } }>;
    };
    const item = info.items?.[0] ?? {};
    return {
      id: item.id || "youtube",
      name: item.snippet?.title || "YouTube",
      credentials: {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? "",
      },
      tokenExpiry: new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000),
    };
  },
};

export const youtubeAdapter: DestinationAdapter = {
  destination: "youtube",
  credentialKind: "oauth2",
  refreshable: true, // 1-hour tokens
  mediaMode: "file",
  requiresMedia: true,
  oauth,

  async refresh(channel: ChannelRecord): Promise<RefreshResult> {
    const { clientId, clientSecret } = clientCreds();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: channel.credentials.refresh_token ?? "",
        grant_type: "refresh_token",
      }),
    });
    const text = await res.text();
    if (res.status !== 200) {
      throw new PublishError(
        `youtube token refresh failed: HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const d = parseJson(text) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!d.access_token) {
      throw new PublishError(`youtube token refresh failed: no access_token: ${text.slice(0, 300)}`);
    }
    // Google normally keeps the same refresh token; carry a rotated one through if present.
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000),
    };
  },

  async publish(input: PublishInput): Promise<{ url: string }> {
    const metadata = buildMetadata(input.post.copy);
    const accessToken = input.channel.credentials.access_token ?? "";
    if (!input.mediaBytes) {
      throw new PublishError("youtube: no media bytes available for upload");
    }

    // 1) resumable init — returns the upload URL in the Location header
    const init = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(metadata),
    });
    const uploadUrl = init.headers.get("location");
    if (init.status !== 200 || !uploadUrl) {
      const text = await init.text().catch(() => "");
      throw new PublishError(`youtube init failed: HTTP ${init.status}: ${text.slice(0, 300)}`);
    }

    // 2) upload the bytes
    const data = await input.mediaBytes();
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "video/mp4" },
      body: new Uint8Array(data),
    });
    const putText = await put.text();
    if (put.status !== 200 && put.status !== 201) {
      throw new PublishError(`youtube upload failed: HTTP ${put.status}: ${putText.slice(0, 300)}`);
    }
    const videoId = (parseJson(putText) as { id?: string }).id;
    if (!videoId) {
      throw new PublishError(`youtube: no video id in response: ${putText.slice(0, 300)}`);
    }
    return { url: WATCH + videoId };
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
