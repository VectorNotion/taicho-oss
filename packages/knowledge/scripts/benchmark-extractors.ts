import { readFile } from 'node:fs/promises';

type Span = { start: number; end: number; type: string };
type Relation = { subject: string; predicate: string; object: string };
type RecordRow = {
  id: string;
  gold: { entities: Span[]; relations: Relation[]; evidence: Array<{ start: number; end: number }> };
  predictions: Record<string, { entities: Span[]; relations: Relation[]; evidence: Array<{ start: number; end: number }>; elapsedMs?: number; peakRamMb?: number; fallback?: boolean }>;
};

const fixture = process.argv[2];
if (!fixture) throw new Error('Usage: pnpm benchmark:extractors <redacted-results.jsonl>');
const rows = (await readFile(fixture, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as RecordRow);
const adapterKeys = [...new Set(rows.flatMap((row) => Object.keys(row.predictions)))].sort();

function key(value: unknown) { return JSON.stringify(value); }
function counts<T>(gold: T[], predicted: T[]) {
  const expected = new Set(gold.map(key));
  const actual = new Set(predicted.map(key));
  const tp = [...actual].filter((value) => expected.has(value)).length;
  return { tp, fp: actual.size - tp, fn: expected.size - tp };
}
function precision({ tp, fp }: { tp: number; fp: number }) { return tp + fp ? tp / (tp + fp) : 1; }
function recall({ tp, fn }: { tp: number; fn: number }) { return tp + fn ? tp / (tp + fn) : 1; }
function f1(value: { tp: number; fp: number; fn: number }) { const p = precision(value); const r = recall(value); return p + r ? 2 * p * r / (p + r) : 0; }

const report = adapterKeys.map((adapter) => {
  const total = { entity: { tp: 0, fp: 0, fn: 0 }, relation: { tp: 0, fp: 0, fn: 0 }, evidence: { tp: 0, fp: 0, fn: 0 } };
  let elapsedMs = 0;
  let peakRamMb = 0;
  let fallbacks = 0;
  for (const row of rows) {
    const prediction = row.predictions[adapter] ?? { entities: [], relations: [], evidence: [] };
    for (const [kind, value] of [['entity', counts(row.gold.entities, prediction.entities)], ['relation', counts(row.gold.relations, prediction.relations)], ['evidence', counts(row.gold.evidence, prediction.evidence)]] as const) {
      total[kind].tp += value.tp; total[kind].fp += value.fp; total[kind].fn += value.fn;
    }
    elapsedMs += prediction.elapsedMs ?? 0;
    peakRamMb = Math.max(peakRamMb, prediction.peakRamMb ?? 0);
    if (prediction.fallback) fallbacks += 1;
  }
  return {
    adapter,
    entityF1: f1(total.entity),
    relationPrecision: precision(total.relation),
    evidencePrecision: precision(total.evidence),
    chunksPerSecond: elapsedMs ? rows.length / (elapsedMs / 1000) : null,
    peakRamMb: peakRamMb || null,
    fallbackRate: rows.length ? fallbacks / rows.length : 0,
  };
});
console.log(JSON.stringify({ records: rows.length, report }, null, 2));
