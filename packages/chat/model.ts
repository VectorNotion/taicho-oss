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
  constructor(
    private readonly apiKey = process.env.OPENROUTER_API_KEY,
    private readonly model = process.env.ASSISTANT_MODEL ?? process.env.MODEL_NAME ?? 'qwen/qwen3.7-plus',
  ) {}

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<string> {
    let content = ''
    for await (const delta of this.stream(request, signal)) content += delta
    const answer = content.trim()
    if (!answer) throw new Error('OpenRouter returned an empty assistant response.')
    return answer
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<string> {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY is not configured.')
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        ...(process.env.ASSISTANT_PUBLIC_URL ? { 'http-referer': process.env.ASSISTANT_PUBLIC_URL } : {}),
        'x-title': 'Taicho Assistants',
      },
      body: JSON.stringify({
        model: this.model,
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

  constructor(private readonly response: string | ((request: ModelRequest) => string)) {}

  async complete(request: ModelRequest): Promise<string> {
    this.requests.push(structuredClone(request))
    return typeof this.response === 'function' ? this.response(request) : this.response
  }

  async *stream(request: ModelRequest): AsyncIterable<string> {
    yield await this.complete(request)
  }
}
