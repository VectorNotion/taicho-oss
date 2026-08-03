import type { AgentStreamFactory, StreamChunk } from './streaming';

/** Build a deterministic Mastra-compatible stream for kernel and route tests. */
export function stubAgentStream(chunks: Iterable<StreamChunk>): AgentStreamFactory {
  return async () => (async function* () {
    yield* chunks;
  })();
}
