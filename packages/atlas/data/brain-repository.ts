/** Read-only Cypher behind the Brain. The ONLY module that speaks graph
 *  labels; everything leaves here in the user vocabulary (types.ts). */
import { getSession } from '@content-automation/platform/data/graph';
import { LABEL_TO_TYPE } from '../palette';
import type { BrainGraph, BrainNode, BrainLink, BrainSearchResult, BrainNodeType } from '../types';

const EXCLUDED = ['LeadNote', 'LeadActivity', 'OutreachMessage', 'CompanyInsight', 'Competitor', 'Settings', 'SquadAgent', 'Lesson', 'Automation'];
const OVERVIEW_CAP = 400;
const NEIGHBORHOOD_CAP = 100;
const SEARCH_CAP = 12;

type GraphValue = { toNumber?: () => number } | number | string | null | undefined;
function num(v: GraphValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

function degreeExpr(v: string): string {
  return `indegree(${v}) + outdegree(${v})`;
}
const TOPIC_ATTACHED = '(:Topic)-[:DERIVED_FROM]->(n)';

/** Best-effort display label + createdAt + card meta per raw node. */
function toBrainNode(props: Record<string, unknown>, labels: string[], degree: number): BrainNode | null {
  const label = labels.find((l) => LABEL_TO_TYPE[l]);
  if (!label) return null;
  const type: BrainNodeType = LABEL_TO_TYPE[label];
  const p = props as Record<string, string | number | null>;
  // Leads carry both a person name and a job title — name wins there.
  const display =
    (type === 'lead' ? (p.name as string) : null) ||
    (p.displayName as string) || (p.title as string) || (p.name as string) ||
    (type === 'lead-research'
      ? 'Research'
      : type === 'qualification'
        ? `Qualification · ${p.score ?? '–'}`
        : String(p.id ?? 'Unknown'));
  const createdRaw = p.createdAt ?? p.created_at ?? p.qualifiedAt ?? p.first_mentioned ?? null;
  // LeadResearch carries no id of its own — only leadId. Without a synthetic
  // id it collides with its Lead and the HAS_RESEARCH edge self-links away.
  const id = type === 'lead-research'
    ? `lr-${String(p.leadId)}`
    : String(p.id ?? p.leadId ?? display);
  return {
    id,
    label: display,
    type,
    degree,
    createdAt: createdRaw === null ? null : String(createdRaw),
    meta: {
      status: (p.status as string) ?? null,
      priority: (p.priority as string) ?? null,
      company: (p.company as string) ?? null,
      title: type === 'lead' ? ((p.title as string) ?? null) : null,
      score: p.score !== undefined && p.score !== null ? num(p.score as GraphValue) : null,
      type: (p.type as string) ?? null,
      ideaId: (p.ideaId as string) ?? null,
      matchedPersonaName: (p.matchedPersonaName as string) ?? null,
      processed: p.processed !== undefined && p.processed !== null ? String(p.processed) : null,
    },
  };
}

function dedupeGraph(nodes: BrainNode[], links: BrainLink[]): BrainGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const cleanLinks = links.filter((l) => {
    if (!byId.has(l.a) || !byId.has(l.b) || l.a === l.b) return false;
    const k = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { nodes: [...byId.values()], links: cleanLinks };
}

function buildGraph(
  nodeRows: Array<{ props: Record<string, unknown>; labels: string[]; degree: number }>,
  linkRows: Array<{ a: string; b: string; kind: string }>,
): BrainGraph {
  const nodes: BrainNode[] = [];
  for (const r of nodeRows) {
    const n = toBrainNode(r.props, r.labels, r.degree);
    if (n) nodes.push(n);
  }
  return dedupeGraph(nodes, linkRows);
}

export async function fetchOverview(): Promise<BrainGraph> {
  const session = await getSession();
  // FalkorDB openCypher: keep curated categories as separate bounded queries.
  const DEGREE = degreeExpr('n');
  const CATEGORY_QUERIES = [
    `MATCH (n:Project) RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:Topic {status: 'active'}) RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:Lead) RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:Persona {isActive: true}) RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:ContentIdea) RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:ContentDraft) RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (:Lead)-[:HAS_RESEARCH|HAS_QUALIFICATION]->(n)
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n) WHERE (n:Framework OR n:Database OR n:Cloud OR n:Language
       OR n:AIComponent OR n:Feature OR n:Integration OR n:BusinessValue)
       AND (${DEGREE} >= 2 OR ${TOPIC_ATTACHED})
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:ResearchItem) WITH n ORDER BY n.createdAt DESC LIMIT 25
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:ResearchSource {enabled: true}) WHERE (n)-[:YIELDED]->(:ResearchItem)
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
  ];
  try {
    const nodeRows: Array<{ props: Record<string, unknown>; labels: string[]; degree: number }> = [];
    for (const q of CATEGORY_QUERIES) {
      const result = await session.run(q);
      for (const r of result.records) {
        nodeRows.push({
          props: r.get('props') as Record<string, unknown>,
          labels: r.get('labels') as string[],
          degree: num(r.get('degree') as GraphValue),
        });
        if (nodeRows.length >= OVERVIEW_CAP) break;
      }
      if (nodeRows.length >= OVERVIEW_CAP) break;
    }
    const ids = nodeRows
      .map((r) => (r.props as { id?: unknown; leadId?: unknown }).id ?? (r.props as { leadId?: unknown }).leadId)
      .filter(Boolean)
      .map(String);

    const linkResult = await session.run(
      `
      MATCH (a)-[r]->(b)
      WHERE coalesce(a.id, a.leadId) IN $ids AND coalesce(b.id, b.leadId) IN $ids
      RETURN coalesce(a.id, a.leadId) AS a, labels(a) AS aLabels,
             coalesce(b.id, b.leadId) AS b, labels(b) AS bLabels, type(r) AS kind
      `,
      { ids },
    );
    const withSynthetic = (raw: string, labels: string[]): string =>
      labels.includes('LeadResearch') ? `lr-${raw}` : raw;
    const linkRows = linkResult.records.map((r) => ({
      a: withSynthetic(String(r.get('a')), r.get('aLabels') as string[]),
      b: withSynthetic(String(r.get('b')), r.get('bLabels') as string[]),
      kind: String(r.get('kind')),
    }));
    return buildGraph(nodeRows, linkRows);
  } finally {
    await session.close();
  }
}

export async function fetchNeighborhood(id: string): Promise<BrainGraph> {
  const session = await getSession();
  const researchLeadId = id.startsWith('lr-') ? id.slice(3) : null;
  try {
    const result = await session.run(
      researchLeadId
        ? `
      MATCH (c:LeadResearch) WHERE c.leadId = $id
      WITH c LIMIT 1
      OPTIONAL MATCH (c)-[r]-(m)
      WHERE NONE(l IN labels(m) WHERE l IN $excluded)
      WITH c, r, m LIMIT ${NEIGHBORHOOD_CAP}
      RETURN properties(c) AS cProps, labels(c) AS cLabels, ${degreeExpr('c')} AS cDegree,
             collect({props: properties(m), labels: labels(m),
                      degree: ${degreeExpr('m')},
                      a: coalesce(startNode(r).id, startNode(r).leadId),
                      b: coalesce(endNode(r).id, endNode(r).leadId),
                      aLabels: labels(startNode(r)), bLabels: labels(endNode(r)),
                      kind: type(r)}) AS nbrs
      `
        : `
      MATCH (c) WHERE coalesce(c.id, c.leadId) = $id
      WITH c LIMIT 1
      OPTIONAL MATCH (c)-[r]-(m)
      WHERE NONE(l IN labels(m) WHERE l IN $excluded)
      WITH c, r, m LIMIT ${NEIGHBORHOOD_CAP}
      RETURN properties(c) AS cProps, labels(c) AS cLabels, ${degreeExpr('c')} AS cDegree,
             collect({props: properties(m), labels: labels(m),
                      degree: ${degreeExpr('m')},
                      a: coalesce(startNode(r).id, startNode(r).leadId),
                      b: coalesce(endNode(r).id, endNode(r).leadId),
                      aLabels: labels(startNode(r)), bLabels: labels(endNode(r)),
                      kind: type(r)}) AS nbrs
      `,
      { id: researchLeadId ?? id, excluded: EXCLUDED },
    );
    if (result.records.length === 0) return { nodes: [], links: [] };
    const rec = result.records[0];
    const nodeRows = [{
      props: rec.get('cProps') as Record<string, unknown>,
      labels: rec.get('cLabels') as string[],
      degree: num(rec.get('cDegree')),
    }];
    const linkRows: BrainLink[] = [];
    for (const nb of rec.get('nbrs') as Array<Record<string, unknown>>) {
      if (!nb || !nb.labels) continue;
      nodeRows.push({
        props: nb.props as Record<string, unknown>,
        labels: nb.labels as string[],
        degree: num(nb.degree as GraphValue),
      });
      if (nb.a && nb.b) {
        const synth = (raw: unknown, ls: unknown): string =>
          Array.isArray(ls) && (ls as string[]).includes('LeadResearch') ? `lr-${String(raw)}` : String(raw);
        linkRows.push({
          a: synth(nb.a, nb.aLabels),
          b: synth(nb.b, nb.bLabels),
          kind: String(nb.kind),
        });
      }
    }
    return buildGraph(nodeRows, linkRows);
  } finally {
    await session.close();
  }
}

export async function searchNodes(q: string): Promise<BrainSearchResult[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (n)
      WHERE NONE(l IN labels(n) WHERE l IN $excluded)
        AND (toLower(coalesce(n.displayName, '')) CONTAINS $q
          OR toLower(coalesce(n.title, '')) CONTAINS $q
          OR toLower(coalesce(n.name, '')) CONTAINS $q)
      RETURN properties(n) AS props, labels(n) AS labels
      LIMIT ${SEARCH_CAP}
      `,
      { q: query, excluded: EXCLUDED },
    );
    const out: BrainSearchResult[] = [];
    for (const r of result.records) {
      const n = toBrainNode(r.get('props') as Record<string, unknown>, r.get('labels') as string[], 0);
      if (!n) continue;
      const sub = [n.meta.title, n.meta.company, n.meta.status].filter(Boolean).join(' · ');
      out.push({ id: n.id, label: n.label, type: n.type, sub });
    }
    return out;
  } finally {
    await session.close();
  }
}
