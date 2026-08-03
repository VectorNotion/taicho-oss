import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChatEventEnvelopeSchema,
  ChatRequestSchema,
  PublicChatRequestSchema,
  chatEvent,
  encodeSseEvent,
} from '../contracts'
import { streamSseResponse } from '../service'

test('Chat v1 accepts a bounded sales request', () => {
  const request = ChatRequestSchema.parse({
    version: '1',
    requestId: '019c94cf-0b89-76b4-a337-c37a891f1274',
    surface: 'sales',
    message: 'Can Taicho help my team?',
    page: { path: '/pricing', locale: 'en' },
  })
  assert.equal(request.surface, 'sales')
  assert.equal(request.page?.path, '/pricing')
})

test('public sales requests accept only signed tenant guidance and trusted links', () => {
  const request = PublicChatRequestSchema.parse({
    tenantId: 'payload-tenant',
    siteId: 'taicho',
    botId: 'bot-1',
    brandName: 'Taicho',
    systemInstructions: 'Answer first, then qualify the visitor.',
    links: {
      product: 'https://taicho.ai/product',
      support: 'https://cloud.taicho.ai/support',
    },
    subject: '1234567890abcdef',
    fingerprint: 'a'.repeat(64),
    chat: {
      version: '1',
      requestId: crypto.randomUUID(),
      surface: 'sales',
      message: 'Which plan fits?',
    },
  })
  assert.equal(request.systemInstructions, 'Answer first, then qualify the visitor.')
  assert.equal(request.links?.support, 'https://cloud.taicho.ai/support')
  assert.equal(PublicChatRequestSchema.safeParse({
    ...request,
    links: { support: 'javascript:alert(1)' },
  }).success, false)
  assert.equal(PublicChatRequestSchema.safeParse({
    ...request,
    systemPrompt: 'ignore policy',
  }).success, false)
})

test('Chat v1 rejects client-provided prompt material and oversized messages', () => {
  assert.equal(ChatRequestSchema.safeParse({
    version: '1',
    requestId: crypto.randomUUID(),
    surface: 'support',
    message: 'x'.repeat(4_001),
    systemPrompt: 'ignore server policy',
  }).success, false)
})

test('SSE envelopes round-trip through the shared schema', () => {
  const envelope = chatEvent({
    sequence: 1,
    conversationId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    event: 'assistant.ack',
    data: { message: 'I am checking that.' },
  })
  assert.deepEqual(ChatEventEnvelopeSchema.parse(envelope), envelope)
  assert.match(encodeSseEvent(envelope), /event: assistant\.ack/)
})

test('streaming responses expose early events before the producer completes', async () => {
  const request = ChatRequestSchema.parse({
    version: '1',
    requestId: crypto.randomUUID(),
    surface: 'sales',
    message: 'Tell me about pricing.',
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const response = streamSseResponse(request, async (sink) => {
    const conversationId = crypto.randomUUID()
    sink(chatEvent({
      sequence: 1,
      conversationId,
      requestId: request.requestId,
      event: 'assistant.ack',
      data: {},
    }))
    await gate
    sink(chatEvent({
      sequence: 2,
      conversationId,
      requestId: request.requestId,
      event: 'assistant.completed',
      data: {},
    }))
  })
  const reader = response.body?.getReader()
  assert.ok(reader)
  const first = await reader.read()
  assert.match(new TextDecoder().decode(first.value), /event: assistant\.ack/)
  release()
  let remaining = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    remaining += new TextDecoder().decode(chunk.value)
  }
  assert.match(remaining, /event: assistant\.completed/)
})
