/** Read-only Cypher behind the Brain. The ONLY module that speaks graph
 *  labels; everything leaves here in the user vocabulary (types.ts). */
import { getSession } from '@content-automation/platform/data/graph';
import { LABEL_TO_TYPE } from '../palette';
import type { BrainGraph, BrainNode, BrainLink, BrainKnowledgeItem, BrainProof, BrainSearchResult, BrainNodeType } from '../types';

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

function mergedKnowledgeProps(props: Record<string, unknown>): Record<string, unknown> {
  if (typeof props.json !== 'string') return props;
  try {
    const parsed = JSON.parse(props.json) as Record<string, unknown>;
    return { ...props, ...parsed };
  } catch {
    return props;
  }
}

export function entityBrainType(typeKeys: unknown): BrainNodeType {
  const keys = Array.isArray(typeKeys) ? typeKeys.map(String) : [String(typeKeys ?? '')];
  const normalized = keys.map((key) => key.toLowerCase());
  if (normalized.includes('content.project')) return 'project';
  if (normalized.includes('content.topic')) return 'topic';
  if (normalized.includes('content.idea')) return 'idea';
  if (normalized.includes('content.draft')) return 'draft';
  if (normalized.includes('outreach.prospect')) return 'prospect';
  const parts = keys.flatMap((key) => key.toLowerCase().split(/[._-]/));
  if (parts.some((part) => ['organization', 'account', 'company'].includes(part))) return 'organization';
  if (parts.some((part) => ['person', 'prospect', 'member'].includes(part))) return 'person';
  if (parts.some((part) => ['concept', 'topic'].includes(part))) return 'concept';
  if (parts.includes('event')) return 'event';
  if (parts.includes('place')) return 'place';
  return 'thing';
}

function artifactBrainType(kind: unknown): BrainNodeType {
  switch (String(kind ?? '').toLowerCase()) {
    case 'content.idea': return 'idea';
    case 'content.draft': return 'draft';
    case 'content.topic': return 'topic';
    default: return 'thing';
  }
}

/** Best-effort display label + createdAt + card meta per raw node. */
function toBrainNode(props: Record<string, unknown>, labels: string[], degree: number): BrainNode | null {
  const label = labels.find((l) => LABEL_TO_TYPE[l]);
  if (!label) return null;
  const p = mergedKnowledgeProps(props) as Record<string, unknown>;
  const metadata = p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
    ? p.metadata as Record<string, unknown>
    : {};
  const type: BrainNodeType = label === 'CanonicalEntity'
    ? entityBrainType(p.typeKeys ?? p.typeKey)
    : label === 'Artifact'
      ? artifactBrainType(p.kind)
      : LABEL_TO_TYPE[label];
  // Prospects carry both a person name and a job title — name wins there.
  const display =
    (type === 'prospect' ? (p.name as string) : null) ||
    (label === 'Artifact' ? (metadata.title as string) : null) ||
    (p.displayName as string) || (p.title as string) || (p.name as string) ||
    (p.description as string) ||
    (label === 'Claim' ? (p.statement as string) : null) ||
    (label === 'Evidence' ? (p.excerpt as string) : null) ||
    (label === 'SourceRevision' ? 'Source snapshot' : null) ||
    (label === 'Assessment' ? String(p.kind ?? 'Assessment').replaceAll(/[._-]/g, ' ') : null) ||
    (label === 'KnowledgeSource' ? (p.canonicalUri as string) : null) ||
    (type === 'prospect-research'
      ? 'Research'
      : type === 'qualification'
        ? `Qualification · ${p.score ?? '–'}`
        : String(p.id ?? 'Unknown'));
  const createdRaw = p.createdAt ?? p.created_at ?? p.qualifiedAt ?? p.first_mentioned ?? null;
  const externalIds = p.externalIds && typeof p.externalIds === 'object' && !Array.isArray(p.externalIds)
    ? p.externalIds as Record<string, unknown>
    : {};
  const productIdKey: Partial<Record<BrainNodeType, string>> = {
    project: 'content_project',
    topic: 'content_topic',
    idea: 'content_idea',
    draft: 'content_draft',
    prospect: 'outreach_prospect',
  };
  const productId = label === 'Artifact'
    ? p.externalId
    : productIdKey[type]
      ? externalIds[productIdKey[type]!]
      : null;
  // ProspectResearch carries no id of its own — only prospectId. Without a synthetic
  // id it collides with its Prospect and the HAS_RESEARCH edge self-links away.
  const id = type === 'prospect-research'
    ? `lr-${String(p.prospectId)}`
    : String(p.id ?? p.prospectId ?? display);
  return {
    id,
    label: display,
    type,
    degree,
    createdAt: createdRaw === null ? null : String(createdRaw),
    meta: {
      status: (p.status as string) ?? (metadata.status as string) ?? null,
      priority: (p.priority as string) ?? (metadata.priority as string) ?? null,
      company: (p.company as string) ?? null,
      title: type === 'prospect' ? ((p.title as string) ?? null) : null,
      score: p.score !== undefined && p.score !== null ? num(p.score as GraphValue) : null,
      type: (p.visualType as string) ?? (p.type as string) ?? null,
      ideaId: (p.ideaId as string) ?? (metadata.ideaId as string) ?? null,
      matchedPersonaName: (p.matchedPersonaName as string) ?? null,
      processed: p.processed !== undefined && p.processed !== null ? String(p.processed) : null,
      predicate: (p.predicateKey as string) ?? null,
      confidence: p.confidence !== undefined && p.confidence !== null ? num(p.confidence as GraphValue) : null,
      sensitivity: (p.sensitivity as string) ?? null,
      entityType: (p.typeKey as string) ?? null,
      productId: productId === undefined || productId === null ? null : String(productId),
      url: (p.locator as string) ?? (p.canonicalUri as string) ?? (p.url as string) ?? null,
    },
    ...(label === 'Evidence' && p.excerpt && p.locator
      ? { proofs: [{ id, excerpt: String(p.excerpt), url: String(p.locator) }] }
      : {}),
  };
}

async function attachClaimProofs(
  session: Awaited<ReturnType<typeof getSession>>,
  graph: BrainGraph,
): Promise<BrainGraph> {
  const claimIds = graph.nodes.filter(({ type }) => type === 'fact').map(({ id }) => id);
  if (claimIds.length === 0) return graph;
  const result = await session.run(
    `MATCH (claim:Claim {status: 'accepted', schemaVersion: 'knowledge.v1'})-[:SUPPORTED_BY]->(evidence:Evidence {schemaVersion: 'knowledge.v1'})
     WHERE claim.id IN $claimIds
     OPTIONAL MATCH (source:KnowledgeSource {schemaVersion: 'knowledge.v1'})-[:HAS_REVISION]->(:SourceRevision {schemaVersion: 'knowledge.v1'})-[:CONTAINS]->(evidence)
     RETURN claim.id AS claimId, evidence.json AS evidenceJson, source.json AS sourceJson`,
    { claimIds },
  );
  const byClaim = new Map<string, BrainProof[]>();
  for (const record of result.records) {
    const raw = record.get('evidenceJson');
    if (typeof raw !== 'string') continue;
    try {
      const evidence = JSON.parse(raw) as { id?: unknown; excerpt?: unknown; locator?: unknown };
      if (!evidence.id || !evidence.excerpt) continue;
      let sourceUri: string | undefined;
      const rawSource = record.get('sourceJson');
      if (typeof rawSource === 'string') {
        try { sourceUri = String((JSON.parse(rawSource) as { canonicalUri?: unknown }).canonicalUri ?? '') || undefined; } catch { /* use explain fallback */ }
      }
      const locator = typeof evidence.locator === 'string' && /^https?:\/\//i.test(evidence.locator)
        ? evidence.locator
        : sourceUri && /^https?:\/\//i.test(sourceUri)
          ? sourceUri
          : `/api/v1/knowledge/explain/${encodeURIComponent(String(record.get('claimId')))}?use=internal`;
      const proof: BrainProof = {
        id: String(evidence.id),
        excerpt: String(evidence.excerpt),
        url: locator,
      };
      const claimId = String(record.get('claimId'));
      const proofs = byClaim.get(claimId) ?? [];
      if (!proofs.some(({ id }) => id === proof.id)) proofs.push(proof);
      byClaim.set(claimId, proofs);
    } catch { /* compatibility evidence without knowledge.v1 JSON */ }
  }
  const nodesWithProofs = graph.nodes.map((node) => node.type === 'fact'
    ? { ...node, proofs: byClaim.get(node.id) ?? [] }
    : node);
  const nodeById = new Map(nodesWithProofs.map((node) => [node.id, node]));
  const knowledgeByNode = new Map<string, BrainKnowledgeItem[]>();
  for (const link of graph.links) {
    const left = nodeById.get(link.a);
    const right = nodeById.get(link.b);
    const claim = left?.type === 'fact' ? left : right?.type === 'fact' ? right : null;
    const subject = claim === left ? right : claim === right ? left : null;
    if (!claim || !subject || subject.type === 'evidence' || subject.type === 'source') continue;
    const items = knowledgeByNode.get(subject.id) ?? [];
    if (!items.some(({ id }) => id === claim.id)) {
      items.push({ id: claim.id, statement: claim.label, proofs: claim.proofs ?? [] });
    }
    knowledgeByNode.set(subject.id, items);
  }
  return {
    ...graph,
    nodes: nodesWithProofs.map((node) => {
      const knowledge = knowledgeByNode.get(node.id);
      return knowledge?.length ? { ...node, knowledge } : node;
    }),
  };
}

function dedupeGraph(nodes: BrainNode[], links: BrainLink[]): BrainGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const cleanLinks = links.filter((l) => {
    if (!byId.has(l.a) || !byId.has(l.b) || l.a === l.b) return false;
    const k = `${l.a}|${l.kind}|${l.b}`;
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
  // Content already persists its user-visible records and relationships in
  // this organization graph. Include those records directly alongside the
  // richer knowledge.v1 projection instead of requiring a second write path.
  const DEGREE = degreeExpr('n');
  const CATEGORY_QUERIES = [
    `MATCH (n)
     WHERE n:Project OR n:Topic OR n:ContentIdea OR n:ContentDraft OR n:MediaAsset OR n:ResearchItem OR n:ResearchSource
     WITH n ORDER BY toString(coalesce(n.updatedAt, n.createdAt, n.addedAt)) DESC LIMIT 160
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:CanonicalEntity {schemaVersion: 'knowledge.v1'})<-[:SUBJECT|OBJECT]-(c:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'})
     WITH DISTINCT n ORDER BY n.updatedAt DESC LIMIT 120
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:CanonicalEntity {schemaVersion: 'knowledge.v1'})<-[:ASSESSES]-(:Assessment {schemaVersion: 'knowledge.v1'})
     WITH DISTINCT n ORDER BY n.updatedAt DESC LIMIT 80
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:Assessment {schemaVersion: 'knowledge.v1'}) WITH n ORDER BY n.updatedAt DESC LIMIT 40
     RETURN properties(n) AS props, labels(n) AS labels, ${DEGREE} AS degree`,
    `MATCH (n:Artifact {schemaVersion: 'knowledge.v1'})-[:USES]->(:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'})
     WHERE n.kind IS NULL OR NOT n.kind IN ['content.idea', 'content.draft', 'content.topic']
     WITH DISTINCT n ORDER BY n.createdAt DESC LIMIT 80
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
      .map((r) => (r.props as { id?: unknown; prospectId?: unknown }).id ?? (r.props as { prospectId?: unknown }).prospectId)
      .filter(Boolean)
      .map(String);

    const linkResult = await session.run(
      `
      MATCH (a)-[r]->(b)
      WHERE a.id IN $ids AND b.id IN $ids
      RETURN a.id AS a, labels(a) AS aLabels,
             b.id AS b, labels(b) AS bLabels, type(r) AS kind
      `,
      { ids },
    );
    const linkRows = linkResult.records.map((r) => ({
      a: String(r.get('a')),
      b: String(r.get('b')),
      kind: String(r.get('kind')),
    }));
    // Claims remain first-class stored nodes for provenance, but the overview
    // projects Subject -> Claim -> Object as one semantic edge. This keeps the
    // map about knowledge instead of turning every fact/evidence record into a
    // visual waypoint. Clicking an entity still loads the underlying claims.
    const semanticResult = await session.run(
      `MATCH (claim:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'})-[:SUBJECT]->(a:CanonicalEntity {schemaVersion: 'knowledge.v1'}),
             (claim)-[:OBJECT]->(b:CanonicalEntity {schemaVersion: 'knowledge.v1'})
       WHERE a.id IN $ids AND b.id IN $ids
       RETURN a.id AS a, b.id AS b, claim.json AS json`,
      { ids },
    );
    for (const record of semanticResult.records) {
      let kind = 'RELATED_TO';
      const raw = record.get('json');
      if (typeof raw === 'string') {
        try { kind = String((JSON.parse(raw) as { predicateKey?: unknown }).predicateKey ?? kind); } catch { /* compatibility node */ }
      }
      linkRows.push({ a: String(record.get('a')), b: String(record.get('b')), kind });
    }
    const artifactResult = await session.run(
      `MATCH (artifact:Artifact {schemaVersion: 'knowledge.v1'})-[:USES]->(claim:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'})-[:SUBJECT]->(entity:CanonicalEntity {schemaVersion: 'knowledge.v1'})
       WHERE artifact.id IN $ids AND entity.id IN $ids
       RETURN DISTINCT artifact.id AS a, entity.id AS b`,
      { ids },
    );
    for (const record of artifactResult.records) {
      linkRows.push({
        a: String(record.get('a')),
        b: String(record.get('b')),
        kind: 'USES_KNOWLEDGE',
      });
    }
    return buildGraph(nodeRows, linkRows);
  } finally {
    await session.close();
  }
}

export async function fetchNeighborhood(id: string): Promise<BrainGraph> {
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (c {id: $id})
      WHERE c.schemaVersion = 'knowledge.v1'
        OR c:Project OR c:Topic OR c:ContentIdea OR c:ContentDraft OR c:MediaAsset OR c:ResearchItem OR c:ResearchSource
      WITH c LIMIT 1
      OPTIONAL MATCH (c)-[r]-(m)
      WHERE (m.schemaVersion = 'knowledge.v1'
          OR m:Project OR m:Topic OR m:ContentIdea OR m:ContentDraft OR m:MediaAsset OR m:ResearchItem OR m:ResearchSource)
        AND (NOT m:Claim OR m.status = 'accepted')
        AND (NOT c:Claim OR c.status = 'accepted')
      WITH c, r, m LIMIT ${NEIGHBORHOOD_CAP}
      RETURN properties(c) AS cProps, labels(c) AS cLabels, ${degreeExpr('c')} AS cDegree,
             collect({props: properties(m), labels: labels(m),
                      degree: ${degreeExpr('m')},
                      a: startNode(r).id,
                      b: endNode(r).id,
                      aLabels: labels(startNode(r)), bLabels: labels(endNode(r)),
                      kind: type(r)}) AS nbrs
      `,
      { id },
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
        linkRows.push({
          a: String(nb.a),
          b: String(nb.b),
          kind: String(nb.kind),
        });
      }
    }
    return attachClaimProofs(session, buildGraph(nodeRows, linkRows));
  } finally {
    await session.close();
  }
}

export async function searchNodes(q: string): Promise<BrainSearchResult[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const session = await getSession();
  try {
    const knowledgeResult = await session.run(
      `MATCH (n) WHERE (
         (n.schemaVersion = 'knowledge.v1' AND (n:CanonicalEntity OR n:Claim OR n:Assessment OR n:KnowledgeSource OR n:Artifact))
         OR n:Project OR n:Topic OR n:ContentIdea OR n:ContentDraft OR n:MediaAsset OR n:ResearchItem OR n:ResearchSource
       ) AND (NOT n:Claim OR n.status = 'accepted')
         AND (NOT n:Artifact OR n.kind IS NULL OR NOT n.kind IN ['content.idea', 'content.draft', 'content.topic'])
         AND (
           toLower(toString(coalesce(n.displayName, n.title, n.name, n.description, n.altText, n.url, n.canonicalUri, ''))) CONTAINS $query
           OR (n.json IS NOT NULL AND toLower(toString(n.json)) CONTAINS $query)
         )
       RETURN properties(n) AS props, labels(n) AS labels
       LIMIT ${SEARCH_CAP * 20}`,
      { query },
    );
    const out: BrainSearchResult[] = [];
    const seen = new Set<string>();
    for (const r of knowledgeResult.records) {
      const n = toBrainNode(r.get('props') as Record<string, unknown>, r.get('labels') as string[], 0);
      if (!n) continue;
      if (!`${n.label} ${Object.values(n.meta).filter(Boolean).join(' ')}`.toLowerCase().includes(query)) continue;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const sub = [n.meta.title, n.meta.company, n.meta.status].filter(Boolean).join(' · ');
      out.push({ id: n.id, label: n.label, type: n.type, sub });
      if (out.length >= SEARCH_CAP) break;
    }
    return out;
  } finally {
    await session.close();
  }
}
