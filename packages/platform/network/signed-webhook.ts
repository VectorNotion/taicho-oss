/**
 * Generic HMAC webhook signing: v1= hex HMAC-SHA256 over
 * `timestamp.deliveryId.body`, with a 300-second replay window and
 * timing-safe comparison.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_MAX_AGE_SECONDS = 300
const DELIVERY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/

function digest(token: string, timestamp: string, deliveryId: string, body: string): Buffer {
  return createHmac('sha256', token)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest()
}

export function signWebhookPayload(input: {
  token: string
  body: string
  deliveryId: string
  timestamp?: string
}): { timestamp: string; deliveryId: string; signature: string } {
  if (!DELIVERY_ID.test(input.deliveryId)) {
    throw new Error('Webhook delivery IDs must be 1-200 safe characters.')
  }
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1_000))
  return {
    timestamp,
    deliveryId: input.deliveryId,
    signature: `v1=${digest(input.token, timestamp, input.deliveryId, input.body).toString('hex')}`,
  }
}

export function verifyWebhookSignature(input: {
  token: string
  body: string
  deliveryId: string | null
  timestamp: string | null
  signature: string | null
  now?: number
  maxAgeSeconds?: number
}): boolean {
  if (
    !input.deliveryId
    || !DELIVERY_ID.test(input.deliveryId)
    || !input.timestamp
    || !input.signature?.startsWith('v1=')
  ) return false
  const seconds = Number(input.timestamp)
  const now = input.now ?? Math.floor(Date.now() / 1_000)
  if (
    !Number.isInteger(seconds)
    || Math.abs(now - seconds) > (input.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS)
  ) return false
  const hex = input.signature.slice(3)
  if (!/^[a-f0-9]{64}$/i.test(hex)) return false
  const supplied = Buffer.from(hex, 'hex')
  const expected = digest(input.token, input.timestamp, input.deliveryId, input.body)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
