import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenRouterAssistantModel } from '../model'

test('OpenRouter yields provider deltas from an SSE response', async (t) => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    const encoder = new TextEncoder()
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"First"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" response"}}]}\n'))
        controller.enqueue(encoder.encode('\ndata: [DONE]\n\n'))
        controller.close()
      },
    }), {
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const model = new OpenRouterAssistantModel('openrouter-test-key', 'test/model')
  const deltas: string[] = []
  for await (const delta of model.stream({
    system: 'Follow policy.',
    messages: [{ role: 'user', content: 'Answer me.' }],
  })) deltas.push(delta)

  assert.deepEqual(deltas, ['First', ' response'])
  assert.equal(requestBody?.stream, true)
})
