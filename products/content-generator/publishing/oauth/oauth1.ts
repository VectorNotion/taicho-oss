/**
 * Minimal OAuth 1.0a (HMAC-SHA1) request signing — node:crypto only. Used by the
 * X adapter. Ported from Relay's `relay/oauth1.py`.
 *
 * `signature()` and `header()` are pure and deterministic when nonce + timestamp
 * are supplied; `baseString()` is byte-exact against Twitter's published example
 * vector (developer.twitter.com, "Creating a signature").
 */
import { createHmac, randomBytes } from "node:crypto";

/**
 * Percent-encode leaving only the RFC 3986 unreserved set (A-Z a-z 0-9 - _ . ~).
 * `encodeURIComponent` wrongly leaves !'()* unescaped, so they are fixed up here
 * (Python's `quote(s, safe="~")` equivalent).
 */
export function pct(s: string | number): string {
  return encodeURIComponent(String(s)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Random nonce: base64 of 24 random bytes with the non-word chars +/= stripped. */
function genNonce(): string {
  return randomBytes(24).toString("base64").replace(/[+/=]/g, "");
}

/**
 * The OAuth 1.0a signature base string. `params` must include the oauth_* fields
 * and any signed query/form params. `url` is the base URL (no query string).
 * Parameters are sorted by key, each key/value percent-encoded, then the whole
 * encoded parameter string is percent-encoded again.
 */
export function baseString(method: string, url: string, params: Record<string, string>): string {
  const enc = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join("&");
  return [method.toUpperCase(), pct(url), pct(enc)].join("&");
}

/** Raw base64 HMAC-SHA1 signature over the base string. */
export function signature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const base = baseString(method, url, params);
  const key = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
  // OAuth 1.0a mandates this keyed request MAC; it is never used for password storage.
  return createHmac("sha1", key).update(base).digest("base64"); // codeql[js/insufficient-password-hash]
}

/**
 * Build the `Authorization: OAuth ...` header value. `opts.params` are the extra
 * signed params (query params, or form fields for x-www-form-urlencoded bodies);
 * `opts.nonce` / `opts.timestamp` exist so tests can pin the output.
 */
export function header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  token: string,
  tokenSecret: string,
  opts: { params?: Record<string, string>; nonce?: string; timestamp?: number } = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: opts.nonce ?? genNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: "1.0",
  };
  const allParams = { ...(opts.params ?? {}), ...oauth };
  oauth.oauth_signature = signature(method, url, allParams, consumerSecret, tokenSecret);
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
      .join(", ")
  );
}
