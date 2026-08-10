import {
  outreach_prospect_evidence as evidenceTable,
  outreach_prospect_insight_snapshots as insightsTable,
  outreach_prospect_meeting_events as eventsTable,
  outreach_prospect_meetings as meetingsTable,
} from '@content-automation/database';
import { tenantDatabase } from '@content-automation/platform/data/tenant-database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  prospectInsightSourceTarget,
  type InsightGeneratedReason,
  type ProspectEvidence,
  type ProspectInsightContent,
  type ProspectInsightSnapshot,
  type ProspectInsightSourceRef,
  type ProspectInsightSourceTarget,
  type ProspectIntelligenceWorkspace,
  type ProspectMeeting,
  type ProspectMeetingEvent,
  type ProspectMeetingStatus,
} from '../domain/prospect-intelligence';

type MeetingRow = typeof meetingsTable.$inferSelect;
type EventRow = typeof eventsTable.$inferSelect;
type EvidenceRow = typeof evidenceTable.$inferSelect;
type InsightRow = typeof insightsTable.$inferSelect;

function meeting(row: MeetingRow): ProspectMeeting {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    provider: row.provider as ProspectMeeting['provider'],
    providerBotId: row.provider_bot_id,
    meetingUrl: row.meeting_url,
    status: row.status as ProspectMeetingStatus,
    statusDetail: row.status_detail,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function meetingEvent(row: EventRow): ProspectMeetingEvent {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    providerDeliveryId: row.provider_delivery_id,
    trigger: row.trigger,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
  };
}

function evidence(row: EvidenceRow): ProspectEvidence {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    meetingId: row.meeting_id,
    meetingEventId: row.meeting_event_id,
    kind: row.kind as ProspectEvidence['kind'],
    sourceLabel: row.source_label,
    content: row.content,
    speakerName: row.speaker_name,
    speakerExternalId: row.speaker_external_id,
    speakerIsHost: row.speaker_is_host,
    offsetMs: row.offset_ms,
    durationMs: row.duration_ms,
    occurredAt: row.occurred_at,
    createdBy: row.created_by,
    actorType: row.actor_type as ProspectEvidence['actorType'],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function storedSourceTarget(value: unknown): ProspectInsightSourceTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if ((target.tab !== 'overview' && target.tab !== 'transcription' && target.tab !== 'notes')
    || typeof target.anchorId !== 'string'
    || typeof target.recordId !== 'string') return null;
  return {
    tab: target.tab,
    anchorId: target.anchorId,
    recordId: target.recordId,
    ...(typeof target.meetingId === 'string' || target.meetingId === null
      ? { meetingId: target.meetingId }
      : {}),
    ...(typeof target.offsetMs === 'number' || target.offsetMs === null
      ? { offsetMs: target.offsetMs }
      : {}),
  };
}

function sourceRefs(value: unknown): ProspectInsightSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    if (typeof source.id !== 'string'
      || (source.type !== 'manual_update'
        && source.type !== 'transcript_utterance'
        && source.type !== 'note'
        && source.type !== 'activity'
        && source.type !== 'outreach_message'
        && source.type !== 'prospect_created')
      || typeof source.label !== 'string'
      || typeof source.createdAt !== 'string') return [];
    return [{
      id: source.id,
      type: source.type,
      label: source.label,
      createdAt: source.createdAt,
      occurredAt: typeof source.occurredAt === 'string' || source.occurredAt === null
        ? source.occurredAt
        : source.createdAt,
      target: storedSourceTarget(source.target) ?? prospectInsightSourceTarget({
        id: source.id,
        type: source.type,
      }),
    }];
  });
}

function insightContent(value: unknown): ProspectInsightContent {
  const content = value as ProspectInsightContent;
  return {
    ...content,
    timeline: Array.isArray(content?.timeline) ? content.timeline : [],
  };
}

function insight(row: InsightRow): ProspectInsightSnapshot {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    revision: row.revision,
    status: row.status as ProspectInsightSnapshot['status'],
    summary: row.summary,
    content: insightContent(row.content),
    sourceRefs: sourceRefs(row.source_refs),
    evidenceCount: row.evidence_count,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    generatedReason: row.generated_reason as InsightGeneratedReason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function createProspectMeeting(input: {
  organizationId: string;
  prospectId: string;
  provider: ProspectMeeting['provider'];
  meetingUrl: string;
  scheduledFor?: string;
  createdBy?: string;
}): Promise<ProspectMeeting> {
  const [row] = await tenantDatabase(input.organizationId)
    .insert(meetingsTable)
    .values({
      organization_id: input.organizationId,
      prospect_id: input.prospectId,
      provider: input.provider,
      meeting_url: input.meetingUrl,
      scheduled_for: input.scheduledFor,
      created_by: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('Meeting record was not created.');
  return meeting(row);
}

export async function attachProviderBot(input: {
  organizationId: string;
  meetingId: string;
  providerBotId: string;
  status?: ProspectMeetingStatus;
}): Promise<ProspectMeeting> {
  const [row] = await tenantDatabase(input.organizationId)
    .update(meetingsTable)
    .set({
      provider_bot_id: input.providerBotId,
      status: input.status ?? 'joining',
      status_detail: null,
      updated_at: new Date().toISOString(),
    })
    .where(and(
      eq(meetingsTable.organization_id, input.organizationId),
      eq(meetingsTable.id, input.meetingId),
    ))
    .returning();
  if (!row) throw new Error('Meeting record was not found.');
  return meeting(row);
}

export async function setProspectMeetingStatus(input: {
  organizationId: string;
  meetingId: string;
  status: ProspectMeetingStatus;
  detail?: string | null;
  startedAt?: string;
  endedAt?: string;
}): Promise<ProspectMeeting | null> {
  const [row] = await tenantDatabase(input.organizationId)
    .update(meetingsTable)
    .set({
      status: input.status,
      status_detail: input.detail ?? null,
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
      ...(input.endedAt ? { ended_at: input.endedAt } : {}),
      updated_at: new Date().toISOString(),
    })
    .where(and(
      eq(meetingsTable.organization_id, input.organizationId),
      eq(meetingsTable.id, input.meetingId),
    ))
    .returning();
  return row ? meeting(row) : null;
}

export async function getProspectMeeting(
  organizationId: string,
  meetingId: string,
): Promise<ProspectMeeting | null> {
  const [row] = await tenantDatabase(organizationId)
    .select()
    .from(meetingsTable)
    .where(and(
      eq(meetingsTable.organization_id, organizationId),
      eq(meetingsTable.id, meetingId),
    ))
    .limit(1);
  return row ? meeting(row) : null;
}

export async function createManualProspectEvidence(input: {
  organizationId: string;
  prospectId: string;
  content: string;
  createdBy?: string;
  actorType?: ProspectEvidence['actorType'];
}): Promise<ProspectEvidence> {
  const [row] = await tenantDatabase(input.organizationId)
    .insert(evidenceTable)
    .values({
      organization_id: input.organizationId,
      prospect_id: input.prospectId,
      kind: 'manual_update',
      source_label: 'Manual update',
      content: input.content.trim(),
      created_by: input.createdBy,
      actor_type: input.actorType ?? 'user',
    })
    .returning();
  if (!row) throw new Error('Manual update was not created.');
  return evidence(row);
}

export interface TranscriptUtteranceInput {
  sourceKey: string;
  content: string;
  speakerName?: string | null;
  speakerExternalId?: string | null;
  speakerIsHost?: boolean | null;
  offsetMs?: number | null;
  durationMs?: number | null;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
}

export async function insertTranscriptUtterances(input: {
  organizationId: string;
  prospectId: string;
  meetingId?: string;
  meetingEventId?: string;
  utterances: TranscriptUtteranceInput[];
}): Promise<number> {
  if (input.utterances.length === 0) return 0;
  const rows = await tenantDatabase(input.organizationId)
    .insert(evidenceTable)
    .values(input.utterances.map((utterance) => ({
      organization_id: input.organizationId,
      prospect_id: input.prospectId,
      meeting_id: input.meetingId,
      meeting_event_id: input.meetingEventId,
      kind: 'transcript_utterance',
      source_key: utterance.sourceKey,
      source_label: utterance.speakerName
        ? `Transcript · ${utterance.speakerName}`
        : 'Transcript',
      content: utterance.content.trim(),
      speaker_name: utterance.speakerName,
      speaker_external_id: utterance.speakerExternalId,
      speaker_is_host: utterance.speakerIsHost,
      offset_ms: utterance.offsetMs,
      duration_ms: utterance.durationMs,
      occurred_at: utterance.occurredAt,
      actor_type: 'system',
      metadata: utterance.metadata ?? {},
    })))
    .onConflictDoNothing()
    .returning({ id: evidenceTable.id });
  return rows.length;
}

export async function recordProspectMeetingEvent(input: {
  organizationId: string;
  meetingId: string;
  providerBotId: string;
  providerDeliveryId: string;
  trigger: string;
  eventType?: string | null;
  payload: Record<string, unknown>;
  occurredAt?: string | null;
  transcriptUtterance?: TranscriptUtteranceInput;
}): Promise<{ event: ProspectMeetingEvent | null; meeting: ProspectMeeting | null; duplicate: boolean }> {
  return tenantDatabase(input.organizationId).transaction(async (transaction) => {
    const [meetingRow] = await transaction
      .select()
      .from(meetingsTable)
      .where(and(
        eq(meetingsTable.organization_id, input.organizationId),
        eq(meetingsTable.id, input.meetingId),
        eq(meetingsTable.provider_bot_id, input.providerBotId),
      ))
      .limit(1);
    if (!meetingRow) return { event: null, meeting: null, duplicate: false };

    const [eventRow] = await transaction
      .insert(eventsTable)
      .values({
        organization_id: input.organizationId,
        meeting_id: input.meetingId,
        provider_delivery_id: input.providerDeliveryId,
        trigger: input.trigger,
        event_type: input.eventType,
        payload: input.payload,
        occurred_at: input.occurredAt,
      })
      .onConflictDoNothing({
        target: [eventsTable.organization_id, eventsTable.provider_delivery_id],
      })
      .returning();

    if (eventRow && input.transcriptUtterance?.content.trim()) {
      const utterance = input.transcriptUtterance;
      await transaction.insert(evidenceTable).values({
        organization_id: input.organizationId,
        prospect_id: meetingRow.prospect_id,
        meeting_id: input.meetingId,
        meeting_event_id: eventRow.id,
        kind: 'transcript_utterance',
        source_key: utterance.sourceKey,
        source_label: utterance.speakerName
          ? `Transcript · ${utterance.speakerName}`
          : 'Transcript',
        content: utterance.content.trim(),
        speaker_name: utterance.speakerName,
        speaker_external_id: utterance.speakerExternalId,
        speaker_is_host: utterance.speakerIsHost,
        offset_ms: utterance.offsetMs,
        duration_ms: utterance.durationMs,
        occurred_at: utterance.occurredAt,
        actor_type: 'system',
        metadata: utterance.metadata ?? {},
      }).onConflictDoNothing();
    }

    return {
      event: eventRow ? meetingEvent(eventRow) : null,
      meeting: meeting(meetingRow),
      duplicate: !eventRow,
    };
  });
}

export async function commitProspectInsight(input: {
  organizationId: string;
  prospectId: string;
  summary: string;
  content: ProspectInsightContent;
  sourceRefs: ProspectInsightSourceRef[];
  modelProvider: string;
  modelName: string;
  generatedReason: InsightGeneratedReason;
  createdBy?: string;
}): Promise<ProspectInsightSnapshot> {
  return tenantDatabase(input.organizationId).transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.prospectId}`}, 0))`);
    const [latest] = await transaction
      .select({ revision: insightsTable.revision })
      .from(insightsTable)
      .where(and(
        eq(insightsTable.organization_id, input.organizationId),
        eq(insightsTable.prospect_id, input.prospectId),
      ))
      .orderBy(desc(insightsTable.revision))
      .limit(1);
    await transaction
      .update(insightsTable)
      .set({ status: 'superseded' })
      .where(and(
        eq(insightsTable.organization_id, input.organizationId),
        eq(insightsTable.prospect_id, input.prospectId),
        eq(insightsTable.status, 'current'),
      ));
    const [created] = await transaction
      .insert(insightsTable)
      .values({
        organization_id: input.organizationId,
        prospect_id: input.prospectId,
        revision: (latest?.revision ?? 0) + 1,
        summary: input.summary,
        content: input.content,
        source_refs: input.sourceRefs,
        evidence_count: input.sourceRefs.length,
        model_provider: input.modelProvider,
        model_name: input.modelName,
        generated_reason: input.generatedReason,
        created_by: input.createdBy,
      })
      .returning();
    if (!created) throw new Error('Insight snapshot was not created.');
    return insight(created);
  });
}

export async function getProspectIntelligenceWorkspace(
  organizationId: string,
  prospectId: string,
  meetingCaptureConfigured = false,
  semanticSearchConfigured = false,
): Promise<ProspectIntelligenceWorkspace> {
  const database = tenantDatabase(organizationId);
  const [meetingRows, evidenceRows, insightRows] = await Promise.all([
    database.select().from(meetingsTable).where(and(
      eq(meetingsTable.organization_id, organizationId),
      eq(meetingsTable.prospect_id, prospectId),
    )).orderBy(desc(meetingsTable.created_at)),
    database.select().from(evidenceTable).where(and(
      eq(evidenceTable.organization_id, organizationId),
      eq(evidenceTable.prospect_id, prospectId),
    )).orderBy(asc(evidenceTable.created_at)),
    database.select().from(insightsTable).where(and(
      eq(insightsTable.organization_id, organizationId),
      eq(insightsTable.prospect_id, prospectId),
    )).orderBy(desc(insightsTable.revision)),
  ]);
  const meetingIds = meetingRows.map((row) => row.id);
  const eventRows = meetingIds.length
    ? await database.select().from(eventsTable).where(and(
      eq(eventsTable.organization_id, organizationId),
      inArray(eventsTable.meeting_id, meetingIds),
    )).orderBy(asc(eventsTable.received_at))
    : [];
  const insights = insightRows.map(insight);
  const currentInsight = insights.find((item) => item.status === 'current') ?? insights[0] ?? null;
  return {
    meetings: meetingRows.map(meeting),
    events: eventRows.map(meetingEvent),
    evidence: evidenceRows.map(evidence),
    insights,
    timeline: currentInsight ? {
      insightId: currentInsight.id,
      revision: currentInsight.revision,
      stage: currentInsight.content.relationshipStatus,
      sentiment: currentInsight.content.sentiment,
      events: currentInsight.content.timeline,
      sourceRefs: currentInsight.sourceRefs,
      generatedAt: currentInsight.createdAt,
    } : null,
    meetingCaptureConfigured,
    meetingCaptureProvider: meetingCaptureConfigured ? 'recall' : null,
    semanticSearchConfigured,
  };
}
