process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? 'localhost';

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  streamingStructuredGenerate,
  type StreamEmit,
} from '@/packages/platform/agents/streaming';
import { stubAgentStream } from '@/packages/platform/agents/streaming.test-helpers';

function collectEmits() {
  const parts: Array<{ type: string; id?: string; data: unknown }> = [];
  const emit: StreamEmit = (part) => parts.push(part);
  return { parts, emit };
}

test('streamingStructuredGenerate forwards reasoning + partials, returns final object', async () => {
  const { parts, emit } = collectEmits();
  const schema = z.object({ title: z.string() });
  const generate = streamingStructuredGenerate(emit, {
    agentStream: stubAgentStream([
      { type: 'reasoning-delta', payload: { text: 'thinking ' } },
      { type: 'reasoning-delta', payload: { text: 'harder' } },
      { type: 'object', object: { title: 'par' } },
      { type: 'object', object: { title: 'partial then full' } },
      { type: 'object-result', object: { title: 'partial then full' } },
    ]),
  });
  const result = await generate({
    agentId: 'a', agentName: 'A', instructions: 'i', prompt: 'p', schema, temperature: 0.5,
  });
  assert.deepEqual(result, { title: 'partial then full' });
  const reasoning = parts.filter((part) => part.type === 'data-reasoning');
  assert.equal(reasoning.length, 2);
  assert.equal((reasoning[1].data as { text: string }).text, 'thinking harder');
  const partials = parts.filter((part) => part.type === 'data-partial');
  assert.equal(partials.length, 2);
  assert.deepEqual(partials[1].data, { title: 'partial then full' });
});

test('streamingStructuredGenerate throws when no object-result chunk arrives', async () => {
  const { emit } = collectEmits();
  const generate = streamingStructuredGenerate(emit, {
    agentStream: stubAgentStream([
      { type: 'reasoning-delta', payload: { text: 'hmm' } },
    ]),
  });
  await assert.rejects(
    generate({ agentId: 'a', agentName: 'A', instructions: 'i', prompt: 'p', schema: z.object({}), temperature: 0 }),
    /no structured result/,
  );
});
