export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The request body exceeds ${maxBytes} bytes.`)
    this.name = 'RequestBodyTooLargeError'
  }
}

/** Read a Web Request body while enforcing the limit during streaming. */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('maxBytes must be a non-negative safe integer.')
  }
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes)
    }
  }
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RequestBodyTooLargeError(maxBytes)
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

export async function readBoundedRequestText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    await readBoundedRequestBody(request, maxBytes),
  )
}
