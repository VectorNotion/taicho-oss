import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from 'undici'

import {
  SafeOutboundRequestError,
  safeFetchPublicUrl,
  validatePublicOutboundUrl,
} from '../network/safe-fetch'
import {
  RequestBodyTooLargeError,
  readBoundedRequestText,
} from '../network/request-body'

function networkError(code: SafeOutboundRequestError['code']) {
  return (error: unknown) => (
    error instanceof SafeOutboundRequestError && error.code === code
  )
}

function fakeDispatcher(): Agent {
  return {
    close: async () => undefined,
    destroy: async () => undefined,
  } as unknown as Agent
}

test('public URL validation rejects credentials, fragments, HTTP, and unlisted hosts', () => {
  const options = {
    environment: 'production',
    allowedHosts: ['receiver.example.test'],
  }
  assert.equal(
    validatePublicOutboundUrl('https://receiver.example.test/hook', options).pathname,
    '/hook',
  )
  assert.throws(
    () => validatePublicOutboundUrl('http://receiver.example.test/hook', options),
    networkError('INVALID_URL'),
  )
  assert.throws(
    () => validatePublicOutboundUrl('https://user:secret@receiver.example.test/hook', options),
    networkError('INVALID_URL'),
  )
  assert.throws(
    () => validatePublicOutboundUrl('https://receiver.example.test/hook#secret', options),
    networkError('INVALID_URL'),
  )
  assert.throws(
    () => validatePublicOutboundUrl('https://attacker.example.test/hook', options),
    networkError('HOST_NOT_ALLOWED'),
  )
})

test('safe fetch rejects private, mixed, mapped, and non-routable DNS answers', async (t) => {
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 as const }],
    [{ address: '169.254.169.254', family: 4 as const }],
    [{ address: '10.0.0.8', family: 4 as const }],
    [{ address: '::1', family: 6 as const }],
    [{ address: '::ffff:7f00:1', family: 6 as const }],
    [
      { address: '93.184.216.34', family: 4 as const },
      { address: '192.168.1.5', family: 4 as const },
    ],
  ]) {
    await t.test(addresses.map((item) => item.address).join(','), async () => {
      let fetched = false
      await assert.rejects(
        () => safeFetchPublicUrl('https://receiver.example.test/hook', {}, {
          environment: 'production',
          resolve: async () => addresses,
          createDispatcher: fakeDispatcher,
          fetch: async () => {
            fetched = true
            return new Response('should not run')
          },
        }),
        networkError('ADDRESS_NOT_ALLOWED'),
      )
      assert.equal(fetched, false)
    })
  }
})

test('safe fetch pins DNS, rejects redirects, and bounds request and response bytes', async (t) => {
  const publicResolution = async () => [{ address: '93.184.216.34', family: 4 as const }]

  await t.test('DNS pin and manual redirect mode', async () => {
    let pinned: unknown
    let redirect: RequestRedirect | undefined
    const response = await safeFetchPublicUrl(
      'https://receiver.example.test/hook',
      { method: 'POST', body: '{}' },
      {
        environment: 'production',
        resolve: publicResolution,
        createDispatcher(hostname, addresses) {
          pinned = { hostname, addresses }
          return fakeDispatcher()
        },
        fetch: async (_input, init) => {
          redirect = init?.redirect
          return new Response('{"ok":true}')
        },
      },
    )
    assert.deepEqual(response.json(), { ok: true })
    assert.equal(redirect, 'manual')
    assert.deepEqual(pinned, {
      hostname: 'receiver.example.test',
      addresses: [{ address: '93.184.216.34', family: 4 }],
    })
  })

  await t.test('redirect', async () => {
    await assert.rejects(
      () => safeFetchPublicUrl('https://receiver.example.test/hook', {}, {
        environment: 'production',
        resolve: publicResolution,
        createDispatcher: fakeDispatcher,
        fetch: async () => new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        }),
      }),
      networkError('REDIRECT_NOT_ALLOWED'),
    )
  })

  await t.test('request bytes', async () => {
    await assert.rejects(
      () => safeFetchPublicUrl(
        'https://receiver.example.test/hook',
        { method: 'POST', body: 'too large' },
        { environment: 'production', maxRequestBytes: 4 },
      ),
      networkError('REQUEST_TOO_LARGE'),
    )
  })

  await t.test('streamed response bytes', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700))
        controller.enqueue(new Uint8Array(700))
        controller.close()
      },
    })
    await assert.rejects(
      () => safeFetchPublicUrl('https://receiver.example.test/hook', {}, {
        environment: 'production',
        maxResponseBytes: 1_024,
        resolve: publicResolution,
        createDispatcher: fakeDispatcher,
        fetch: async () => new Response(body),
      }),
      networkError('RESPONSE_TOO_LARGE'),
    )
  })
})

test('bounded inbound body rejects declared and streamed over-limit payloads', async (t) => {
  await t.test('declared', async () => {
    const request = new Request('https://app.example.test/hook', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: 'small',
    })
    await assert.rejects(
      () => readBoundedRequestText(request, 5),
      RequestBodyTooLargeError,
    )
  })

  await t.test('streamed', async () => {
    const request = new Request('https://app.example.test/hook', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(4))
          controller.enqueue(new Uint8Array(4))
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    await assert.rejects(
      () => readBoundedRequestText(request, 5),
      RequestBodyTooLargeError,
    )
  })
})
