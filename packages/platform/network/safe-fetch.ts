import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_REQUEST_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024

const privateAddresses = new BlockList()
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
] as const) {
  privateAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  privateAddresses.addSubnet(network, prefix, 'ipv6')
}

const nonRoutableAddresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonRoutableAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['ff00::', 8],
] as const) {
  nonRoutableAddresses.addSubnet(network, prefix, 'ipv6')
}

export type ResolvedAddress = { address: string; family: 4 | 6 }
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>
type DispatcherFetch = (
  input: string | URL,
  init?: RequestInit & { dispatcher?: Agent },
) => Promise<Response>

export class SafeOutboundRequestError extends Error {
  constructor(
    readonly code:
      | 'INVALID_URL'
      | 'ADDRESS_NOT_ALLOWED'
      | 'HOST_NOT_ALLOWED'
      | 'REDIRECT_NOT_ALLOWED'
      | 'REQUEST_TOO_LARGE'
      | 'RESPONSE_TOO_LARGE'
      | 'REQUEST_TIMEOUT'
      | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message)
    this.name = 'SafeOutboundRequestError'
  }
}

export type SafeOutboundRequestOptions = {
  environment?: string
  allowedHosts?: readonly string[]
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  resolve?: AddressResolver
  fetch?: DispatcherFetch
  createDispatcher?: (hostname: string, addresses: ResolvedAddress[]) => Agent
}

export type SafeOutboundResponse = {
  status: number
  ok: boolean
  headers: Headers
  bytes: Uint8Array
  text(): string
  json<T = unknown>(): T
}

function normalizedHostname(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value
  return unwrapped.replace(/\.$/, '').toLowerCase()
}

function boundedInteger(
  name: string,
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new SafeOutboundRequestError(
      'INVALID_URL',
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return result
}

function validateHostList(values: readonly string[]): Set<string> {
  const result = new Set<string>()
  for (const value of values) {
    const host = normalizedHostname(value.trim())
    if (
      !host
      || (
        isIP(host) === 0
        && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
      )
    ) {
      throw new SafeOutboundRequestError(
        'HOST_NOT_ALLOWED',
        'Outbound host rules must contain exact hostnames or IP addresses.',
      )
    }
    result.add(host)
  }
  return result
}

export function validatePublicOutboundUrl(
  input: string | URL,
  options: Pick<SafeOutboundRequestOptions, 'environment' | 'allowedHosts'> = {},
): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new SafeOutboundRequestError('INVALID_URL', 'The outbound destination is not a valid URL.')
  }
  const hostname = normalizedHostname(url.hostname)
  const development = (options.environment ?? process.env.NODE_ENV) !== 'production'
  const loopbackDevelopment = development
    && url.protocol === 'http:'
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
  if (url.protocol !== 'https:' && !loopbackDevelopment) {
    throw new SafeOutboundRequestError(
      'INVALID_URL',
      'Outbound destinations must use HTTPS.',
    )
  }
  if (url.username || url.password) {
    throw new SafeOutboundRequestError(
      'INVALID_URL',
      'Credentials are not permitted in an outbound destination URL.',
    )
  }
  if (url.hash) {
    throw new SafeOutboundRequestError(
      'INVALID_URL',
      'Fragments are not permitted in an outbound destination URL.',
    )
  }
  const allowedHosts = validateHostList(options.allowedHosts ?? [hostname])
  if (!allowedHosts.has(hostname)) {
    throw new SafeOutboundRequestError(
      'HOST_NOT_ALLOWED',
      'The outbound destination host is not allowed.',
    )
  }
  return url
}

function addressKind(address: ResolvedAddress): 'public' | 'private' | 'never' {
  const family = address.family === 4 ? 'ipv4' : 'ipv6'
  if (address.family === 6 && address.address.toLowerCase().startsWith('::ffff:')) {
    return 'never'
  }
  if (nonRoutableAddresses.check(address.address, family)) return 'never'
  if (privateAddresses.check(address.address, family)) return 'private'
  return 'public'
}

async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  const family = isIP(hostname)
  if (family === 4 || family === 6) return [{ address: hostname, family }]
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  return addresses.map(({ address, family: resolvedFamily }) => {
    if (resolvedFamily !== 4 && resolvedFamily !== 6) {
      throw new SafeOutboundRequestError(
        'ADDRESS_NOT_ALLOWED',
        'DNS returned an unsupported address family.',
      )
    }
    return { address, family: resolvedFamily }
  })
}

function pinnedDispatcher(expectedHostname: string, addresses: ResolvedAddress[]): Agent {
  const lookup: LookupFunction = (hostname, options, callback) => {
    if (normalizedHostname(hostname) !== expectedHostname) {
      callback(Object.assign(new Error('Pinned lookup rejected an unexpected hostname.'), {
        code: 'EAI_FAIL',
      }), '', 0)
      return
    }
    const family = typeof options.family === 'number' ? options.family : 0
    const candidates = family === 4 || family === 6
      ? addresses.filter((address) => address.family === family)
      : addresses
    if (candidates.length === 0) {
      callback(Object.assign(new Error('No pinned address matches the requested family.'), {
        code: 'EAI_ADDRFAMILY',
      }), '', 0)
      return
    }
    if (options.all) callback(null, candidates)
    else callback(null, candidates[0].address, candidates[0].family)
  }
  return new Agent({ connect: { lookup } })
}

function bodySize(body: BodyInit | null | undefined): number {
  if (body == null) return 0
  if (typeof body === 'string') return Buffer.byteLength(body)
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString())
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  if (body instanceof Blob) return body.size
  throw new SafeOutboundRequestError(
    'REQUEST_TOO_LARGE',
    'Streaming outbound request bodies are not supported.',
  )
}

async function boundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) {
    await response.body?.cancel()
    throw new SafeOutboundRequestError(
      'RESPONSE_TOO_LARGE',
      'The outbound response exceeded the configured byte limit.',
    )
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new SafeOutboundRequestError(
        'RESPONSE_TOO_LARGE',
        'The outbound response exceeded the configured byte limit.',
      )
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * Fetch a customer- or provider-supplied public URL without permitting SSRF.
 * DNS is resolved once, every answer must be public, and the connection is
 * pinned to those answers. Redirects are rejected and both directions are
 * byte- and time-bounded.
 */
export async function safeFetchPublicUrl(
  input: string | URL,
  init: RequestInit = {},
  options: SafeOutboundRequestOptions = {},
): Promise<SafeOutboundResponse> {
  const url = validatePublicOutboundUrl(input, options)
  const timeoutMs = boundedInteger(
    'timeoutMs',
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    250,
    300_000,
  )
  const maxRequestBytes = boundedInteger(
    'maxRequestBytes',
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    0,
    100 * 1024 * 1024,
  )
  const maxResponseBytes = boundedInteger(
    'maxResponseBytes',
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    0,
    100 * 1024 * 1024,
  )
  if (bodySize(init.body) > maxRequestBytes) {
    throw new SafeOutboundRequestError(
      'REQUEST_TOO_LARGE',
      'The outbound request exceeded the configured byte limit.',
    )
  }

  const hostname = normalizedHostname(url.hostname)
  const developmentLoopback = (options.environment ?? process.env.NODE_ENV) !== 'production'
    && url.protocol === 'http:'
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
  const resolve = options.resolve ?? defaultResolver
  const createDispatcher = options.createDispatcher ?? pinnedDispatcher
  const request = options.fetch ?? ((target, requestInit) => (
    undiciFetch(
      target,
      requestInit as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>
  ))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()
  const callerSignal = init.signal
  const forwardAbort = () => controller.abort()
  if (callerSignal?.aborted) forwardAbort()
  else callerSignal?.addEventListener('abort', forwardAbort, { once: true })
  let dispatcher: Agent | undefined

  try {
    const addresses = await Promise.race([
      resolve(hostname),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(
          new SafeOutboundRequestError(
            'REQUEST_TIMEOUT',
            'The outbound request timed out.',
          ),
        ), { once: true })
      }),
    ])
    if (
      addresses.length === 0
      || addresses.some((address) => {
        if (isIP(address.address) !== address.family) return true
        const kind = addressKind(address)
        if (kind === 'public') return false
        return !(
          developmentLoopback
          && (
            (address.family === 4 && address.address.startsWith('127.'))
            || (address.family === 6 && address.address === '::1')
          )
        )
      })
    ) {
      throw new SafeOutboundRequestError(
        'ADDRESS_NOT_ALLOWED',
        'The outbound destination resolved to a private or non-routable address.',
      )
    }
    dispatcher = createDispatcher(hostname, addresses)
    const response = await request(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      dispatcher,
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new SafeOutboundRequestError(
        'REDIRECT_NOT_ALLOWED',
        'Outbound redirects are not allowed.',
      )
    }
    const bytes = await boundedResponseBytes(response, maxResponseBytes)
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      bytes,
      text: () => new TextDecoder().decode(bytes),
      json: <T>() => JSON.parse(new TextDecoder().decode(bytes)) as T,
    }
  } catch (error) {
    if (error instanceof SafeOutboundRequestError) throw error
    if (controller.signal.aborted) {
      throw new SafeOutboundRequestError(
        'REQUEST_TIMEOUT',
        'The outbound request timed out.',
      )
    }
    throw new SafeOutboundRequestError(
      'NETWORK_ERROR',
      'The outbound request failed.',
    )
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', forwardAbort)
    if (dispatcher) await dispatcher.close().catch(() => undefined)
  }
}
