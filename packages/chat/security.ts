import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_MAX_AGE_SECONDS = 300

function validEmailShape(value: string): boolean {
  if (value.length < 5 || value.length > 320) return false
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@') || at > 64 || at === value.length - 1) return false
  const dot = value.indexOf('.', at + 2)
  if (dot === -1 || dot === value.length - 1) return false
  for (const character of value) {
    if (/\s/u.test(character)) return false
  }
  return true
}

export type SignedRequestHeaders = {
  requestId: string
  timestamp: string
  signature: string
}

function validRequestId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{15,127}$/.test(value)
}

function digest(secret: string, requestId: string, timestamp: string, body: string): Buffer {
  return createHmac('sha256', secret)
    .update(`${requestId}.${timestamp}.${body}`)
    .digest()
}

export function signInternalRequest(
  secret: string,
  body: string,
  requestId: string = crypto.randomUUID(),
  timestamp = String(Math.floor(Date.now() / 1_000)),
): SignedRequestHeaders {
  if (secret.length < 32) throw new Error('Assistant internal secrets must contain at least 32 characters.')
  if (!validRequestId(requestId)) throw new Error('Assistant request IDs must be safe, stable identifiers.')
  return {
    requestId,
    timestamp,
    signature: `sha256=${digest(secret, requestId, timestamp, body).toString('hex')}`,
  }
}

export function verifyInternalRequest(input: {
  secret: string
  body: string
  requestId: string | null
  timestamp: string | null
  signature: string | null
  now?: number
  maxAgeSeconds?: number
}): boolean {
  const { secret, body, requestId, timestamp, signature } = input
  if (
    secret.length < 32
    || !requestId
    || !validRequestId(requestId)
    || !timestamp
    || !signature?.startsWith('sha256=')
  ) return false

  const seconds = Number(timestamp)
  if (!Number.isInteger(seconds)) return false
  const now = input.now ?? Math.floor(Date.now() / 1_000)
  if (Math.abs(now - seconds) > (input.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS)) return false

  const provided = Buffer.from(signature.slice('sha256='.length), 'hex')
  const expected = digest(secret, requestId, timestamp, body)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export function validatedTenantId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new Error('Assistant tenant IDs may contain only letters, numbers, underscores, and hyphens.')
  }
  return value
}

export function anonymousSubjectId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(value)) throw new Error('Invalid anonymous assistant subject.')
  return `anonymous:${value}`
}

export function authenticatedSubjectId(userId: string): string {
  if (!userId || userId.length > 255) throw new Error('Invalid authenticated assistant subject.')
  return `user:${userId}`
}

export function verifiedEmailSubjectId(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!validEmailShape(normalized)) throw new Error('Invalid verified email.')
  return `email:${createHash('sha256').update(normalized).digest('hex')}`
}
