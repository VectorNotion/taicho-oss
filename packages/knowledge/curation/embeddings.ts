/**
 * Embedding seam for ontology curation. Live mode uses the OpenAI embeddings
 * REST API (text-embedding-3-small, same model the topics action uses).
 * `ONTOLOGY_EMBEDDINGS_MODE=stub` — or a missing OPENAI_API_KEY — swaps in a
 * deterministic character-trigram vectorizer so dev and tests never need the
 * network while similarity between near-identical phrases stays meaningful.
 */

export type EmbedTexts = (texts: readonly string[]) => Promise<number[][]>;

const STUB_DIMENSIONS = 256;

function trigramVector(text: string): number[] {
  const vector = new Array<number>(STUB_DIMENSIONS).fill(0);
  const normalized = ` ${text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  for (let index = 0; index < normalized.length - 2; index += 1) {
    const gram = normalized.slice(index, index + 3);
    let hash = 2166136261;
    for (let position = 0; position < gram.length; position += 1) {
      hash ^= gram.charCodeAt(position);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % STUB_DIMENSIONS] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

export const stubEmbedTexts: EmbedTexts = async (texts) => texts.map((text) => trigramVector(text));

async function openAiEmbedTexts(texts: readonly string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live ontology embeddings.');
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += 100) {
    const batch = texts.slice(start, start + 100);
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
    });
    if (!response.ok) throw new Error(`OpenAI embeddings error: ${response.status} - ${await response.text()}`);
    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    vectors.push(...data.data.map((row) => row.embedding));
  }
  return vectors;
}

export function ontologyEmbeddingsMode(): 'live' | 'stub' {
  if (process.env.ONTOLOGY_EMBEDDINGS_MODE === 'stub') return 'stub';
  if (process.env.ONTOLOGY_EMBEDDINGS_MODE === 'live') return 'live';
  return process.env.OPENAI_API_KEY ? 'live' : 'stub';
}

export function defaultEmbedTexts(): EmbedTexts {
  return ontologyEmbeddingsMode() === 'live' ? openAiEmbedTexts : stubEmbedTexts;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
