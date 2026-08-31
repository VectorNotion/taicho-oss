import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  createLanguageModelRuntime,
  type LanguageModelRuntime,
} from '@content-automation/platform/agents/model'

export type ModelMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ModelRequest = {
  system: string
  messages: ModelMessage[]
  temperature?: number
}

export interface AssistantModel {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<string>
  stream?(request: ModelRequest, signal?: AbortSignal): AsyncIterable<string>
}

function openRouterDelta(block: string): { done: boolean; text?: string } {
  const payload = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!payload) return { done: false }
  if (payload === '[DONE]') return { done: true }
  const event = JSON.parse(payload) as {
    error?: unknown
    choices?: Array<{ delta?: { content?: unknown } }>
  }
  if (event.error) throw new Error('OpenRouter streaming response failed.')
  const content = event.choices?.[0]?.delta?.content
  return { done: false, text: typeof content === 'string' ? content : undefined }
}

export class OpenRouterAssistantModel implements AssistantModel {
  constructor(private readonly runtime: LanguageModelRuntime = createLanguageModelRuntime()) {}

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<string> {
    let content = ''
    for await (const delta of this.stream(request, signal)) content += delta
    const answer = content.trim()
    if (!answer) throw new Error('OpenRouter returned an empty assistant response.')
    return answer
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<string> {
    const apiKey = this.runtime.requireApiKey()
    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(process.env.ASSISTANT_PUBLIC_URL ? { 'http-referer': process.env.ASSISTANT_PUBLIC_URL } : {}),
        'x-title': 'Taicho Assistants',
      },
      body: JSON.stringify({
        model: this.runtime.modelSlug,
        stream: true,
        temperature: request.temperature ?? 0.2,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages,
        ],
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`OpenRouter request failed (${response.status}).`)
    }
    if (!response.body) throw new Error('OpenRouter returned an empty assistant stream.')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let received = false
    try {
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          const delta = openRouterDelta(block)
          if (delta.done) {
            if (!received) throw new Error('OpenRouter returned an empty assistant response.')
            await reader.cancel()
            return
          }
          if (delta.text) {
            received = true
            yield delta.text
          }
        }
        if (done) break
      }
      if (buffer.trim()) {
        const delta = openRouterDelta(buffer)
        if (delta.done) {
          if (!received) throw new Error('OpenRouter returned an empty assistant response.')
          return
        }
        if (delta.text) {
          received = true
          yield delta.text
        }
      }
      if (!received) throw new Error('OpenRouter returned an empty assistant response.')
    } finally {
      reader.releaseLock()
    }
  }
}

export class StubAssistantModel implements AssistantModel {
  readonly requests: ModelRequest[] = []

  constructor(
    private readonly response: string | ((request: ModelRequest) => string),
    private readonly options: {
      chunkSize?: number
      delayMs?: number
      failBeforeStart?: boolean
      failAfterChunks?: number
    } = {},
  ) {}

  private answer(request: ModelRequest): string {
    return typeof this.response === 'function' ? this.response(request) : this.response
  }

  async complete(request: ModelRequest): Promise<string> {
    this.requests.push(structuredClone(request))
    if (this.options.failBeforeStart) throw new Error('The configured assistant model is unavailable.')
    return this.answer(request)
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<string> {
    this.requests.push(structuredClone(request))
    if (this.options.failBeforeStart) throw new Error('The configured assistant model is unavailable.')
    const answer = this.answer(request)
    const size = Math.max(1, this.options.chunkSize ?? answer.length)
    let emitted = 0
    for (let offset = 0; offset < answer.length; offset += size) {
      if (signal?.aborted) throw signal.reason ?? new Error('The assistant stream was interrupted.')
      if (this.options.failAfterChunks !== undefined && emitted >= this.options.failAfterChunks) {
        throw new Error('The assistant stream was interrupted.')
      }
      yield answer.slice(offset, offset + size)
      emitted += 1
      if (this.options.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, this.options.delayMs)
          signal?.addEventListener('abort', () => {
            clearTimeout(timeout)
            reject(signal.reason ?? new Error('The assistant stream was interrupted.'))
          }, { once: true })
        })
      }
    }
  }
}
