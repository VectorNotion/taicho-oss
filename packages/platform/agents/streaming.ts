import { Agent } from '@mastra/core/agent';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { z } from 'zod';
import { createJob, updateJobStatus, type EntityType, type JobCommercialContext } from '../jobs/repository';
import { releaseReservation, settleReservation } from '../commercial';
import type { BackgroundAction } from './contracts';
import { routerModel } from './model';
import {
  createLogger,
  currentExecutionContext,
  observeOperation,
  traceable,
} from '@content-automation/observability';
import { registerObservedAgent } from '@content-automation/observability/ai';

const log = createLogger('platform.agents.streaming');

export type StreamEmit = (part: {
  type: `data-${string}`;
  id?: string;
  data: unknown;
  transient?: boolean;
}) => void;

export type StreamChunk = {
  type: string;
  payload?: { text?: string; error?: unknown };
  object?: unknown;
};

export type AgentStreamFactory = (args: {
  agentId: string;
  agentName: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType;
  temperature: number;
}) => Promise<AsyncIterable<StreamChunk>>;

const defaultAgentStream: AgentStreamFactory = async ({
  agentId,
  agentName,
  instructions,
  prompt,
  schema,
  temperature,
}) => {
  const agent = registerObservedAgent(new Agent({
    id: agentId,
    name: agentName,
    instructions,
    model: routerModel(),
  }), 'taicho-background-agents');
  const stream = await agent.stream(prompt, {
    structuredOutput: { schema },
    modelSettings: { temperature, maxOutputTokens: 32768 },
    providerOptions: { openrouter: { reasoning: { effort: 'medium' } } },
  });
  return stream.fullStream as AsyncIterable<StreamChunk>;
};

export function streamingStructuredGenerate(
  emit: StreamEmit,
  opts: { agentStream?: AgentStreamFactory; eventId?: string } = {},
) {
  const agentStream = opts.agentStream ?? defaultAgentStream;
  return async <S extends z.ZodType>(args: {
    agentId: string;
    agentName: string;
    instructions: string;
    prompt: string;
    schema: S;
    temperature: number;
  }): Promise<z.infer<S>> => traceable(
    async () => {
      const chunks = await agentStream(args);
      const eventId = opts.eventId ?? 'default';
      let reasoning = '';
      let final: unknown;
      let haveFinal = false;

      for await (const chunk of chunks) {
        if (chunk.type === 'reasoning-delta') {
          reasoning += chunk.payload?.text ?? '';
          emit({
            type: 'data-reasoning',
            id: eventId,
            data: { text: reasoning },
          });
        } else if (chunk.type === 'object') {
          emit({ type: 'data-partial', id: eventId, data: chunk.object });
        } else if (chunk.type === 'object-result') {
          final = chunk.object;
          haveFinal = true;
        } else if (chunk.type === 'error') {
          throw new Error(`agent stream error: ${JSON.stringify(chunk.payload ?? chunk)}`);
        }
      }

      if (!haveFinal) throw new Error('agent stream produced no structured result');
      return args.schema.parse(final) as z.infer<S>;
    },
    {
      name: `content.${args.agentId.replace(/-agent$/, '').replaceAll('-', '_')}.generate_stream`,
      kind: 'generation',
      processInputs: () => ({
        agentId: args.agentId,
        agentName: args.agentName,
        instructions: args.instructions,
        prompt: args.prompt,
        temperature: args.temperature,
        streaming: true,
      }),
    },
  )();
}

export async function actionStreamResponse(opts: {
  action: BackgroundAction;
  entityId: string;
  entityType?: EntityType;
  run: (emit: StreamEmit) => Promise<Record<string, unknown>>;
  commercial?: JobCommercialContext;
  estimatedCredits?: number;
}): Promise<Response> {
  let jobId: string;
  try {
    jobId = await createJob(opts.action, opts.entityId, opts.entityType, opts.commercial);
  } catch (error) {
    // Reservation happens before durable job creation. If persistence fails,
    // no provider work can have occurred, so release the hold before returning
    // the infrastructure error to the route.
    if (opts.commercial) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await releaseReservation(opts.commercial.creditReservationId, message);
      } catch (releaseError) {
        log.error('job.creation_reservation_release_failed', releaseError, {
          action: opts.action,
          entity_id: opts.entityId,
        });
      }
    }
    throw error;
  }
  const parent = currentExecutionContext();
  const organizationId = opts.commercial?.organizationId ?? parent?.organizationId;
  if (!organizationId) throw new Error('A job organization is required.');
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const emit: StreamEmit = (part) => writer.write(part as never);
      // Surface the durable job id before any model work begins. Long-running
      // composite experiences (content variations -> resonance) can retain
      // this handle for recovery instead of treating the HTTP stream itself
      // as the only record that the work exists.
      emit({ type: 'data-job', id: 'job', data: { jobId } });
      try {
        await observeOperation(
          'platform.job.stream',
          {
            executionId: jobId,
            requestId: parent?.requestId,
            parentExecutionId: parent?.executionId,
            organizationId: opts.commercial?.organizationId ?? parent?.organizationId,
            actorId: opts.commercial?.initiatingUserId ?? parent?.actorId,
            actorType: opts.commercial?.initiatingUserId ? 'user' : (parent?.actorType ?? 'system'),
            jobId,
            attributes: {
              'job.id': jobId,
              'job.action': opts.action,
              'job.entity_type': opts.entityType ?? 'unknown',
            },
            workflow: {
              name: `product.${opts.action}`,
              input: {
                action: opts.action,
                entityId: opts.entityId,
                entityType: opts.entityType ?? null,
                estimatedCredits: opts.estimatedCredits ?? null,
              },
            },
          },
          async () => {
            await updateJobStatus(organizationId, jobId, 'processing');
            const result = await opts.run(emit);
            emit({ type: 'data-final', id: 'final', data: result });
            await updateJobStatus(organizationId, jobId, 'completed', { result });
            if (opts.commercial) await settleReservation({
              reservationId: opts.commercial.creditReservationId,
              actualCredits: opts.estimatedCredits ?? 1,
              idempotencyKey: `job:${jobId}:settlement`,
              usageKind: 'agent_action', metadata: { action: opts.action, streaming: true },
            });
            return result;
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'data-action-error', id: 'error', data: { message } });
        await updateJobStatus(organizationId, jobId, 'failed', { error: message });
        if (opts.commercial) await releaseReservation(opts.commercial.creditReservationId, message);
        log.error('job.stream.failed', error, { job_id: jobId, action: opts.action });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}
