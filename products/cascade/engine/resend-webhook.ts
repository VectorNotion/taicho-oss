import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_AGE_SECONDS = 300
const EVENT_ID = /^[a-zA-Z0-9_-]{1,255}$/

function signingKey(secret: string): Buffer {
  const encoded = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const key = Buffer.from(encoded, 'base64')
  if (key.length < 16) throw new Error('Resend webhook secret is invalid.')
  return key
}

function signature(
  secret: string,
  eventId: string,
  timestamp: string,
  body: string,
): Buffer {
  return createHmac('sha256', signingKey(secret))
    .update(`${eventId}.${timestamp}.${body}`)
    .digest()
}

export function signResendWebhook(input: {
  secret: string
  eventId: string
  body: string
  timestamp?: string
}): {
  'svix-id': string
  'svix-timestamp': string
  'svix-signature': string
} {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1_000))
  return {
    'svix-id': input.eventId,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature(
      input.secret,
      input.eventId,
      timestamp,
      input.body,
    ).toString('base64')}`,
  }
}

export function verifyResendWebhook(input: {
  secret: string
  body: string
  eventId: string | undefined
  timestamp: string | undefined
  signatures: string | undefined
  now?: number
}): string | null {
  if (
    !input.eventId
    || !EVENT_ID.test(input.eventId)
    || !input.timestamp
    || !input.signatures
  ) return null
  const seconds = Number(input.timestamp)
  const now = input.now ?? Math.floor(Date.now() / 1_000)
  if (!Number.isInteger(seconds) || Math.abs(now - seconds) > MAX_AGE_SECONDS) {
    return null
  }
  let expected: Buffer
  try {
    expected = signature(input.secret, input.eventId, input.timestamp, input.body)
  } catch {
    return null
  }
  for (const candidate of input.signatures.split(/\s+/)) {
    const [version, encoded] = candidate.split(',', 2)
    if (version !== 'v1' || !encoded) continue
    let supplied: Buffer
    try {
      supplied = Buffer.from(encoded, 'base64')
    } catch {
      continue
    }
    if (
      supplied.length === expected.length
      && timingSafeEqual(supplied, expected)
    ) return input.eventId
  }
  return null
}
