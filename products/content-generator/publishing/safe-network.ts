import {
  SafeOutboundRequestError,
  safeFetchPublicUrl,
  validatePublicOutboundUrl,
  type SafeOutboundResponse,
} from '@content-automation/platform/network/safe-fetch'
import { PublishError } from './types'

const DEFAULT_RESPONSE_LIMIT = 1024 * 1024

function hostList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function destinationOptions(value: string | URL) {
  const url = new URL(value)
  const denied = new Set(hostList('PUBLISHING_OUTBOUND_DENIED_HOSTS'))
  if (denied.has(url.hostname.toLowerCase())) {
    throw new PublishError('Outbound destination rejected (HOST_NOT_ALLOWED).')
  }
  const configuredAllowed = hostList('PUBLISHING_OUTBOUND_ALLOWED_HOSTS')
  return {
    allowedHosts: configuredAllowed.length > 0
      ? configuredAllowed
      : [url.hostname],
  }
}

/** Network-safe publishing request with privacy-safe error mapping. */
export async function publishingRequest(
  value: string | URL,
  init: RequestInit,
  options: {
    maxRequestBytes?: number
    maxResponseBytes?: number
    timeoutMs?: number
  } = {},
): Promise<SafeOutboundResponse> {
  try {
    return await safeFetchPublicUrl(value, init, {
      ...destinationOptions(value),
      maxRequestBytes: options.maxRequestBytes,
      maxResponseBytes: options.maxResponseBytes ?? DEFAULT_RESPONSE_LIMIT,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    if (error instanceof PublishError) throw error
    const code = error instanceof SafeOutboundRequestError
      ? error.code
      : 'NETWORK_ERROR'
    throw new PublishError(`Outbound destination rejected (${code}).`)
  }
}

/** Validate an externally supplied result URL before persisting or rendering it. */
export function publishingResultUrl(value: string): string {
  try {
    return validatePublicOutboundUrl(value, destinationOptions(value)).toString()
  } catch (error) {
    if (error instanceof PublishError) throw error
    const code = error instanceof SafeOutboundRequestError
      ? error.code
      : 'INVALID_URL'
    throw new PublishError(`Publishing result URL rejected (${code}).`)
  }
}
