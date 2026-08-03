import type { ChatEventEnvelope } from './contracts'

function parseEvent(block: string): ChatEventEnvelope | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  try {
    const value = JSON.parse(data) as ChatEventEnvelope
    return value?.version === '1' && typeof value.event === 'string' ? value : null
  } catch {
    return null
  }
}

export async function readChatEventStream(
  response: Response,
  onEvent: (event: ChatEventEnvelope) => void,
): Promise<void> {
  if (!response.body) throw new Error('The assistant returned an empty response.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = parseEvent(buffer.slice(0, boundary))
      if (event) {
        onEvent(event)
        if (event.event === 'error') {
          await reader.cancel()
          throw new Error(
            typeof event.data.message === 'string'
              ? event.data.message
              : 'The assistant could not complete this response.',
          )
        }
      }
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  const finalEvent = parseEvent(buffer)
  if (finalEvent) {
    onEvent(finalEvent)
    if (finalEvent.event === 'error') {
      throw new Error(
        typeof finalEvent.data.message === 'string'
          ? finalEvent.data.message
          : 'The assistant could not complete this response.',
      )
    }
  }
}
