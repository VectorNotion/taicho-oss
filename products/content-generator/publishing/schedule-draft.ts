/**
 * Draft → publishing queue, shared between the publish route
 * (apps/content-generator/app/api/content/drafts/[id]/publish/route.ts) and the
 * platform registry's `schedule_post` action. `buildDraftCopy`, the `when`
 * semantics, and the idempotency key are the route's originals, extracted —
 * one implementation, two callers.
 */
import type { Pool } from "pg";
import "./adapters";
import { getContentDraftById } from "../data/content-repository";
import type { ContentDraft } from "../domain/content";
import {
  getContentAsset,
  getSelectedContentAssetForDraft,
} from "../media/repository";
import { getChannel, listChannels } from "./channel-repository";
import { getPublishingAdminPool, getPublishingPool } from "./pool";
import { schedulePost } from "./post-repository";
import { hasAdapter } from "./registry";
import { ensurePublishingSchema } from "./schema";
import type { PostRecord } from "./types";

const X_MAX_CHARS = 280;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Shape the draft into the copy each destination's adapter expects. */
export function buildDraftCopy(
  destination: string,
  draft: ContentDraft,
): Record<string, unknown> {
  switch (destination) {
    case "x":
      return { text: truncate(`${draft.title}\n\n${draft.content}`, X_MAX_CHARS) };
    case "linkedin":
      return { body: draft.content };
    case "cms":
      return { title: draft.title, body: draft.content, tags: [] };
    case "webhook":
      return { ...draft };
    case "youtube":
      return { title: draft.title, description: draft.content };
    case "instagram":
      return { title: draft.title, caption: draft.content };
    default:
      return { title: draft.title, body: draft.content };
  }
}

export type ScheduleDraftErrorCode =
  | "UNKNOWN_DESTINATION"
  | "INVALID_WHEN"
  | "DRAFT_NOT_FOUND"
  | "CHANNEL_NOT_FOUND"
  | "CHANNEL_MISMATCH"
  | "CHANNEL_AMBIGUOUS"
  | "ASSET_NOT_FOUND";

export class ScheduleDraftError extends Error {
  constructor(
    readonly code: ScheduleDraftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScheduleDraftError";
  }
}

/** `when` semantics of the publish route: absent/empty → immediate; invalid → error. */
export function resolvePublishAt(when?: string | null): Date {
  if (when === undefined || when === null || when === "") return new Date();
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) {
    throw new ScheduleDraftError("INVALID_WHEN", "Invalid schedule time");
  }
  return at;
}

export interface ScheduleDraftPostInput {
  draftId: string;
  destination: string;
  /** Omitted → resolve the single enabled channel for the destination. */
  channelId?: string;
  /** ISO datetime; absent → immediate (next worker pass). */
  when?: string;
  /** Seam for callers that already loaded the draft (and for DB-only tests). */
  draft?: ContentDraft;
  /** Optional explicit generated asset; otherwise the selected compatible asset is used. */
  assetId?: string;
}

async function publishingAsset(pool: Pool, input: ScheduleDraftPostInput) {
  if (input.assetId) {
    const asset = await getContentAsset(pool, input.assetId);
    if (!asset || asset.draftId !== input.draftId) {
      throw new ScheduleDraftError("ASSET_NOT_FOUND", "Content asset not found");
    }
    return asset;
  }
  switch (input.destination) {
    case "youtube":
      return getSelectedContentAssetForDraft(pool, input.draftId, ["primary"], ["video"]);
    case "cms":
      return getSelectedContentAssetForDraft(pool, input.draftId, ["hero", "primary"]);
    case "x":
    case "linkedin":
    case "instagram":
      return getSelectedContentAssetForDraft(pool, input.draftId, ["primary"]);
    default:
      return getSelectedContentAssetForDraft(pool, input.draftId);
  }
}

export async function scheduleDraftPost(
  pool: Pool,
  input: ScheduleDraftPostInput,
): Promise<PostRecord> {
  if (!hasAdapter(input.destination)) {
    throw new ScheduleDraftError("UNKNOWN_DESTINATION", "Unknown destination");
  }
  const publishAt = resolvePublishAt(input.when);
  const draft = input.draft ?? (await getContentDraftById(input.draftId));
  if (!draft) throw new ScheduleDraftError("DRAFT_NOT_FOUND", "Content draft not found");

  let channelId = input.channelId;
  if (!channelId) {
    const candidates = (await listChannels(pool)).filter(
      (channel) => channel.destination === input.destination,
    );
    if (candidates.length === 0) {
      throw new ScheduleDraftError("CHANNEL_NOT_FOUND", "Channel not found or disconnected");
    }
    if (candidates.length > 1) {
      throw new ScheduleDraftError(
        "CHANNEL_AMBIGUOUS",
        `Multiple ${input.destination} channels are connected; pass channelId`,
      );
    }
    channelId = candidates[0].id;
  }
  const channel = await getChannel(pool, channelId);
  if (!channel || channel.disabled) {
    throw new ScheduleDraftError("CHANNEL_NOT_FOUND", "Channel not found or disconnected");
  }
  if (channel.destination !== input.destination) {
    throw new ScheduleDraftError(
      "CHANNEL_MISMATCH",
      "Channel does not belong to the requested destination",
    );
  }

  const asset = await publishingAsset(pool, input);

  return schedulePost(pool, {
    draftId: input.draftId,
    destination: input.destination,
    channelId,
    copy: buildDraftCopy(input.destination, draft),
    mediaKey: asset?.r2Key ?? null,
    publishAt,
    idempotencyKey: asset
      ? `${input.draftId}:${input.destination}:${channelId}:${asset.id}`
      : `${input.draftId}:${input.destination}:${channelId}`,
  });
}

let schemaReady: Promise<void> | null = null;

/**
 * Org-scoped publishing pool with the schema guaranteed once per process.
 * Headless twin of apps/content-generator/app/api/content/_publishing/db.ts
 * (which owns the request-header auth seam) for callers that carry the
 * organization in AsyncLocalStorage — i.e. registry handlers.
 */
export async function readyPublishingPool(organizationId: string): Promise<Pool> {
  if (!schemaReady) {
    schemaReady = ensurePublishingSchema(getPublishingAdminPool()).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return getPublishingPool(organizationId);
}
