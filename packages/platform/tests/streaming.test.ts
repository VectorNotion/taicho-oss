import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  streamingStructuredGenerate,
  type AgentStreamFactory,
  type StreamChunk,
} from '../agents/streaming';

async function* chunks(values: StreamChunk[]) {
  for (const value of values) yield value;
}

const baseArgs = {
  agentId: 'test-agent',
  agentName: 'Test Agent',
  instructions: 'Return structured test output.',
  prompt: 'Generate a result.',
  schema: z.object({ answer: z.string() }),
  temperature: 0,
};

test('structured streaming accumulates reasoning, exposes partials, and validates the final object', async () => {
  const emitted: Array<{ type: string; id?: string; data: unknown }> = [];
  const agentStream: AgentStreamFactory = async (args) => {
    assert.equal(args, baseArgs);
    return chunks([
      { type: 'reasoning-delta', payload: { text: 'First ' } },
      { type: 'reasoning-delta', payload: { text: 'second' } },
      { type: 'object', object: { answer: 'par' } },
      { type: 'object-result', object: { answer: 'complete' } },
    ]);
  };

  const generate = streamingStructuredGenerate((part) => emitted.push(part), { agentStream });
  assert.deepEqual(await generate(baseArgs), { answer: 'complete' });
  assert.deepEqual(emitted, [
    { type: 'data-reasoning', id: 'reasoning', data: { text: 'First ' } },
    { type: 'data-reasoning', id: 'reasoning', data: { text: 'First second' } },
    { type: 'data-partial', id: 'partial', data: { answer: 'par' } },
  ]);
});

test('structured streaming rejects provider errors, absent results, and invalid final objects', async () => {
  const generateFor = (values: StreamChunk[]) => streamingStructuredGenerate(
    () => undefined,
    { agentStream: async () => chunks(values) },
  )(baseArgs);

  await assert.rejects(
    generateFor([{ type: 'error', payload: { error: 'provider unavailable' } }]),
    /provider unavailable/,
  );
  await assert.rejects(generateFor([{ type: 'reasoning-delta' }]), /no structured result/);
  await assert.rejects(
    generateFor([{ type: 'object-result', object: { answer: 42 } }]),
    z.ZodError,
  );
});
