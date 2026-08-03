import { PublishError, type DestinationAdapter } from "../types";
import { publishingRequest, publishingResultUrl } from "../safe-network";

/**
 * Publishes a draft to the user's own CMS over a minimal REST convention:
 * POST {base_url}{path} with a bearer key. The endpoint path is configurable
 * per channel (extra.path), defaulting to "/posts". The CMS must answer with
 * JSON containing the live URL (url | link | permalink).
 */
export const cmsAdapter: DestinationAdapter = {
  destination: "cms",
  credentialKind: "api_key",
  refreshable: false,

  async publish({ post, channel }) {
    const baseUrl = channel.credentials.base_url;
    if (!baseUrl) throw new PublishError("CMS channel is missing credentials.base_url");
    const apiKey = channel.credentials.api_key;
    if (!apiKey) throw new PublishError("CMS channel is missing credentials.api_key");

    const path =
      typeof channel.extra.path === "string" && channel.extra.path.length > 0
        ? (channel.extra.path as string)
        : "/posts";
    let endpoint: URL;
    try {
      const base = new URL(baseUrl);
      endpoint = new URL(path.startsWith("/") ? path : `/${path}`, base);
      if (endpoint.origin !== base.origin) {
        throw new Error("origin changed");
      }
    } catch {
      throw new PublishError("CMS destination URL is invalid.");
    }

    const body: Record<string, unknown> = {
      title: post.copy.title,
      body: post.copy.body,
      draftId: post.draftId,
    };
    if (post.copy.tags !== undefined) body.tags = post.copy.tags;

    const res = await publishingRequest(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = res.text();
    if (!res.ok) throw new PublishError(`CMS publish failed (HTTP_${res.status}).`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PublishError("CMS response was not valid JSON.");
    }
    const record = (parsed ?? {}) as Record<string, unknown>;
    const url = record.url ?? record.link ?? record.permalink;
    if (typeof url !== "string" || url.length === 0) {
      throw new PublishError("CMS response contained no valid URL.");
    }
    return { url: publishingResultUrl(url) };
  },
};
