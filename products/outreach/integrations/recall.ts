import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { safeFetchPublicUrl } from '@content-automation/platform/network/safe-fetch';
import { z } from 'zod';

const WORKSPACE_METADATA_KEY = 'taicho_workspace';
const ENVIRONMENT_METADATA_KEY = 'taicho_environment';
const RECALL_BOT_NAME = 'Taicho Note Taker';
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const participantSchema = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  name: z.string().nullable().optional(),
  is_host: z.boolean().nullable().optional(),
  platform: z.string().nullable().optional(),
  extra_data: z.unknown().optional(),
});

const timestampSchema = z.union([
  z.number().nonnegative(),
  z.object({
    relative: z.number().nonnegative(),
    absolute: z.string().nullable().optional(),
  }),
]);

const wordSchema = z.object({
  text: z.string(),
  start_timestamp: timestampSchema,
  end_timestamp: timestampSchema,
});

const transcriptUtteranceSchema = z.object({
  participant: participantSchema,
  words: z.array(wordSchema),
});

export type RecallTranscriptUtterance = z.infer<typeof transcriptUtteranceSchema>;

const transcriptDownloadSchema = z.union([
  z.array(transcriptUtteranceSchema),
  z.object({ transcript: z.array(transcriptUtteranceSchema) }).transform((value) => value.transcript),
]);

export const recallWebhookPayloadSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()),
});

export type RecallWebhookPayload = z.infer<typeof recallWebhookPayloadSchema>;

const createBotResponseSchema = z.object({
  id: z.string().min(1).max(200),
});

const retrieveBotResponseSchema = z.object({
  id: z.string().min(1).max(200),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const retrieveTranscriptResponseSchema = z.object({
  id: z.string().min(1).max(200),
  data: z.object({ download_url: z.string().url() }),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

type RecallConfig = {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
  webhookEnvironment: string;
};

type WorkspaceTokenPayload = { organizationId: string; meetingId: string };

export class RecallConfigurationError extends Error {
  constructor(message = 'Recall meeting capture is not configured.') {
    super(message);
    this.name = 'RecallConfigurationError';
  }
}

export class RecallProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RecallProviderError';
  }
}

function signingKey(secret: string): Buffer {
  if (!secret.startsWith('whsec_')) {
    throw new RecallConfigurationError('RECALL_WEBHOOK_SECRET must start with whsec_.');
  }
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length < 16) {
    throw new RecallConfigurationError('RECALL_WEBHOOK_SECRET is not a valid Recall signing secret.');
  }
  return key;
}

function apiUrl(): string {
  const region = process.env.RECALL_REGION?.trim() || 'us-east-1';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region)) {
    throw new RecallConfigurationError('RECALL_REGION is invalid.');
  }
  return `https://${region}.recall.ai`;
}

function webhookEnvironment(): string {
  const publicAppUrl = process.env.PUBLIC_APP_URL?.trim();
  if (!publicAppUrl) {
    throw new RecallConfigurationError('PUBLIC_APP_URL is required for Recall webhook routing.');
  }
  try {
    const url = new URL(publicAppUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid');
    return url.origin;
  } catch {
    throw new RecallConfigurationError('PUBLIC_APP_URL must be a public HTTPS origin for Recall webhook routing.');
  }
}

export function recallIsConfigured(): boolean {
  if (!process.env.RECALL_API_KEY?.trim() || !process.env.RECALL_WEBHOOK_SECRET?.trim()) return false;
  try {
    recallConfig();
    return true;
  } catch {
    return false;
  }
}

export function recallConfig(): RecallConfig {
  const apiKey = process.env.RECALL_API_KEY?.trim();
  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET?.trim();
  if (!apiKey || !webhookSecret) throw new RecallConfigurationError();
  signingKey(webhookSecret);
  return {
    apiUrl: apiUrl(),
    apiKey,
    webhookSecret,
    webhookEnvironment: webhookEnvironment(),
  };
}

export function createRecallWorkspaceToken(
  payload: WorkspaceTokenPayload,
  secret: string,
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', signingKey(secret))
    .update(`workspace:${encoded}`)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function parseRecallWorkspaceToken(
  token: string,
  secret: string,
): WorkspaceTokenPayload | null {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = Buffer.from(createHmac('sha256', signingKey(secret))
    .update(`workspace:${encoded}`)
    .digest('base64url'));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    return z.object({
      organizationId: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/),
      meetingId: z.string().uuid(),
    }).parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

function signatureValues(value: string): string[] {
  return value.split(' ').flatMap((part) => {
    const [version, signature, extra] = part.split(',');
    return version === 'v1' && signature && !extra ? [signature] : [];
  });
}

export function recallWebhookSignature(input: {
  body: string;
  webhookId: string;
  timestamp: string;
  secret: string;
}): string {
  return createHmac('sha256', signingKey(input.secret))
    .update(`${input.webhookId}.${input.timestamp}.${input.body}`, 'utf8')
    .digest('base64');
}

export function verifyRecallWebhook(input: {
  body: string;
  webhookId: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds?: number;
}): boolean {
  if (!input.webhookId || !input.timestamp || !input.signature) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(recallWebhookSignature({
    body: input.body,
    webhookId: input.webhookId,
    timestamp: input.timestamp,
    secret: input.secret,
  }));
  return signatureValues(input.signature).some((value) => {
    const supplied = Buffer.from(value);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  });
}

async function recallRequest(config: RecallConfig, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: config.apiKey,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = response.status === 507
        ? 'Recall has no meeting-bot capacity right now. Try again shortly.'
        : `Recall request failed (HTTP ${response.status}).`;
      throw new RecallProviderError(message, response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof RecallProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RecallProviderError('Recall timed out.');
    }
    throw new RecallProviderError('Recall is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function createRecallBot(input: {
  organizationId: string;
  meetingId: string;
  meetingUrl: string;
  joinAt?: string;
}) {
  const config = recallConfig();
  const body: Record<string, unknown> = {
    meeting_url: input.meetingUrl,
    bot_name: RECALL_BOT_NAME,
    metadata: {
      [WORKSPACE_METADATA_KEY]: createRecallWorkspaceToken({
        organizationId: input.organizationId,
        meetingId: input.meetingId,
      }, config.webhookSecret),
      [ENVIRONMENT_METADATA_KEY]: config.webhookEnvironment,
    },
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: {
            mode: 'prioritize_accuracy',
            language_code: 'auto',
          },
        },
        diarization: { use_separate_streams_when_available: true },
      },
    },
  };
  if (input.joinAt) body.join_at = input.joinAt;
  const response = await recallRequest(config, '/api/v1/bot/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return createBotResponseSchema.parse(await response.json());
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function workspaceTokenFromMetadata(value: unknown): string | null {
  return stringValue(objectValue(value)?.[WORKSPACE_METADATA_KEY]);
}

function environmentFromMetadata(value: unknown): string | null {
  return stringValue(objectValue(value)?.[ENVIRONMENT_METADATA_KEY]);
}

export type RecallWebhookTarget = {
  workspaceToken: string | null;
  environment: string | null;
};

export function recallWebhookTargetsEnvironment(
  target: RecallWebhookTarget,
  environment: string,
): boolean {
  return !target.environment || target.environment === environment;
}

function targetFromMetadata(value: unknown): RecallWebhookTarget {
  return {
    workspaceToken: workspaceTokenFromMetadata(value),
    environment: environmentFromMetadata(value),
  };
}

export function recallWebhookBotId(payload: RecallWebhookPayload): string | null {
  return stringValue(payload.data.bot_id) ?? stringValue(objectValue(payload.data.bot)?.id);
}

export function recallWebhookTranscriptId(payload: RecallWebhookPayload): string | null {
  return stringValue(objectValue(payload.data.transcript)?.id) ?? stringValue(payload.data.transcript_id);
}

export function recallWorkspaceTokenFromWebhook(payload: RecallWebhookPayload): string | null {
  return recallTargetFromWebhook(payload).workspaceToken;
}

export function recallTargetFromWebhook(payload: RecallWebhookPayload): RecallWebhookTarget {
  const data = payload.data;
  for (const metadata of [
    objectValue(data.bot)?.metadata,
    data.metadata,
    objectValue(data.recording)?.metadata,
    objectValue(data.transcript)?.metadata,
  ]) {
    const target = targetFromMetadata(metadata);
    if (target.workspaceToken || target.environment) return target;
  }
  return { workspaceToken: null, environment: null };
}

export async function getRecallBotWorkspaceToken(botId: string): Promise<string | null> {
  return (await getRecallBotTarget(botId)).workspaceToken;
}

export async function getRecallBotTarget(botId: string): Promise<RecallWebhookTarget> {
  const config = recallConfig();
  const response = await recallRequest(config, `/api/v1/bot/${encodeURIComponent(botId)}/`);
  const bot = retrieveBotResponseSchema.parse(await response.json());
  return targetFromMetadata(bot.metadata);
}

export async function getRecallTranscript(transcriptId: string): Promise<RecallTranscriptUtterance[]> {
  const config = recallConfig();
  const response = await recallRequest(
    config,
    `/api/v1/transcript/${encodeURIComponent(transcriptId)}/`,
  );
  const artifact = retrieveTranscriptResponseSchema.parse(await response.json());
  const downloadUrl = new URL(artifact.data.download_url);
  const download = await safeFetchPublicUrl(downloadUrl, {}, {
    allowedHosts: [downloadUrl.hostname],
    timeoutMs: 60_000,
    maxResponseBytes: 50 * 1024 * 1024,
  });
  if (!download.ok) {
    throw new RecallProviderError(`Recall transcript download failed (HTTP ${download.status}).`, download.status);
  }
  try {
    return transcriptDownloadSchema.parse(download.json());
  } catch {
    throw new RecallProviderError('Recall returned an invalid transcript artifact.');
  }
}

function relativeSeconds(value: z.infer<typeof timestampSchema>): number {
  return typeof value === 'number' ? value : value.relative;
}

function absoluteTimestamp(value: z.infer<typeof timestampSchema>): string | null {
  return typeof value === 'number' ? null : value.absolute ?? null;
}

export function recallTranscriptInput(utterance: RecallTranscriptUtterance) {
  const first = utterance.words[0];
  const last = utterance.words.at(-1);
  const content = utterance.words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1');
  const start = first ? relativeSeconds(first.start_timestamp) : 0;
  const end = last ? relativeSeconds(last.end_timestamp) : start;
  const participantId = utterance.participant.id == null ? null : String(utterance.participant.id);
  return {
    sourceKey: [
      'recall',
      participantId ?? 'speaker',
      Math.round(start * 1_000),
      createHash('sha256').update(content).digest('hex').slice(0, 16),
    ].join(':'),
    content,
    speakerName: utterance.participant.name,
    speakerExternalId: participantId,
    speakerIsHost: utterance.participant.is_host,
    offsetMs: Math.round(start * 1_000),
    durationMs: Math.max(0, Math.round((end - start) * 1_000)),
    occurredAt: first ? absoluteTimestamp(first.start_timestamp) : null,
    metadata: {
      platform: utterance.participant.platform ?? null,
      participantExtraData: utterance.participant.extra_data ?? null,
      words: utterance.words,
    },
  };
}
