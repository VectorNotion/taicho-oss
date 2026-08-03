import assert from 'node:assert/strict'
import test from 'node:test'

import {
  signResendWebhook,
  verifyResendWebhook,
} from '../engine/resend-webhook'

const secret = `whsec_${Buffer.from('resend-webhook-test-key-material').toString('base64')}`

test('Resend webhook verification binds event ID, timestamp, and raw body', () => {
  const body = '{"type":"email.bounced"}'
  const headers = signResendWebhook({
    secret,
    eventId: 'evt_123',
    timestamp: '1000',
    body,
  })
  assert.equal(verifyResendWebhook({
    secret,
    body,
    eventId: headers['svix-id'],
    timestamp: headers['svix-timestamp'],
    signatures: headers['svix-signature'],
    now: 1000,
  }), 'evt_123')
  assert.equal(verifyResendWebhook({
    secret,
    body: `${body} `,
    eventId: headers['svix-id'],
    timestamp: headers['svix-timestamp'],
    signatures: headers['svix-signature'],
    now: 1000,
  }), null)
  assert.equal(verifyResendWebhook({
    secret,
    body,
    eventId: 'evt_456',
    timestamp: headers['svix-timestamp'],
    signatures: headers['svix-signature'],
    now: 1000,
  }), null)
})

test('Resend webhook verification rejects stale and malformed signatures', () => {
  const headers = signResendWebhook({
    secret,
    eventId: 'evt_123',
    timestamp: '1000',
    body: '{}',
  })
  assert.equal(verifyResendWebhook({
    secret,
    body: '{}',
    eventId: headers['svix-id'],
    timestamp: headers['svix-timestamp'],
    signatures: headers['svix-signature'],
    now: 1301,
  }), null)
  assert.equal(verifyResendWebhook({
    secret,
    body: '{}',
    eventId: headers['svix-id'],
    timestamp: headers['svix-timestamp'],
    signatures: 'v1,not-a-signature',
    now: 1000,
  }), null)
})
