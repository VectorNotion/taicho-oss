import { createLogger, runWithExecutionContext } from '@content-automation/observability';
import { emitProductEvent, recordProductEvent } from '@content-automation/platform/events/emit';
import { runWithGraphOrganization } from '@content-automation/platform/data/organization-context';
import { generateProspectInsights } from '../agent/prospect-insights';
import {
  attachProviderBot,
  createProspectMeeting,
  getProspectMeeting,
  insertTranscriptUtterances,
  recordProspectMeetingEvent,
  setProspectMeetingStatus,
} from '../data/prospect-intelligence-repository';
import type { ProspectMeetingStatus } from '../domain/prospect-intelligence';
import {
  attendeeUtteranceSourceKey,
  getAttendeeTranscript,
  parseAttendeeTranscriptUtterance,
  type AttendeeTranscriptUtterance,
  type AttendeeWebhookPayload,
} from '../integrations/attendee';
import {
  createRecallBot,
  getRecallTranscript,
  recallTranscriptInput,
  type RecallWebhookPayload,
} from '../integrations/recall';
import { getProspectById } from '../data/prospect-repository';
import { OUTREACH_TRANSCRIPT_KNOWLEDGE_EVENT } from '../knowledge-events';

const log = createLogger('outreach.prospect-meeting');

async function recordTranscriptKnowledgeEvent(input: {
  organizationId: string;
  prospect: { id: string; name: string };
  sourceId: string;
  provider: string;
  startedAt?: string | null;
  endedAt?: string | null;
  utterances: Array<{
    sourceKey: string;
    content: string;
    speakerName?: string | null;
    speakerExternalId?: string | null;
    speakerIsHost?: boolean | null;
    offsetMs?: number | null;
    confidence?: number | null;
  }>;
}) {
  if (input.utterances.length === 0) return null;
  return recordProductEvent({
    organizationId: input.organizationId,
    name: OUTREACH_TRANSCRIPT_KNOWLEDGE_EVENT,
    origin: 'internal',
    idempotencyKey: `${input.provider}:${input.sourceId}`,
    refs: { prospectId: input.prospect.id },
    payload: {
      prospect: input.prospect,
      sourceId: input.sourceId,
      provider: input.provider,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      utterances: input.utterances,
    },
  });
}

export function validateMeetingUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 4_000) throw new Error('Meeting link is too long.');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid meeting link.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error('Meeting links must use HTTPS.');
  }
  return url.toString();
}

export async function createMeetingCapture(input: {
  organizationId: string;
  prospectId: string;
  meetingUrl: string;
  createdBy?: string;
}) {
  const meeting = await createProspectMeeting({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    provider: 'recall',
    meetingUrl: validateMeetingUrl(input.meetingUrl),
    createdBy: input.createdBy,
  });
  try {
    const bot = await createRecallBot({
      organizationId: input.organizationId,
      meetingId: meeting.id,
      meetingUrl: meeting.meetingUrl,
    });
    const attached = await attachProviderBot({
      organizationId: input.organizationId,
      meetingId: meeting.id,
      providerBotId: bot.id,
      status: 'joining',
    });
    emitProductEvent({
      organizationId: input.organizationId,
      name: 'prospect.meeting.scheduled',
      refs: { prospectId: input.prospectId },
      payload: { meetingId: meeting.id, provider: 'recall' },
    });
    return attached;
  } catch (error) {
    await setProspectMeetingStatus({
      organizationId: input.organizationId,
      meetingId: meeting.id,
      status: 'failed',
      detail: error instanceof Error ? error.message.slice(0, 1_000) : 'Meeting bot provisioning failed.',
    }).catch(() => undefined);
    throw error;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function recallMeetingStatusFromWebhook(payload: RecallWebhookPayload): {
  status: ProspectMeetingStatus | null;
  detail: string | null;
  occurredAt: string | null;
} {
  if (payload.event === 'transcript.done') {
    return { status: 'post_processing', detail: 'Transcript ready for ingestion', occurredAt: null };
  }
  if (payload.event === 'transcript.failed') {
    const artifactStatus = recordValue(payload.data.data);
    return {
      status: 'failed',
      detail: stringValue(artifactStatus?.sub_code) ?? 'Transcript processing failed',
      occurredAt: stringValue(artifactStatus?.updated_at),
    };
  }
  if (payload.event !== 'bot.status_change' && !payload.event.startsWith('bot.')) {
    return { status: null, detail: null, occurredAt: null };
  }
  const modernStatus = recordValue(payload.data.data);
  const legacyStatus = recordValue(payload.data.status);
  const providerStatus = modernStatus ?? legacyStatus;
  const eventCode = payload.event.startsWith('bot.')
    ? payload.event.slice('bot.'.length).toLowerCase()
    : '';
  const code = eventCode || stringValue(providerStatus?.code)?.toLowerCase() || '';
  const occurredAt = stringValue(providerStatus?.updated_at)
    ?? stringValue(providerStatus?.created_at);
  const detail = stringValue(providerStatus?.message)
    ?? stringValue(providerStatus?.sub_code)
    ?? stringValue(providerStatus?.code);
  if (code === 'fatal' || code.includes('fail')) return { status: 'failed', detail, occurredAt };
  if (code === 'call_ended' || code === 'done') return { status: 'post_processing', detail, occurredAt };
  if (code === 'in_call_recording' || code === 'in_call_not_recording') {
    return { status: 'in_meeting', detail, occurredAt };
  }
  if (code === 'joining_call' || code === 'in_waiting_room') {
    return { status: 'joining', detail, occurredAt };
  }
  return { status: null, detail, occurredAt };
}

export async function receiveRecallWebhook(input: {
  organizationId: string;
  meetingId: string;
  providerBotId: string;
  providerDeliveryId: string;
  payload: RecallWebhookPayload;
}) {
  const mapped = recallMeetingStatusFromWebhook(input.payload);
  const received = await recordProspectMeetingEvent({
    organizationId: input.organizationId,
    meetingId: input.meetingId,
    providerBotId: input.providerBotId,
    providerDeliveryId: input.providerDeliveryId,
    trigger: input.payload.event,
    eventType: mapped.detail,
    payload: input.payload.data,
    occurredAt: mapped.occurredAt,
  });
  if (!received.meeting || received.duplicate || !mapped.status) return received;
  await setProspectMeetingStatus({
    organizationId: input.organizationId,
    meetingId: input.meetingId,
    status: mapped.status,
    detail: mapped.detail,
    ...(mapped.status === 'in_meeting' && mapped.occurredAt ? { startedAt: mapped.occurredAt } : {}),
    ...(mapped.status === 'post_processing'
      && mapped.occurredAt
      && (input.payload.event === 'bot.status_change' || input.payload.event.startsWith('bot.'))
      ? { endedAt: mapped.occurredAt }
      : {}),
  });
  return received;
}

export async function finalizeRecallMeetingCapture(input: {
  organizationId: string;
  meetingId: string;
  transcriptId: string;
  meetingEventId?: string;
}) {
  return runWithExecutionContext({
    organizationId: input.organizationId,
    actorType: 'system',
    eventOrigin: 'external_connector',
    connectorId: 'recall',
  }, () => runWithGraphOrganization(input.organizationId, async () => {
    const meeting = await getProspectMeeting(input.organizationId, input.meetingId);
    if (!meeting?.providerBotId || meeting.provider !== 'recall') return null;
    const transcript = await getRecallTranscript(input.transcriptId);
    const utterances = transcript.map(recallTranscriptInput).filter((item) => Boolean(item.content.trim()));
    const inserted = await insertTranscriptUtterances({
      organizationId: input.organizationId,
      prospectId: meeting.prospectId,
      meetingId: meeting.id,
      meetingEventId: input.meetingEventId,
      utterances,
    });
    const prospect = await getProspectById(meeting.prospectId);
    if (prospect && utterances.length > 0) {
      await recordTranscriptKnowledgeEvent({
        organizationId: input.organizationId,
        prospect,
        sourceId: input.transcriptId,
        provider: 'recall',
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        utterances,
      });
    }
    await setProspectMeetingStatus({
      organizationId: input.organizationId,
      meetingId: input.meetingId,
      status: 'completed',
      detail: `${utterances.length} transcript segments attached`,
      endedAt: meeting.endedAt ?? new Date().toISOString(),
    });
    if (inserted > 0) {
      emitProductEvent({
        organizationId: input.organizationId,
        name: 'prospect.transcript.updated',
        refs: { prospectId: meeting.prospectId },
        payload: { meetingId: meeting.id, transcriptId: input.transcriptId, inserted },
      });
    }
    try {
      return await generateProspectInsights({
        organizationId: input.organizationId,
        prospectId: meeting.prospectId,
        reason: 'meeting_completed',
      });
    } catch (error) {
      log.error('outreach.meeting.insight_generation_failed', error, {
        meeting_id: meeting.id,
        prospect_id: meeting.prospectId,
        provider: 'recall',
      });
      return null;
    }
  }));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function attendeeState(input: {
  newState: string | null;
  eventType: string | null;
}): ProspectMeetingStatus | null {
  const state = input.newState?.toLowerCase() ?? '';
  const event = input.eventType?.toLowerCase() ?? '';
  if (event === 'post_processing_completed') return 'completed';
  if (/fail|fatal|could_not|error/.test(event)) return 'failed';
  if (state.includes('post_processing')) return 'post_processing';
  if (state === 'ended') return 'completed';
  if (state.includes('joined') || state.includes('recording')) return 'in_meeting';
  if (state.includes('join')) return 'joining';
  return null;
}

function transcriptInput(utterance: AttendeeTranscriptUtterance, sourceKey: string) {
  return {
    sourceKey,
    content: utterance.transcription?.transcript ?? '',
    speakerName: utterance.speaker_name,
    speakerExternalId: utterance.speaker_user_uuid ?? utterance.speaker_uuid,
    speakerIsHost: utterance.speaker_is_host,
    offsetMs: utterance.timestamp_ms,
    durationMs: utterance.duration_ms,
    metadata: {
      speakerUuid: utterance.speaker_uuid ?? null,
      speakerUserUuid: utterance.speaker_user_uuid ?? null,
      words: utterance.transcription?.words ?? null,
    },
  };
}

export async function receiveAttendeeWebhook(input: {
  organizationId: string;
  meetingId: string;
  payload: AttendeeWebhookPayload;
}) {
  const { payload } = input;
  const eventType = payload.trigger === 'bot.state_change'
    ? stringValue(payload.data.event_type)
    : 'utterance';
  const occurredAt = payload.trigger === 'bot.state_change'
    ? stringValue(payload.data.created_at)
    : null;
  let utterance: AttendeeTranscriptUtterance | undefined;
  if (payload.trigger === 'transcript.update') {
    utterance = parseAttendeeTranscriptUtterance(payload.data);
  }
  const received = await recordProspectMeetingEvent({
    organizationId: input.organizationId,
    meetingId: input.meetingId,
    providerBotId: payload.bot_id,
    providerDeliveryId: payload.idempotency_key,
    trigger: payload.trigger,
    eventType,
    payload: payload.data,
    occurredAt,
    transcriptUtterance: utterance?.transcription?.transcript.trim()
      ? transcriptInput(utterance, `webhook:${payload.idempotency_key}`)
      : undefined,
  });
  if (!received.meeting || received.duplicate) return received;

  if (payload.trigger === 'bot.state_change') {
    const newState = stringValue(payload.data.new_state);
    const status = attendeeState({ newState, eventType });
    if (status) {
      await setProspectMeetingStatus({
        organizationId: input.organizationId,
        meetingId: input.meetingId,
        status,
        detail: eventType ?? newState,
        ...(status === 'in_meeting' && occurredAt ? { startedAt: occurredAt } : {}),
        ...(status === 'completed' && occurredAt ? { endedAt: occurredAt } : {}),
      });
    }
  } else {
    if (utterance?.transcription?.transcript.trim()) {
      const prospect = await getProspectById(received.meeting.prospectId);
      if (prospect) {
        await recordTranscriptKnowledgeEvent({
          organizationId: input.organizationId,
          prospect,
          sourceId: payload.idempotency_key,
          provider: 'attendee-live',
          utterances: [transcriptInput(utterance, `webhook:${payload.idempotency_key}`)],
        });
      }
    }
    emitProductEvent({
      organizationId: input.organizationId,
      name: 'prospect.transcript.updated',
      refs: { prospectId: received.meeting.prospectId },
      payload: { meetingId: input.meetingId, eventId: received.event?.id },
    });
  }
  return received;
}

export function attendeePostProcessingCompleted(payload: AttendeeWebhookPayload): boolean {
  return payload.trigger === 'bot.state_change'
    && payload.data.event_type === 'post_processing_completed';
}

export async function finalizeMeetingCapture(input: {
  organizationId: string;
  meetingId: string;
}) {
  return runWithExecutionContext({
    organizationId: input.organizationId,
    actorType: 'system',
    eventOrigin: 'external_connector',
    connectorId: 'attendee',
  }, () => runWithGraphOrganization(input.organizationId, async () => {
    const meeting = await getProspectMeeting(input.organizationId, input.meetingId);
    if (!meeting?.providerBotId || meeting.provider !== 'attendee') return null;
    const utterances = await getAttendeeTranscript(meeting.providerBotId);
    const validUtterances = utterances.filter((utterance) =>
      Boolean(utterance.transcription?.transcript.trim()));
    await insertTranscriptUtterances({
      organizationId: input.organizationId,
      prospectId: meeting.prospectId,
      meetingId: meeting.id,
      utterances: validUtterances.map((utterance) =>
        transcriptInput(utterance, attendeeUtteranceSourceKey(utterance))),
    });
    const prospect = await getProspectById(meeting.prospectId);
    if (prospect && validUtterances.length > 0) {
      await recordTranscriptKnowledgeEvent({
        organizationId: input.organizationId,
        prospect,
        sourceId: meeting.providerBotId,
        provider: 'attendee',
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        utterances: validUtterances.map((utterance) =>
          transcriptInput(utterance, attendeeUtteranceSourceKey(utterance))),
      });
    }
    await setProspectMeetingStatus({
      organizationId: input.organizationId,
      meetingId: input.meetingId,
      status: 'completed',
      endedAt: meeting.endedAt ?? new Date().toISOString(),
    });
    try {
      return await generateProspectInsights({
        organizationId: input.organizationId,
        prospectId: meeting.prospectId,
        reason: 'meeting_completed',
      });
    } catch (error) {
      log.error('outreach.meeting.insight_generation_failed', error, {
        meeting_id: meeting.id,
        prospect_id: meeting.prospectId,
      });
      return null;
    }
  }));
}

/**
 * The versioned OAuth API uses this narrow service to attach a transcript
 * produced by an external product to a Taicho prospect. Taicho persists only the
 * transcript evidence; the external product remains the recording system of
 * record and no Taicho meeting or recording is created here.
 */
export async function updateProspectTranscript(input: {
  organizationId: string;
  prospectId: string;
  externalRecordingId: string;
  startedAt: string;
  endedAt: string;
  utterances: Array<{
    sourceKey: string;
    content: string;
    speakerName?: string | null;
    speakerExternalId?: string | null;
    speakerIsHost?: boolean | null;
    offsetMs?: number | null;
    durationMs?: number | null;
    confidence?: number | null;
    words?: unknown[];
  }>;
}) {
  return runWithGraphOrganization(input.organizationId, async () => {
    const prospect = await getProspectById(input.prospectId);
    if (!prospect) return null;
    const inserted = await insertTranscriptUtterances({
      organizationId: input.organizationId,
      prospectId: input.prospectId,
      utterances: input.utterances.map((utterance) => ({
        sourceKey: `call_recording:${input.externalRecordingId}:${utterance.sourceKey}`,
        content: utterance.content,
        speakerName: utterance.speakerName,
        speakerExternalId: utterance.speakerExternalId,
        speakerIsHost: utterance.speakerIsHost,
        offsetMs: utterance.offsetMs,
        durationMs: utterance.durationMs,
        occurredAt: typeof utterance.offsetMs === 'number'
          ? new Date(new Date(input.startedAt).getTime() + utterance.offsetMs).toISOString()
          : input.startedAt,
        metadata: {
          provider: 'call_recording',
          externalRecordingId: input.externalRecordingId,
          recordingStartedAt: input.startedAt,
          recordingEndedAt: input.endedAt,
          confidence: utterance.confidence ?? null,
          words: utterance.words ?? null,
        },
      })),
    });
    await recordTranscriptKnowledgeEvent({
      organizationId: input.organizationId,
      prospect,
      sourceId: input.externalRecordingId,
      provider: 'call_recording',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      utterances: input.utterances.map((utterance) => ({
        sourceKey: `call_recording:${input.externalRecordingId}:${utterance.sourceKey}`,
        content: utterance.content,
        speakerName: utterance.speakerName,
        speakerExternalId: utterance.speakerExternalId,
        speakerIsHost: utterance.speakerIsHost,
        offsetMs: utterance.offsetMs,
        confidence: utterance.confidence,
      })),
    });
    emitProductEvent({
      organizationId: input.organizationId,
      name: 'prospect.transcript.updated',
      refs: { prospectId: input.prospectId },
      payload: {
        provider: 'call_recording',
        externalRecordingId: input.externalRecordingId,
        insertedUtterances: inserted,
      },
    });
    return {
      prospectId: input.prospectId,
      externalRecordingId: input.externalRecordingId,
      insertedUtterances: inserted,
    };
  });
}
