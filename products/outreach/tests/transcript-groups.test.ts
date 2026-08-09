import assert from "node:assert/strict";
import test from "node:test";
import type {
  LeadEvidence,
  LeadMeeting,
} from "../domain/lead-intelligence";
import {
  groupTranscriptEvidence,
  transcriptSpeakerLabel,
} from "../ui/components/leads/transcript-groups";

function evidence(input: {
  id: string;
  meetingId?: string;
  recordingId?: string;
  recordingStartedAt?: string;
  offsetMs: number;
}): LeadEvidence {
  return {
    id: input.id,
    leadId: "lead-1",
    meetingId: input.meetingId ?? null,
    meetingEventId: null,
    kind: "transcript_utterance",
    sourceLabel: "Transcript",
    content: input.id,
    speakerName: "Speaker",
    speakerExternalId: null,
    speakerIsHost: false,
    offsetMs: input.offsetMs,
    durationMs: 1_000,
    occurredAt: "2026-08-09T10:00:00.000Z",
    createdBy: null,
    actorType: "system",
    metadata: {
      ...(input.recordingId ? { externalRecordingId: input.recordingId } : {}),
      ...(input.recordingStartedAt ? { recordingStartedAt: input.recordingStartedAt } : {}),
    },
    createdAt: "2026-08-09T11:00:00.000Z",
  };
}

const meeting: LeadMeeting = {
  id: "meeting-1",
  leadId: "lead-1",
  provider: "recall",
  providerBotId: "bot-1",
  meetingUrl: "https://meet.google.com/example",
  status: "completed",
  statusDetail: null,
  scheduledFor: null,
  startedAt: "2026-08-09T09:00:00.000Z",
  endedAt: "2026-08-09T09:30:00.000Z",
  createdBy: null,
  createdAt: "2026-08-09T08:55:00.000Z",
  updatedAt: "2026-08-09T09:30:00.000Z",
};

test("groups each meeting and desktop recording independently", () => {
  const groups = groupTranscriptEvidence([
    evidence({ id: "recording-a-late", recordingId: "recording-a", recordingStartedAt: "2026-08-09T10:00:00.000Z", offsetMs: 8_000 }),
    evidence({ id: "meeting", meetingId: "meeting-1", offsetMs: 2_000 }),
    evidence({ id: "recording-b", recordingId: "recording-b", recordingStartedAt: "2026-08-09T11:00:00.000Z", offsetMs: 1_000 }),
    evidence({ id: "recording-a-early", recordingId: "recording-a", recordingStartedAt: "2026-08-09T10:00:00.000Z", offsetMs: 1_000 }),
  ], [meeting]);

  assert.deepEqual(groups.map((group) => group.key), [
    "desktop:recording-b",
    "desktop:recording-a",
    "meeting:meeting-1",
  ]);
  assert.deepEqual(
    groups.find((group) => group.key === "desktop:recording-a")?.utterances.map((item) => item.id),
    ["recording-a-early", "recording-a-late"],
  );
  assert.equal(groups.find((group) => group.key === "meeting:meeting-1")?.durationMs, 30 * 60 * 1_000);
});

test("never combines unattributed transcript evidence", () => {
  const groups = groupTranscriptEvidence([
    evidence({ id: "unknown-a", offsetMs: 0 }),
    evidence({ id: "unknown-b", offsetMs: 1_000 }),
  ], []);

  assert.deepEqual(groups.map((group) => group.key).sort(), [
    "unattributed:unknown-a",
    "unattributed:unknown-b",
  ]);
});

test("labels desktop tracks as Me and the selected client", () => {
  const [group] = groupTranscriptEvidence([
    { ...evidence({ id: "mic", recordingId: "recording-a", offsetMs: 0 }), speakerName: "operator", speakerIsHost: true },
    { ...evidence({ id: "remote", recordingId: "recording-a", offsetMs: 1_000 }), speakerName: "Speaker 1", speakerIsHost: false },
  ], []);

  assert.equal(transcriptSpeakerLabel(group.utterances[0], group, "Alex Client"), "Me");
  assert.equal(transcriptSpeakerLabel(group.utterances[1], group, "Alex Client"), "Alex Client");
});
