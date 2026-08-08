export type LeadMeetingStatus =
  | 'provisioning'
  | 'joining'
  | 'in_meeting'
  | 'post_processing'
  | 'completed'
  | 'failed';

export interface LeadMeeting {
  id: string;
  leadId: string;
  provider: 'attendee';
  providerBotId: string | null;
  meetingUrl: string;
  status: LeadMeetingStatus;
  statusDetail: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadMeetingEvent {
  id: string;
  meetingId: string;
  providerDeliveryId: string;
  trigger: string;
  eventType: string | null;
  occurredAt: string | null;
  receivedAt: string;
}

export type LeadEvidenceKind = 'manual_update' | 'transcript_utterance';

export interface LeadEvidence {
  id: string;
  leadId: string;
  meetingId: string | null;
  meetingEventId: string | null;
  kind: LeadEvidenceKind;
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
  owner?: string | null;
  dueDate?: string | null;
}

export type LeadTimelineKind =
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

export interface LeadTimelineItem {
  occurredAt: string | null;
  kind: LeadTimelineKind;
  title: string;
  detail: string;
  sourceIds: string[];
  significance: 'milestone' | 'standard';
}

export interface LeadInsightContent {
  relationshipStatus: 'discovery' | 'evaluation' | 'negotiation' | 'committed' | 'at_risk' | 'unknown';
  sentiment: 'positive' | 'neutral' | 'mixed' | 'negative' | 'unknown';
  timeline: LeadTimelineItem[];
  keyPoints: InsightClaim[];
  painPoints: InsightClaim[];
  objections: InsightClaim[];
  commitments: InsightClaim[];
  nextSteps: InsightClaim[];
  openQuestions: InsightClaim[];
}

export type LeadInsightSourceTab = 'overview' | 'transcription' | 'notes';

export interface LeadInsightSourceTarget {
  tab: LeadInsightSourceTab;
  anchorId: string;
  recordId: string;
  meetingId?: string | null;
  offsetMs?: number | null;
}

export interface LeadInsightSourceRef {
  id: string;
  type: 'manual_update' | 'transcript_utterance' | 'note' | 'activity' | 'outreach_message' | 'lead_created';
  label: string;
  createdAt: string;
  occurredAt: string | null;
  target: LeadInsightSourceTarget;
}

export interface LeadSemanticSearchResult {
  content: string;
  score: number;
  source: LeadInsightSourceRef;
}

export interface LeadSemanticSearchResponse {
  query: string;
  indexedCount: number;
  results: LeadSemanticSearchResult[];
}

export interface LeadRelationshipTimeline {
  insightId: string;
  revision: number;
  stage: LeadInsightContent['relationshipStatus'];
  sentiment: LeadInsightContent['sentiment'];
  events: LeadTimelineItem[];
  sourceRefs: LeadInsightSourceRef[];
  generatedAt: string;
}

export function leadInsightSourceTarget(input: {
  id: string;
  type: LeadInsightSourceRef['type'];
  recordId?: string;
  meetingId?: string | null;
  offsetMs?: number | null;
}): LeadInsightSourceTarget {
  const recordId = input.recordId ?? input.id;
  if (input.type === 'activity') {
    return { tab: 'overview', anchorId: `activity-${recordId}`, recordId };
  }
  if (input.type === 'outreach_message') {
    return { tab: 'overview', anchorId: `outreach-${recordId}`, recordId };
  }
  if (input.type === 'lead_created') {
    return { tab: 'overview', anchorId: `lead-created-${recordId}`, recordId };
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

export interface LeadInsightSnapshot {
  id: string;
  leadId: string;
  revision: number;
  status: 'current' | 'superseded';
  summary: string;
  content: LeadInsightContent;
  sourceRefs: LeadInsightSourceRef[];
  evidenceCount: number;
  modelProvider: string;
  modelName: string;
  generatedReason: InsightGeneratedReason;
  createdBy: string | null;
  createdAt: string;
}

export interface LeadIntelligenceWorkspace {
  meetings: LeadMeeting[];
  events: LeadMeetingEvent[];
  evidence: LeadEvidence[];
  insights: LeadInsightSnapshot[];
  timeline: LeadRelationshipTimeline | null;
  attendeeConfigured: boolean;
  semanticSearchConfigured: boolean;
}
