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

export type ActionStreamPart = {
  type: `data-${string}`;
  id?: string;
  data: unknown;
  transient?: boolean;
};

export type ActionStreamOptions = {
  action: BackgroundAction;
  entityId: string;
  entityType?: EntityType;
  run: (emit: StreamEmit) => Promise<Record<string, unknown>>;
  commercial?: JobCommercialContext;
  estimatedCredits?: number;
};

/**
 * Generator form of the streamed action lifecycle, for stream capabilities
 * (defineStreamCapability). Yields the same data-* parts the generative-UI
 * protocol used, and RETURNS the final result instead of emitting data-final.
 * Job creation, status transitions, credit settlement/release, and
 * observability are identical to actionStreamResponse — which is now a thin
 * adapter over this generator.
 *
 * Failures throw (after marking the job failed and releasing the
 * reservation) so the capability layer audits them and the SSE projection
 * emits its terminal error event.
 */
export async function* actionStreamParts(
  opts: ActionStreamOptions,
): AsyncGenerator<ActionStreamPart, { data: Record<string, unknown>; summary: string; entityIds?: string[] }> {
  let jobId: string;
  try {
    jobId = await createJob(opts.action, opts.entityId, opts.entityType, opts.commercial);
  } catch (error) {
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

  const queue: ActionStreamPart[] = [];
  const waker: { resolve: (() => void) | null } = { resolve: null };
  let finished = false;
  let outcome: Record<string, unknown> | undefined;
  let failure: unknown;
  const emit: StreamEmit = (part) => {
    queue.push(part as ActionStreamPart);
    waker.resolve?.();
  };

  const work = (async () => {
    emit({ type: 'data-job', id: 'job', data: { jobId } });
    try {
      outcome = await observeOperation(
        'platform.job.stream',
        {
          executionId: jobId,
          requestId: parent?.requestId,
          parentExecutionId: parent?.executionId,
          organizationId,
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
          await updateJobStatus(organizationId, jobId, 'completed', { result });
          if (opts.commercial) await settleReservation({
            reservationId: opts.commercial.creditReservationId,
            actualCredits: opts.estimatedCredits ?? 1,
            idempotencyKey: `job:${jobId}:settlement`,
            usageKind: 'agent_action',
            metadata: { action: opts.action, streaming: true },
          });
          return result;
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateJobStatus(organizationId, jobId, 'failed', { error: message });
      if (opts.commercial) await releaseReservation(opts.commercial.creditReservationId, message);
      log.error('job.stream.failed', error, { job_id: jobId, action: opts.action });
      failure = error;
    } finally {
      finished = true;
      waker.resolve?.();
    }
  })();

  while (true) {
    while (queue.length > 0) yield queue.shift()!;
    if (finished) break;
    await new Promise<void>((resolve) => {
      waker.resolve = resolve;
    });
    waker.resolve = null;
  }
  await work;
  while (queue.length > 0) yield queue.shift()!;
  if (failure) throw failure;
  return { data: outcome ?? {}, summary: `Completed ${opts.action}.`, entityIds: [opts.entityId] };
}

export async function actionStreamResponse(opts: ActionStreamOptions): Promise<Response> {
  // Legacy generative-UI transport: adapt the generator lifecycle onto the AI
  // SDK UIMessage stream. Job/credit/observability behavior lives in
  // actionStreamParts; this only changes the wire format (data-final and
  // data-action-error parts instead of return/throw).
  const parts = actionStreamParts(opts);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        while (true) {
          const step = await parts.next();
          if (step.done) {
            writer.write({ type: 'data-final', id: 'final', data: step.value.data } as never);
            return;
          }
          writer.write(step.value as never);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writer.write({ type: 'data-action-error', id: 'error', data: { message } } as never);
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}
