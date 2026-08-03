/**
 * X (Twitter) adapter — ported from Relay's `relay/adapters/x.py` (+ the X legs
 * of `relay/oauth_flows.py`).
 *
 * Auth: OAuth 1.0a. Consumer key/secret = X_API_KEY / X_API_SECRET (the app).
 * Per-channel creds: credentials.access_token = oauth_token,
 * credentials.token_secret = oauth_token_secret. Tokens don't expire
 * (refreshable = false).
 *
 * Publish: if the post has media, chunked video upload (INIT -> APPEND ->
 * FINALIZE -> STATUS poll) via the v1.1 media endpoint, then create the tweet
 * via v2 /tweets with the media id. If the post has NO media, the tweet is
 * created text-only via v2 /tweets — this branch is new relative to the Python
 * source, which required media.
 *
 * copy: {text, who_can_reply_post?}  who_can_reply_post in
 *       everyone|following|mentionedUsers|subscribers|verified (default everyone).
 */
import * as oauth1 from "../oauth/oauth1";
import {
  PublishError,
  type ChannelRecord,
  type DestinationAdapter,
  type DestinationOAuth,
  type PublishInput,
  type RefreshResult,
} from "../types";

const MEDIA_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEET_URL = "https://api.twitter.com/2/tweets";
const REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";
const ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";
const CHUNK = 4 * 1024 * 1024; // 4 MB

// X API v2 reply_settings enum. "everyone" is the DEFAULT and is expressed by OMITTING
// the field — sending the literal "everyone" is rejected ("Invalid Request"), so it
// maps to null and the caller leaves the field out.
const REPLY: Record<string, string | null> = {
  everyone: null,
  following: "following",
  mentionedUsers: "mentionedUsers",
  subscribers: "subscribers",
  verified: "verified",
};

/**
 * Validate copy and return {text, replySettings}. Pure — unit-testable directly.
 * replySettings is null for the default 'everyone' (the caller omits the field).
 */
export function buildTweet(copy: Record<string, unknown>): { text: string; replySettings: string | null } {
  const text = (typeof copy.text === "string" ? copy.text : "").trim();
  if (!text) throw new PublishError("x: text required");
  if ([...text].length > 280) throw new PublishError("x: text exceeds 280 chars");
  const who = typeof copy.who_can_reply_post === "string" ? copy.who_can_reply_post : "everyone";
  if (!(who in REPLY)) {
    throw new PublishError(
      "x: who_can_reply_post must be everyone|following|mentionedUsers|subscribers|verified",
    );
  }
  return { text, replySettings: REPLY[who] };
}

function consumerCreds(): { ck: string; cs: string } {
  const ck = process.env.X_API_KEY ?? "";
  const cs = process.env.X_API_SECRET ?? "";
  if (!ck || !cs) throw new PublishError("x: set X_API_KEY / X_API_SECRET");
  return { ck, cs };
}

function creds(channel: ChannelRecord): { ck: string; cs: string; token: string; secret: string } {
  const ck = process.env.X_API_KEY ?? "";
  const cs = process.env.X_API_SECRET ?? "";
  const token = channel.credentials.access_token ?? "";
  const secret = channel.credentials.token_secret ?? "";
  if (!ck || !cs || !token || !secret) {
    throw new PublishError(
      "x: missing consumer or user credentials " +
        "(need X_API_KEY/SECRET + channel access_token + credentials.token_secret)",
    );
  }
  return { ck, cs, token, secret };
}

function signed(
  method: string,
  url: string,
  ck: string,
  cs: string,
  token: string,
  secret: string,
  params?: Record<string, string>,
): Record<string, string> {
  return { Authorization: oauth1.header(method, url, ck, cs, token, secret, { params }) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Parse a urlencoded body (X's request_token/access_token replies). */
function parseQuery(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadVideo(
  data: Buffer,
  ck: string,
  cs: string,
  token: string,
  secret: string,
): Promise<string> {
  const total = data.length;

  // INIT (form params are signed)
  const initParams = {
    command: "INIT",
    total_bytes: String(total),
    media_type: "video/mp4",
    media_category: "tweet_video",
  };
  const init = await fetch(MEDIA_URL, {
    method: "POST",
    headers: signed("POST", MEDIA_URL, ck, cs, token, secret, initParams),
    body: new URLSearchParams(initParams),
  });
  const initText = await init.text();
  if (![200, 201, 202].includes(init.status)) {
    throw new PublishError(`x media INIT failed: HTTP ${init.status}: ${initText.slice(0, 300)}`);
  }
  const mediaId: string | undefined = parseJson(initText).media_id_string;
  if (!mediaId) throw new PublishError(`x media INIT: no media_id_string: ${initText.slice(0, 200)}`);

  // APPEND — pass command/media_id/segment_index as signed QUERY params, chunk as multipart
  let seg = 0;
  for (let off = 0; off < total; off += CHUNK) {
    const q = { command: "APPEND", media_id: mediaId, segment_index: String(seg) };
    const url = `${MEDIA_URL}?${new URLSearchParams(q)}`;
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(data.subarray(off, off + CHUNK))]), "chunk");
    const r = await fetch(url, {
      method: "POST",
      headers: signed("POST", MEDIA_URL, ck, cs, token, secret, q),
      body: form,
    });
    if (![200, 201, 204].includes(r.status)) {
      throw new PublishError(
        `x media APPEND ${seg} failed: HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`,
      );
    }
    seg += 1;
  }

  // FINALIZE
  const finParams = { command: "FINALIZE", media_id: mediaId };
  const fin = await fetch(MEDIA_URL, {
    method: "POST",
    headers: signed("POST", MEDIA_URL, ck, cs, token, secret, finParams),
    body: new URLSearchParams(finParams),
  });
  const finText = await fin.text();
  if (![200, 201].includes(fin.status)) {
    throw new PublishError(`x media FINALIZE failed: HTTP ${fin.status}: ${finText.slice(0, 300)}`);
  }
  await awaitProcessing(mediaId, parseJson(finText), ck, cs, token, secret);
  return mediaId;
}

async function awaitProcessing(
  mediaId: string,
  finJson: { processing_info?: { state?: string; check_after_secs?: number; error?: unknown } },
  ck: string,
  cs: string,
  token: string,
  secret: string,
): Promise<void> {
  let info = finJson.processing_info;
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    await sleep(Math.min(info.check_after_secs ?? 3, 10) * 1000);
    const q = { command: "STATUS", media_id: mediaId };
    const url = `${MEDIA_URL}?${new URLSearchParams(q)}`;
    const r = await fetch(url, { headers: signed("GET", MEDIA_URL, ck, cs, token, secret, q) });
    const text = await r.text();
    if (r.status !== 200) {
      throw new PublishError(`x media STATUS failed: HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    info = parseJson(text).processing_info;
  }
  if (info && info.state === "failed") {
    throw new PublishError(`x media processing failed: ${JSON.stringify(info.error)}`);
  }
}

/**
 * Request-token secrets stashed between buildAuthUrl and exchangeCallback, keyed by
 * oauth_token. NOTE: module-scope state only works because both halves of X's
 * three-legged flow are served by the SAME process (single-instance deployment).
 * Move this to a shared store (DB/Redis) before ever scaling horizontally.
 */
const requestTokenSecrets = new Map<string, string>();

const oauth: DestinationOAuth = {
  // OAuth 1.0a has no `state` parameter — the oauth_token itself correlates the
  // callback with the request token, so `state` is accepted but unused.
  async buildAuthUrl(redirectUri: string, _state: string): Promise<string> {
    const { ck, cs } = consumerCreds();
    const q = { oauth_callback: redirectUri };
    const r = await fetch(`${REQUEST_TOKEN_URL}?${new URLSearchParams(q)}`, {
      method: "POST",
      headers: { Authorization: oauth1.header("POST", REQUEST_TOKEN_URL, ck, cs, "", "", { params: q }) },
    });
    const text = await r.text();
    const rt = parseQuery(text);
    if (!rt.oauth_token || !rt.oauth_token_secret) {
      throw new PublishError(`x request_token failed: ${text.slice(0, 200)}`);
    }
    requestTokenSecrets.set(rt.oauth_token, rt.oauth_token_secret);
    return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(rt.oauth_token)}`;
  },

  async exchangeCallback(params: Record<string, string>, _redirectUri: string) {
    const { ck, cs } = consumerCreds();
    const oauthToken = params.oauth_token ?? "";
    const verifier = params.oauth_verifier ?? "";
    const rtSecret = requestTokenSecrets.get(oauthToken);
    if (!rtSecret) {
      throw new PublishError(
        "x: no request-token secret for this oauth_token (expired, or the auth URL was built by another instance)",
      );
    }
    requestTokenSecrets.delete(oauthToken);

    const r = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: oauth1.header("POST", ACCESS_TOKEN_URL, ck, cs, oauthToken, rtSecret, {
          params: { oauth_verifier: verifier },
        }),
      },
      body: new URLSearchParams({ oauth_verifier: verifier }),
    });
    const text = await r.text();
    const a = parseQuery(text);
    if (!a.oauth_token || !a.oauth_token_secret) {
      throw new PublishError(`x access_token failed: ${text.slice(0, 200)}`);
    }
    return {
      id: a.user_id || "x",
      name: a.screen_name || "X",
      credentials: { access_token: a.oauth_token, token_secret: a.oauth_token_secret },
      tokenExpiry: null, // X OAuth 1.0a tokens do not expire
    };
  },
};

export const xAdapter: DestinationAdapter = {
  oauth,
  destination: "x",
  credentialKind: "oauth1",
  refreshable: false,
  mediaMode: "file",

  async refresh(): Promise<RefreshResult> {
    throw new PublishError("x: tokens do not expire; refresh not applicable");
  },

  async publish(input: PublishInput): Promise<{ url: string }> {
    const { post, channel, mediaBytes } = input;
    const { ck, cs, token, secret } = creds(channel);
    const { text, replySettings } = buildTweet(post.copy);

    // TEXT-ONLY support (new vs the Python source, which required media): a post
    // without media bytes skips the v1.1 upload and goes straight to v2 /tweets.
    let mediaId: string | null = null;
    if (mediaBytes) {
      const data = await mediaBytes();
      mediaId = await uploadVideo(data, ck, cs, token, secret);
    }

    const body: Record<string, unknown> = { text };
    if (mediaId) body.media = { media_ids: [mediaId] };
    if (replySettings !== null) body.reply_settings = replySettings; // omit for the default 'everyone'

    // JSON body: sign the oauth params only
    const r = await fetch(TWEET_URL, {
      method: "POST",
      headers: { ...signed("POST", TWEET_URL, ck, cs, token, secret), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resText = await r.text();
    if (![200, 201].includes(r.status)) {
      throw new PublishError(`x create tweet failed: HTTP ${r.status}: ${resText.slice(0, 300)}`);
    }
    const tid: string | undefined = parseJson(resText).data?.id;
    if (!tid) throw new PublishError(`x: no tweet id: ${resText.slice(0, 200)}`);
    return { url: `https://x.com/i/status/${tid}` };
  },
};
