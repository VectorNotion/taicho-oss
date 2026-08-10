import { getSession } from "@content-automation/platform/data/graph";
import type {
  DimensionMatch,
  ObservationRecord,
  ProspectQualificationResult,
  QualificationStatus,
  ResearchRunRecord,
  TimingSignal,
} from "../domain/qualification";

/**
 * Persistence for the qualification pipeline (spec §17, §18):
 * observations (what we found), matches (how well it matches),
 * ProspectQualification (what our policy says) and ResearchRuns.
 *
 * Complex sub-structures (signals, evidence, matches, breakdown) are stored as
 * JSON string properties — the customAttributes pattern from prospect-repository.
 */

type EntityRef = { kind: "account" | "prospect"; id: string };

function entityMatch(entity: EntityRef): { label: string; obsLabel: string } {
  return entity.kind === "account"
    ? { label: "Account", obsLabel: "AccountObservation" }
    : { label: "Prospect", obsLabel: "ProspectObservation" };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapObservation(props: Record<string, unknown>): ObservationRecord {
  const shape = props.shape as ObservationRecord["shape"];
  return {
    id: props.id as string,
    dimensionKey: props.dimensionKey as string,
    shape,
    observedValue: (props.observedValue as string | null) ?? undefined,
    signals:
      shape === "signals"
        ? parseJson<TimingSignal[]>(props.signalsJson, [])
        : undefined,
    evidence: parseJson<string[]>(props.evidenceJson, []),
    confidence: toNumber(props.confidence),
    researchedAt: props.researchedAt as string,
    runId: props.runId as string,
  };
}

/**
 * Replace the observation for one dimension of one entity. The previous
 * observation is superseded (deleted) only when fresh research replaces it —
 * lapsed observations are otherwise retained and decay via effectiveConfidence
 * (spec §14).
 */
export async function upsertObservation(
  entity: EntityRef,
  obs: Omit<ObservationRecord, "id">
): Promise<ObservationRecord> {
  const { label, obsLabel } = entityMatch(entity);
  const session = await getSession();
  try {
    await session.run(
      `
      MATCH (e:${label} {id: $entityId})-[:HAS_OBSERVATION]->(o:${obsLabel} {dimensionKey: $dimensionKey})
      DETACH DELETE o
      `,
      { entityId: entity.id, dimensionKey: obs.dimensionKey }
    );
    const result = await session.run(
      `
      MATCH (e:${label} {id: $entityId})
      CREATE (o:${obsLabel} {
        id: randomUUID(),
        dimensionKey: $dimensionKey,
        shape: $shape,
        observedValue: $observedValue,
        signalsJson: $signalsJson,
        evidenceJson: $evidenceJson,
        confidence: $confidence,
        researchedAt: $researchedAt,
        runId: $runId
      })
      CREATE (e)-[:HAS_OBSERVATION]->(o)
      RETURN o
      `,
      {
        entityId: entity.id,
        dimensionKey: obs.dimensionKey,
        shape: obs.shape,
        observedValue: obs.observedValue ?? null,
        signalsJson: obs.signals ? JSON.stringify(obs.signals) : null,
        evidenceJson: JSON.stringify(obs.evidence),
        confidence: obs.confidence,
        researchedAt: obs.researchedAt,
        runId: obs.runId,
      }
    );
    if (result.records.length === 0) {
      throw new Error(`${label} not found: ${entity.id}`);
    }
    return mapObservation(result.records[0].get("o").properties);
  } finally {
    await session.close();
  }
}

export async function getObservations(entity: EntityRef): Promise<ObservationRecord[]> {
  const { label, obsLabel } = entityMatch(entity);
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (e:${label} {id: $entityId})-[:HAS_OBSERVATION]->(o:${obsLabel})
      RETURN o ORDER BY o.dimensionKey
      `,
      { entityId: entity.id }
    );
    return result.records.map((record) => mapObservation(record.get("o").properties));
  } finally {
    await session.close();
  }
}

/** Replace all dimension matches for an entity (latest evaluation wins). */
export async function saveMatches(entity: EntityRef, matches: DimensionMatch[]): Promise<void> {
  const { label } = entityMatch(entity);
  const session = await getSession();
  try {
    await session.run(
      `
      MATCH (e:${label} {id: $entityId})-[:HAS_MATCH]->(m:DimensionMatch)
      DETACH DELETE m
      `,
      { entityId: entity.id }
    );
    for (const m of matches) {
      await session.run(
        `
        MATCH (e:${label} {id: $entityId})
        CREATE (m:DimensionMatch {
          id: randomUUID(),
          dimensionKey: $dimensionKey,
          matchScore: $matchScore,
          effectiveMatch: $effectiveMatch,
          classification: $classification,
          hardExclusion: $hardExclusion,
          confidence: $confidence,
          evaluatedAt: localdatetime()
        })
        CREATE (e)-[:HAS_MATCH]->(m)
        `,
        {
          entityId: entity.id,
          dimensionKey: m.dimensionKey,
          matchScore: m.matchScore,
          effectiveMatch: m.effectiveMatch,
          classification: m.classification,
          hardExclusion: m.hardExclusion,
          confidence: m.confidence,
        }
      );
    }
  } finally {
    await session.close();
  }
}

export async function getMatches(entity: EntityRef): Promise<DimensionMatch[]> {
  const { label } = entityMatch(entity);
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (e:${label} {id: $entityId})-[:HAS_MATCH]->(m:DimensionMatch)
      RETURN m ORDER BY m.dimensionKey
      `,
      { entityId: entity.id }
    );
    return result.records.map((record) => {
      const props = record.get("m").properties as Record<string, unknown>;
      return {
        dimensionKey: props.dimensionKey as string,
        matchScore: toNumber(props.matchScore),
        effectiveMatch: toNumber(props.effectiveMatch),
        classification: props.classification as DimensionMatch["classification"],
        hardExclusion: props.hardExclusion as boolean,
        confidence: toNumber(props.confidence),
      } satisfies DimensionMatch;
    });
  } finally {
    await session.close();
  }
}

/** Replace the prospect's ProspectQualification with the latest decision. */
export async function saveProspectQualification(
  prospectId: string,
  result: ProspectQualificationResult
): Promise<void> {
  const session = await getSession();
  try {
    await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
      DETACH DELETE q
      `,
      { prospectId }
    );
    const created = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (q:ProspectQualification {
        id: randomUUID(),
        prospectId: $prospectId,
        status: $status,
        icpScore: $icpScore,
        personaScore: $personaScore,
        timingScore: $timingScore,
        icpMatchesJson: $icpMatchesJson,
        personaMatchesJson: $personaMatchesJson,
        timingBreakdownJson: $timingBreakdownJson,
        reviewReason: $reviewReason,
        computedAt: $computedAt
      })
      CREATE (l)-[:HAS_PROSPECT_QUALIFICATION]->(q)
      RETURN q
      `,
      {
        prospectId,
        status: result.status,
        icpScore: result.icpScore,
        personaScore: result.personaScore,
        timingScore: result.timingScore,
        icpMatchesJson: JSON.stringify(result.icpMatches),
        personaMatchesJson: JSON.stringify(result.personaMatches),
        timingBreakdownJson: JSON.stringify(result.timingBreakdown),
        reviewReason: result.reviewReason ?? null,
        computedAt: result.computedAt,
      }
    );
    if (created.records.length === 0) {
      throw new Error(`Prospect not found: ${prospectId}`);
    }
  } finally {
    await session.close();
  }
}

export async function getProspectQualification(
  prospectId: string
): Promise<ProspectQualificationResult | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
      RETURN q
      `,
      { prospectId }
    );
    if (result.records.length === 0) return null;
    const props = result.records[0].get("q").properties as Record<string, unknown>;
    return {
      status: props.status as QualificationStatus,
      icpScore: toNumber(props.icpScore),
      personaScore: toNumber(props.personaScore),
      timingScore: toNumber(props.timingScore),
      icpMatches: parseJson<DimensionMatch[]>(props.icpMatchesJson, []),
      personaMatches: parseJson<DimensionMatch[]>(props.personaMatchesJson, []),
      timingBreakdown: parseJson(props.timingBreakdownJson, []),
      reviewReason: (props.reviewReason as string | null) ?? undefined,
      computedAt: props.computedAt as string,
    };
  } finally {
    await session.close();
  }
}

export async function recordResearchRun(
  accountId: string,
  run: { runType: "full" | "refresh"; refreshedDimensions: string[] }
): Promise<ResearchRunRecord> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (a:Account {id: $accountId})
      CREATE (r:ResearchRun {
        id: randomUUID(),
        runType: $runType,
        refreshedDimensionsJson: $refreshedDimensionsJson,
        createdAt: localdatetime()
      })
      CREATE (a)-[:HAS_RESEARCH_RUN]->(r)
      RETURN r
      `,
      {
        accountId,
        runType: run.runType,
        refreshedDimensionsJson: JSON.stringify(run.refreshedDimensions),
      }
    );
    if (result.records.length === 0) {
      throw new Error(`Account not found: ${accountId}`);
    }
    const props = result.records[0].get("r").properties as Record<string, unknown>;
    return {
      id: props.id as string,
      runType: props.runType as ResearchRunRecord["runType"],
      refreshedDimensions: parseJson<string[]>(props.refreshedDimensionsJson, []),
      createdAt: props.createdAt?.toString() || new Date().toISOString(),
    };
  } finally {
    await session.close();
  }
}

export async function hasAnyResearchRun(accountId: string): Promise<boolean> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (a:Account {id: $accountId})-[:HAS_RESEARCH_RUN]->(r:ResearchRun)
      RETURN count(r) AS runs
      `,
      { accountId }
    );
    return toNumber(result.records[0].get("runs")) > 0;
  } finally {
    await session.close();
  }
}

export interface TouchListEntry {
  prospectId: string;
  name: string;
  company?: string;
  title?: string;
  icpScore: number;
  personaScore: number;
  timingScore: number;
}

/**
 * Weekly touch list (spec §11): top N QUALIFIED prospects ranked by Timing
 * Score. Fit gates. Timing ranks.
 */
export async function getTouchList(limit = 25): Promise<TouchListEntry[]> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (l:Prospect)-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification {status: 'QUALIFIED'})
      RETURN l, q
      ORDER BY q.timingScore DESC
      LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}
      `
    );
    return result.records.map((record) => {
      const prospect = record.get("l").properties as Record<string, unknown>;
      const q = record.get("q").properties as Record<string, unknown>;
      return {
        prospectId: prospect.id as string,
        name: prospect.name as string,
        company: (prospect.company as string | null) ?? undefined,
        title: (prospect.title as string | null) ?? undefined,
        icpScore: toNumber(q.icpScore),
        personaScore: toNumber(q.personaScore),
        timingScore: toNumber(q.timingScore),
      } satisfies TouchListEntry;
    });
  } finally {
    await session.close();
  }
}
