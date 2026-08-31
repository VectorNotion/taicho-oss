/** Standalone vector-research diagnostic (local): prints corpus + margins. */
import { searchTavily } from '../agent/tavily-tool';
import { chunkContent, dimensionAnchors, scoreDimension } from '../agent/vector-research';

async function main() {
  const dim = {
    key: 'decision_authority',
    name: 'Decision authority',
    dimensionType: 'fit',
    appliesTo: 'prospect',
    researchInstruction: 'Research whether the person holds decision-making authority for purchases and strategy.',
    idealValue: 'Executive with direct authority over strategy and purchasing.',
    weight: 1,
  } as never;

  const result = await searchTavily(
    { topic: 'company', query: 'Michael Parkes Co-Founder, President & CRO BranchLab Decision authority', maxResults: 4, fullContent: true },
    AbortSignal.timeout(120_000),
  );
  console.log('search results:', result.results.length);
  for (const r of result.results) console.log(' -', r.title.slice(0, 60), '| content chars:', r.content.length);

  const chunks = result.results.flatMap((r) => chunkContent(r.content, r.url, r.title));
  console.log('chunks:', chunks.length);

  const anchors = await dimensionAnchors(dim);
  console.log('anchors:', anchors.positives.length, anchors.negatives.length);

  const { embedTextsForDebug } = await import('../agent/vector-research') as never;
  // scoreDimension needs chunk vectors; embed inline via the module's API path.
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('no OPENAI_API_KEY');
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: chunks.slice(0, 96).map((c) => c.text) }),
  });
  const payload = await resp.json() as { data: Array<{ index: number; embedding: number[] }> };
  const vectors = payload.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  const score = scoreDimension(dim, anchors, chunks.slice(0, 96), vectors);
  console.log('score:', JSON.stringify({ matchScore: score.matchScore, confidence: score.confidence, top: score.topChunks.map((c) => ({ sim: c.simPos.toFixed(3), margin: c.margin.toFixed(3), text: c.text.slice(0, 80) })) }, null, 1));
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
