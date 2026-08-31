export type ProspectMeetingStatus =
  | 'provisioning'
  | 'joining'
  | 'in_meeting'
  | 'post_processing'
  | 'completed'
  | 'failed';

export interface ProspectMeeting {
  id: string;
  prospectId: string;
  provider: 'attendee' | 'recall';
  providerBotId: string | null;
  meetingUrl: string;
  status: ProspectMeetingStatus;
  statusDetail: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectMeetingEvent {
  id: string;
  meetingId: string;
  providerDeliveryId: string;
  trigger: string;
  eventType: string | null;
  occurredAt: string | null;
  receivedAt: string;
}

export type ProspectEvidenceKind = 'manual_update' | 'transcript_utterance';

export interface ProspectEvidence {
  id: string;
  prospectId: string;
  meetingId: string | null;
  meetingEventId: string | null;
  kind: ProspectEvidenceKind;
  sourceLabel: string;
  content: string;
  speakerName: string | null;
  speakerExternalId: string | null;
  speakerIsHost: boolean | null;
  offsetMs: number | null;
  durationMs: number | null;
  occurredAt: string | null;
  createdBy: string | null;
  actorType: 'user' | 'service' | 'system';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface InsightClaim {
  text: string;
  sourceIds: string[];
  claimIds?: string[];
  owner?: string | null;
  dueDate?: string | null;
}

export type ProspectTimelineKind =
  | 'discovered'
  | 'reaction'
  | 'comment'
  | 'connection_request'
  | 'connection_accepted'
  | 'message_sent'
  | 'reply_received'
  | 'meeting'
  | 'note'
  | 'update'
  | 'status_change'
  | 'research'
  | 'other';

export interface ProspectTimelineItem {
  occurredAt: string | null;
  kind: ProspectTimelineKind;
  title: string;
  detail: string;
  sourceIds: string[];
  claimIds?: string[];
  significance: 'milestone' | 'standard';
}

export interface ProspectInsightContent {
  relationshipStatus: 'discovery' | 'evaluation' | 'negotiation' | 'committed' | 'at_risk' | 'unknown';
  sentiment: 'positive' | 'neutral' | 'mixed' | 'negative' | 'unknown';
  timeline: ProspectTimelineItem[];
  keyPoints: InsightClaim[];
  painPoints: InsightClaim[];
  objections: InsightClaim[];
  commitments: InsightClaim[];
  nextSteps: InsightClaim[];
  openQuestions: InsightClaim[];
}

export type ProspectInsightSourceTab = 'overview' | 'transcription' | 'notes';

export interface ProspectInsightSourceTarget {
  tab: ProspectInsightSourceTab;
  anchorId: string;
  recordId: string;
  meetingId?: string | null;
  offsetMs?: number | null;
}

export interface ProspectInsightSourceRef {
  id: string;
  type: 'manual_update' | 'transcript_utterance' | 'note' | 'activity' | 'outreach_message' | 'prospect_created';
  label: string;
  createdAt: string;
  occurredAt: string | null;
  target: ProspectInsightSourceTarget;
}

export interface ProspectSemanticSearchResult {
  content: string;
  score: number;
  source: ProspectInsightSourceRef;
}

export interface ProspectSemanticSearchResponse {
  query: string;
  indexedCount: number;
  results: ProspectSemanticSearchResult[];
}

export interface ProspectRelationshipTimeline {
  insightId: string;
  revision: number;
  stage: ProspectInsightContent['relationshipStatus'];
  sentiment: ProspectInsightContent['sentiment'];
  events: ProspectTimelineItem[];
  sourceRefs: ProspectInsightSourceRef[];
  generatedAt: string;
}

export function prospectInsightSourceTarget(input: {
  id: string;
  type: ProspectInsightSourceRef['type'];
  recordId?: string;
  meetingId?: string | null;
  offsetMs?: number | null;
}): ProspectInsightSourceTarget {
  const recordId = input.recordId ?? input.id;
  if (input.type === 'activity') {
    return { tab: 'overview', anchorId: `activity-${recordId}`, recordId };
  }
  if (input.type === 'outreach_message') {
    return { tab: 'overview', anchorId: `outreach-${recordId}`, recordId };
  }
  if (input.type === 'prospect_created') {
    return { tab: 'overview', anchorId: `prospect-created-${recordId}`, recordId };
  }
  if (input.type === 'note') {
    const noteId = input.id.startsWith('note:') ? input.id.slice('note:'.length) : input.id;
    return {
      tab: 'notes',
      anchorId: `note-${noteId}`,
      recordId: noteId,
    };
  }
  return {
    tab: input.type === 'transcript_utterance' ? 'transcription' : 'notes',
    anchorId: `evidence-${recordId}`,
    recordId,
    ...(input.meetingId !== undefined ? { meetingId: input.meetingId } : {}),
    ...(input.offsetMs !== undefined ? { offsetMs: input.offsetMs } : {}),
  };
}

export type InsightGeneratedReason =
  | 'manual'
  | 'manual_update'
  | 'meeting_completed'
  | 'activity_update'
  | 'outreach_sent';

export interface ProspectInsightSnapshot {
  id: string;
  prospectId: string;
  revision: number;
  status: 'current' | 'superseded';
  summary: string;
  content: ProspectInsightContent;
  sourceRefs: ProspectInsightSourceRef[];
  evidenceCount: number;
  modelProvider: string;
  modelName: string;
  generatedReason: InsightGeneratedReason;
  createdBy: string | null;
  createdAt: string;
}

export interface ProspectIntelligenceWorkspace {
  meetings: ProspectMeeting[];
  events: ProspectMeetingEvent[];
  evidence: ProspectEvidence[];
  insights: ProspectInsightSnapshot[];
  timeline: ProspectRelationshipTimeline | null;
  meetingCaptureConfigured: boolean;
  meetingCaptureProvider: 'recall' | null;
  semanticSearchConfigured: boolean;
}
