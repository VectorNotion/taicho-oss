import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const utteranceSchema = z.object({
  speaker_name: z.string().nullable().optional(),
  speaker_uuid: z.string().nullable().optional(),
  speaker_user_uuid: z.string().nullable().optional(),
  speaker_is_host: z.boolean().nullable().optional(),
  timestamp_ms: z.number().int().nonnegative().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  transcription: z.object({
    transcript: z.string(),
    words: z.unknown().optional(),
  }).nullable().optional(),
});

export type AttendeeTranscriptUtterance = z.infer<typeof utteranceSchema>;

export function parseAttendeeTranscriptUtterance(value: unknown): AttendeeTranscriptUtterance {
  return utteranceSchema.parse(value);
}

export const attendeeWebhookPayloadSchema = z.object({
  idempotency_key: z.string().min(1).max(200),
  bot_id: z.string().min(1).max(200),
  bot_metadata: z.unknown().optional(),
  trigger: z.enum(['bot.state_change', 'transcript.update']),
  data: z.record(z.string(), z.unknown()),
});

export type AttendeeWebhookPayload = z.infer<typeof attendeeWebhookPayloadSchema>;

const createBotResponseSchema = z.object({
  id: z.string().min(1),
  state: z.string().optional(),
  transcription_state: z.string().optional(),
  recording_state: z.string().optional(),
});

type AttendeeConfig = {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
  webhookUrl: string;
  transcriptionSettings?: Record<string, unknown>;
};

export class AttendeeConfigurationError extends Error {
  constructor(message = 'The self-hosted meeting bot is not configured.') {
    super(message);
    this.name = 'AttendeeConfigurationError';
  }
}

export class AttendeeProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'AttendeeProviderError';
  }
}

function validApiUrl(value: string): string {
  const url = new URL(value);
  const internalHttp = url.protocol === 'http:' && (
    url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname.endsWith('.svc')
    || url.hostname.endsWith('.svc.cluster.local')
  );
  if ((url.protocol !== 'https:' && !internalHttp) || url.username || url.password) {
    throw new AttendeeConfigurationError('ATTENDEE_API_URL must be HTTPS or an internal Kubernetes service URL.');
  }
  return url.toString().replace(/\/+$/, '');
}

function validWebhookUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AttendeeConfigurationError('ATTENDEE_WEBHOOK_URL must be a public HTTPS URL.');
  }
  return url.toString();
}

function parseTranscriptionSettings(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return z.record(z.string(), z.unknown()).parse(parsed);
  } catch {
    throw new AttendeeConfigurationError('ATTENDEE_TRANSCRIPTION_SETTINGS must contain a JSON object.');
  }
}

export function attendeeIsConfigured(): boolean {
  return Boolean(
    process.env.ATTENDEE_API_URL?.trim()
    && process.env.ATTENDEE_API_KEY?.trim()
    && process.env.ATTENDEE_WEBHOOK_SECRET?.trim()
    && process.env.ATTENDEE_WEBHOOK_URL?.trim(),
  );
}

export function attendeeConfig(): AttendeeConfig {
  const apiUrl = process.env.ATTENDEE_API_URL?.trim();
  const apiKey = process.env.ATTENDEE_API_KEY?.trim();
  const webhookSecret = process.env.ATTENDEE_WEBHOOK_SECRET?.trim();
  const webhookUrl = process.env.ATTENDEE_WEBHOOK_URL?.trim();
  if (!apiUrl || !apiKey || !webhookSecret || !webhookUrl) {
    throw new AttendeeConfigurationError();
  }
  const secret = Buffer.from(webhookSecret, 'base64');
  if (secret.length < 24) {
    throw new AttendeeConfigurationError('ATTENDEE_WEBHOOK_SECRET is not a valid project webhook secret.');
  }
  return {
    apiUrl: validApiUrl(apiUrl),
    apiKey,
    webhookSecret,
    webhookUrl: validWebhookUrl(webhookUrl),
    transcriptionSettings: parseTranscriptionSettings(process.env.ATTENDEE_TRANSCRIPTION_SETTINGS),
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortKeys((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

export function attendeeWebhookSignature(
  payload: unknown,
  secretB64: string,
): string {
  const canonical = JSON.stringify(sortKeys(payload));
  return createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(canonical, 'utf8')
    .digest('base64');
}

export function verifyAttendeeWebhook(
  payload: unknown,
  signature: string | null,
  secretB64: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(attendeeWebhookSignature(payload, secretB64));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

type WorkspaceTokenPayload = { organizationId: string; meetingId: string };

export function createAttendeeWorkspaceToken(
  payload: WorkspaceTokenPayload,
  secretB64: string,
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(`workspace:${encoded}`)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function parseAttendeeWorkspaceToken(
  token: string,
  secretB64: string,
): WorkspaceTokenPayload | null {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(`workspace:${encoded}`)
    .digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return null;
  }
  try {
    return z.object({
      organizationId: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/),
      meetingId: z.string().uuid(),
    }).parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

function callbackUrl(config: AttendeeConfig, organizationId: string, meetingId: string) {
  const url = new URL(config.webhookUrl);
  url.searchParams.set('workspace', createAttendeeWorkspaceToken(
    { organizationId, meetingId },
    config.webhookSecret,
  ));
  return url.toString();
}

async function attendeeRequest(config: AttendeeConfig, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Token ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AttendeeProviderError(`Meeting bot request failed (HTTP ${response.status}).`, response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof AttendeeProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AttendeeProviderError('The meeting bot service timed out.');
    }
    throw new AttendeeProviderError('The meeting bot service is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function createAttendeeBot(input: {
  organizationId: string;
  meetingId: string;
  meetingUrl: string;
  botName: string;
  joinAt?: string;
}) {
  const config = attendeeConfig();
  const body: Record<string, unknown> = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    deduplication_key: input.meetingId,
    webhooks: [{
      url: callbackUrl(config, input.organizationId, input.meetingId),
      triggers: ['bot.state_change', 'transcript.update'],
    }],
  };
  if (input.joinAt) body.join_at = input.joinAt;
  if (config.transcriptionSettings) body.transcription_settings = config.transcriptionSettings;
  const response = await attendeeRequest(config, '/api/v1/bots', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return createBotResponseSchema.parse(await response.json());
}

export async function getAttendeeTranscript(botId: string): Promise<AttendeeTranscriptUtterance[]> {
  const config = attendeeConfig();
  const response = await attendeeRequest(
    config,
    `/api/v1/bots/${encodeURIComponent(botId)}/transcript`,
  );
  return z.array(utteranceSchema).parse(await response.json());
}

export function attendeeUtteranceSourceKey(utterance: AttendeeTranscriptUtterance): string {
  const content = utterance.transcription?.transcript ?? '';
  const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return [
    'attendee',
    utterance.speaker_uuid ?? 'speaker',
    utterance.timestamp_ms ?? 0,
    utterance.duration_ms ?? 0,
    fingerprint,
  ].join(':');
}
