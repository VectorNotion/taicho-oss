import assert from 'node:assert/strict'
import test from 'node:test'
import { PayloadAssistantOperations } from '../operations'
import { verifyInternalRequest } from '../security'

const secret = 'test-payload-gateway-secret-with-at-least-32-characters'

test('Payload operations bind a stable request ID, timestamp, and raw body', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  let verified = false
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers)
    const body = String(init?.body)
    verified = verifyInternalRequest({
      secret,
      body,
      requestId: headers.get('x-assistant-request-id'),
      timestamp: headers.get('x-assistant-timestamp'),
      signature: headers.get('x-assistant-signature'),
    })
    return Response.json({
      id: 'lead-1',
    })
  }

  const operations = new PayloadAssistantOperations(
    'https://payload.example.test/internal/assistants',
    secret,
  )
  assert.deepEqual(await operations.createLead({
    tenantId: 'tenant-a',
    conversationId: crypto.randomUUID(),
    state: { consent: true },
    summary: 'Approved summary',
  }, crypto.randomUUID()), { id: 'lead-1' })
  assert.equal(verified, true)
})

test('Payload operation failures redact provider response bodies', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => new Response(
    'provider-secret=do-not-expose',
    { status: 502 },
  )

  const operations = new PayloadAssistantOperations(
    'https://payload.example.test/internal/assistants',
    secret,
  )
  await assert.rejects(
    operations.listTickets({
      tenantId: 'tenant-a',
      accountId: 'account-a',
      userId: 'user-a',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Payload assistant operation failed (502).')
      assert.doesNotMatch(error.message, /provider-secret/)
      return true
    },
  )
})
