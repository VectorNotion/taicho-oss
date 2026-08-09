import type {
  LeadEvidence,
  LeadMeeting,
} from "../../../domain/lead-intelligence";

export interface TranscriptGroup {
  key: string;
  kind: "meeting" | "desktop_recording" | "unattributed";
  meeting: LeadMeeting | null;
  externalRecordingId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  utterances: LeadEvidence[];
}

export function transcriptSpeakerLabel(
  item: LeadEvidence,
  group: TranscriptGroup,
  leadName: string,
): string {
  if (group.kind === "desktop_recording") {
    return item.speakerIsHost ? "Me" : leadName.trim() || "Client";
  }
  return item.speakerName || "Unknown speaker";
}

function metadataString(item: LeadEvidence, key: string): string | null {
  const value = item.metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareUtterances(left: LeadEvidence, right: LeadEvidence): number {
  const leftOffset = left.offsetMs ?? Number.MAX_SAFE_INTEGER;
  const rightOffset = right.offsetMs ?? Number.MAX_SAFE_INTEGER;
  return leftOffset - rightOffset
    || timestamp(left.occurredAt) - timestamp(right.occurredAt)
    || timestamp(left.createdAt) - timestamp(right.createdAt)
    || left.id.localeCompare(right.id);
}

function inferredDuration(utterances: LeadEvidence[]): number | null {
  const values = utterances.flatMap((item) => item.offsetMs == null
    ? []
    : [item.offsetMs + (item.durationMs ?? 0)]);
  return values.length ? Math.max(...values) : null;
}

export function groupTranscriptEvidence(
  evidence: LeadEvidence[],
  meetings: LeadMeeting[],
): TranscriptGroup[] {
  const meetingsById = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const grouped = new Map<string, LeadEvidence[]>();

  for (const item of evidence) {
    const externalRecordingId = metadataString(item, "externalRecordingId");
    const key = item.meetingId
      ? `meeting:${item.meetingId}`
      : externalRecordingId
        ? `desktop:${externalRecordingId}`
        : `unattributed:${item.id}`;
    const values = grouped.get(key) ?? [];
    values.push(item);
    grouped.set(key, values);
  }

  return [...grouped.entries()]
    .map(([key, values]): TranscriptGroup => {
      const utterances = [...values].sort(compareUtterances);
      const first = utterances[0];
      const meeting = first.meetingId ? meetingsById.get(first.meetingId) ?? null : null;
      const externalRecordingId = metadataString(first, "externalRecordingId");
      const startedAt = meeting?.startedAt
        ?? meeting?.scheduledFor
        ?? metadataString(first, "recordingStartedAt")
        ?? first.occurredAt
        ?? first.createdAt;
      const endedAt = meeting?.endedAt
        ?? metadataString(first, "recordingEndedAt")
        ?? null;
      const explicitDuration = endedAt
        ? Math.max(0, timestamp(endedAt) - timestamp(startedAt))
        : null;
      return {
        key,
        kind: meeting
          ? "meeting"
          : externalRecordingId
            ? "desktop_recording"
            : "unattributed",
        meeting,
        externalRecordingId,
        startedAt,
        endedAt,
        durationMs: explicitDuration ?? inferredDuration(utterances),
        utterances,
      };
    })
    .sort((left, right) => timestamp(right.startedAt) - timestamp(left.startedAt)
      || right.key.localeCompare(left.key));
}
