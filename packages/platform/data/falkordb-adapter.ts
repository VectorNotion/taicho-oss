/**
 * FalkorDB backend for the graph seam (POC).
 *
 * Presents the small record/session surface our repositories use —
 * session.run(cypher, params) → { records: [{ get(alias) }] }, session.close(),
 * plus Integer-like (.toInt()/.toNumber()) and .toString()-able temporals —
 * on top of the native falkordb client (RESP protocol).
 */
import { FalkorDB } from 'falkordb';
import { organizationGraphName, requireGraphOrganizationId } from './organization-context';

type Params = Record<string, unknown>;

/** Number wrapper satisfying the repositories' integer duck type. */
class IntLike {
  constructor(private readonly v: number) {}
  toInt(): number { return Math.trunc(this.v); }
  toNumber(): number { return this.v; }
  valueOf(): number { return this.v; }
  toString(): string { return String(this.v); }
  toJSON(): number { return this.v; }
}

let db: FalkorDB | null = null;

async function getDb(): Promise<FalkorDB> {
  if (!db) {
    const url = new URL(process.env.FALKORDB_URL || 'redis://localhost:6380');
    db = await FalkorDB.connect({
      socket: { host: url.hostname, port: Number(url.port || 6379) },
      ...(url.password ? { password: url.password } : {}),
    });
  }
  return db;
}

/** Integer-like params ({low,high}/toNumber) → plain numbers. */
function normalizeParam(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(normalizeParam);
  if (typeof v === 'object') {
    const o = v as { toNumber?: () => number; low?: number; high?: number };
    if (typeof o.toNumber === 'function') return o.toNumber();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = normalizeParam(val);
    return out;
  }
  return v;
}

/** Result values → the shapes repositories expect. */
function wrap(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return Number.isInteger(v) ? new IntLike(v) : v;
  if (Array.isArray(v)) return v.map(wrap);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // GraphNode/GraphEdge from falkordb-ts carry .properties — pass through
    // as-is (repositories only read .properties; its values stay raw).
    if ('properties' in o) return o;
    // Plain maps (collect({...}) projections): wrap members recursively.
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = wrap(val);
    return out;
  }
  return v;
}

// The native client returns heterogeneous Cypher projection values. Keeping
// this boundary permissive mirrors graph-record APIs while repositories own
// the domain-specific mapping and validation immediately above it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SeamRecord = { get(name: string): any };
export type SeamResult = { records: SeamRecord[] };
export type SeamSession = {
  run(cypher: string, params?: Params): Promise<SeamResult>;
  close(): Promise<void>;
};

export async function getFalkorSession(organizationId?: string): Promise<SeamSession> {
  const graph = (await getDb()).selectGraph(
    organizationGraphName(requireGraphOrganizationId(organizationId)),
  );
  return {
    async run(cypher: string, params?: Params): Promise<SeamResult> {
      const normalized = params
        ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, normalizeParam(v)]))
        : undefined;
      const options = normalized
        ? ({ params: normalized } as Parameters<typeof graph.query>[1])
        : undefined;
      const res = await graph.query(cypher, options);
      const rows = (res.data ?? []) as Array<Record<string, unknown>>;
      return {
        records: rows.map((row) => ({
          get(name: string) {
            if (!(name in row)) {
              throw new Error(`falkordb adapter: alias "${name}" not in result row (have: ${Object.keys(row).join(', ')})`);
            }
            return wrap(row[name]);
          },
        })),
      };
    },
    async close() { /* connection is shared; nothing per-session */ },
  };
}

export async function closeFalkorDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
