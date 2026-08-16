import type { ActionItem } from "./action-items";
import type {
  Prospect,
  ProspectLifecycle,
  ProspectPipelineState,
} from "./types";

export interface ProspectPipelineEvidence {
  hasResearch: boolean;
  hasDraft: boolean;
  hasSentMessage: boolean;
  nextAction?: ActionItem;
}

/**
 * Derive the listing lifecycle from durable evidence instead of requiring
 * operators to keep a second status field in sync by hand.
 */
export function deriveProspectPipelineState(
  prospect: Pick<Prospect, "status" | "lastContactedAt">,
  evidence: ProspectPipelineEvidence,
): ProspectPipelineState {
  const hasContact = Boolean(prospect.lastContactedAt)
    || evidence.hasSentMessage
    || ["contacted", "replied", "unresponsive", "converted"].includes(prospect.status);
  const lifecycle: ProspectLifecycle = prospect.status === "replied"
    ? "replied"
    : hasContact
      ? "contacted"
      : evidence.nextAction
        ? "follow_up_scheduled"
        : evidence.hasDraft
          ? "draft_ready"
          : evidence.hasResearch || ["researched", "qualified"].includes(prospect.status)
            ? "researched"
            : "untouched";

  return {
    lifecycle,
    hasResearch: evidence.hasResearch,
    hasDraft: evidence.hasDraft,
    hasContact,
    nextAction: evidence.nextAction,
  };
}
