import { currentExecutionContext } from "@content-automation/observability";
import { recordCalendarEntryChange } from "@content-automation/platform/calendar/events";
import type { PostRecord, PostStatus } from "./types";

const stateByStatus = {
  scheduled: "scheduled",
  publishing: "in_progress",
  published: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

function destinationLabel(destination: string): string {
  return destination.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function postTitle(post: PostRecord): string {
  const title = post.copy.title;
  return typeof title === "string" && title.trim()
    ? title.trim()
    : `${destinationLabel(post.destination)} publication`;
}

export async function recordPublishingCalendarChange(
  post: PostRecord,
  status: PostStatus = post.status,
): Promise<void> {
  const organizationId = post.organizationId ?? currentExecutionContext()?.organizationId ?? null;
  if (!organizationId) return;
  const changedAt = new Date().toISOString();
  await recordCalendarEntryChange({
    organizationId,
    change: {
      operation: "upsert",
      moduleKey: "publishing",
      kindKey: "publishing.post",
      sourceId: post.id,
      revision: `${status}:${post.publishAt.toISOString()}:${post.attempts}`,
      changedAt,
      entry: {
        state: stateByStatus[status],
        title: postTitle(post),
        description: `${destinationLabel(post.destination)} · ${status.replaceAll("_", " ")}`,
        startsAt: post.publishAt.toISOString(),
        endsAt: null,
        allDay: false,
        timezone: "UTC",
        href: post.draftId
          ? `/content/drafts/${encodeURIComponent(post.draftId)}`
          : "/calendar",
        metadata: {
          postId: post.id,
          draftId: post.draftId,
          destination: post.destination,
          channelId: post.channelId,
          resultUrl: post.resultUrl,
          error: post.error,
          attempts: post.attempts,
        },
      },
    },
  });
}
