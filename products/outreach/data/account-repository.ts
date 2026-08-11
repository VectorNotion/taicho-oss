import { getSession } from "@content-automation/platform/data/graph";
import {
  DEFAULT_THRESHOLDS,
  type AccountRecord,
  type DimensionMatch,
  type TimingDimensionBreakdown,
} from "../domain/qualification";

/**
 * Account resolution (spec §2, §3): an Account is the company behind a prospect.
 * Accounts are MERGEd per organization graph on the normalized company name so
 * every prospect from the same company lands on the same Account node.
 */

export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapAccount(props: Record<string, unknown>): AccountRecord {
  return {
    id: props.id as string,
    name: props.name as string,
    normalizedName: props.normalizedName as string,
    createdAt: props.createdAt?.toString() || new Date().toISOString(),
  };
}

/**
 * MERGE the prospect's company as an :Account and attach the prospect via BELONGS_TO.
 * Returns null when the prospect has no company (spec §3 — no account resolution).
 */
export async function resolveAccountForProspect(prospect: {
  id: string;
  company?: string;
}): Promise<AccountRecord | null> {
  const company = prospect.company?.trim();
  if (!company) return null;

  const session = await getSession();
  try {
    const result = await session.run(
      `
      MERGE (a:Account {normalizedName: $normalizedName})
      ON CREATE SET a.id = randomUUID(),
                    a.name = $name,
                    a.createdAt = localdatetime()
      WITH a
      MATCH (l:Prospect {id: $prospectId})
      MERGE (l)-[:BELONGS_TO]->(a)
      RETURN a
      `,
      { normalizedName: normalizeCompanyName(company), name: company, prospectId: prospect.id }
    );
    if (result.records.length === 0) {
      // Prospect node missing (pure-account contexts): MERGE the account alone.
      const fallback = await session.run(
        `
        MERGE (a:Account {normalizedName: $normalizedName})
        ON CREATE SET a.id = randomUUID(),
                      a.name = $name,
                      a.createdAt = localdatetime()
        RETURN a
        `,
        { normalizedName: normalizeCompanyName(company), name: company }
      );
      return mapAccount(fallback.records[0].get("a").properties);
    }
    return mapAccount(result.records[0].get("a").properties);
  } finally {
    await session.close();
  }
}

export async function getAccountById(id: string): Promise<AccountRecord | null> {
  const session = await getSession();
  try {
    const result = await session.run(`MATCH (a:Account {id: $id}) RETURN a`, { id });
    if (result.records.length === 0) return null;
    return mapAccount(result.records[0].get("a").properties);
  } finally {
    await session.close();
  }
}

/** The account summary as seen from one of its prospects — the same rollup the
 * Accounts list shows, resolved through the prospect's BELONGS_TO edge, so the
 * prospect page can show a company bar (fit / timing / target) with a link to
 * the account. Null when the prospect has no company/account. */
export interface AccountForProspect extends AccountListItem {
  hardExcluded: boolean;
}

export async function getAccountForProspect(
  prospectId: string,
): Promise<AccountForProspect | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (:Prospect {id: $prospectId})-[:BELONGS_TO]->(a:Account)
      OPTIONAL MATCH (a)-[:HAS_SCORE]->(sc:AccountScore)
      OPTIONAL MATCH (a)<-[:BELONGS_TO]-(p:Prospect)
      OPTIONAL MATCH (p)-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
      WITH a,
           count(DISTINCT p) AS prospectCount,
           sum(CASE WHEN q.status = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualifiedCount,
           max(sc.icpScore) AS icpScore,
           max(sc.timingScore) AS timingScore,
           max(CASE WHEN sc.hardExcluded THEN 1 ELSE 0 END) AS hardExcluded
      RETURN a, prospectCount, qualifiedCount, icpScore, timingScore, hardExcluded
      `,
      { prospectId },
    );
    if (result.records.length === 0) return null;
    const record = result.records[0];
    return {
      ...mapRollupRow(record),
      hardExcluded: (toNumber(record.get("hardExcluded")) ?? 0) > 0,
    };
  } finally {
    await session.close();
  }
}

/** Ids of every prospect attached to the account (contact discovery, spec §10). */
export async function getAccountProspects(accountId: string): Promise<string[]> {
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (l:Prospect)-[:BELONGS_TO]->(a:Account {id: $accountId}) RETURN l.id AS id`,
      { accountId }
    );
    return result.records.map((record) => record.get("id") as string);
  } finally {
    await session.close();
  }
}

/**
 * Account-level rollup for the Accounts list. ICP and Timing are account-level
 * scores (identical across an account's prospects), read from any of the
 * account's prospect qualifications; null until the account has been qualified.
 */
export interface AccountListItem {
  id: string;
  name: string;
  prospectCount: number;
  qualifiedCount: number;
  icpScore: number | null;
  timingScore: number | null;
  isTarget: boolean;
}

export type AccountSort = "icp" | "timing" | "qualified" | "prospects" | "name";

export interface AccountListFilters {
  search?: string;
  /** 'targets' = ICP ≥ minimum; 'qualified' = has a QUALIFIED prospect; 'warm' = timing > 0. */
  segment?: "targets" | "qualified" | "warm";
  /** Default 'icp' — best fit first. */
  sort?: AccountSort;
}

/** Nulls (unscored accounts) always sort last on score columns. */
function orderByClause(sort: AccountSort | undefined): string {
  switch (sort) {
    case "timing":
      return "coalesce(timingScore, -1) DESC, coalesce(icpScore, -1) DESC, a.name";
    case "qualified":
      return "qualifiedCount DESC, coalesce(icpScore, -1) DESC, a.name";
    case "prospects":
      return "prospectCount DESC, a.name";
    case "name":
      return "a.name";
    case "icp":
    default:
      return "coalesce(icpScore, -1) DESC, coalesce(timingScore, -1) DESC, a.name";
  }
}

export interface AccountListPage {
  accounts: AccountListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const ACCOUNT_ROLLUP = `
  MATCH (a:Account)
  OPTIONAL MATCH (a)-[:HAS_SCORE]->(sc:AccountScore)
  OPTIONAL MATCH (a)<-[:BELONGS_TO]-(p:Prospect)
  OPTIONAL MATCH (p)-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
  WITH a,
       count(DISTINCT p) AS prospectCount,
       sum(CASE WHEN q.status = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualifiedCount,
       max(sc.icpScore) AS icpScore,
       max(sc.timingScore) AS timingScore
`;

function mapRollupRow(record: { get(name: string): unknown }): AccountListItem {
  const account = mapAccount(
    (record.get("a") as { properties: Record<string, unknown> }).properties,
  );
  const icpScore = toNumber(record.get("icpScore"));
  return {
    id: account.id,
    name: account.name,
    prospectCount: toNumber(record.get("prospectCount")) ?? 0,
    qualifiedCount: toNumber(record.get("qualifiedCount")) ?? 0,
    icpScore,
    timingScore: toNumber(record.get("timingScore")),
    isTarget: icpScore != null && icpScore >= DEFAULT_THRESHOLDS.icpMinimum,
  };
}

function segmentPredicate(segment?: AccountListFilters["segment"]): string | null {
  switch (segment) {
    case "targets":
      return `icpScore >= ${DEFAULT_THRESHOLDS.icpMinimum}`;
    case "qualified":
      return `qualifiedCount > 0`;
    case "warm":
      return `timingScore > 0`;
    default:
      return null;
  }
}

/** Single WHERE over the rolled-up aggregates (search name + segment). */
function rollupWhere(filters: AccountListFilters): string {
  const conditions: string[] = [];
  if (filters.search?.trim()) conditions.push("toLower(a.name) CONTAINS toLower($search)");
  const segment = segmentPredicate(filters.segment);
  if (segment) conditions.push(segment);
  return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
}

export async function getAccountsPage(
  filters: AccountListFilters,
  pagination: { page: number; pageSize: number },
): Promise<AccountListPage> {
  const page = Math.max(1, Math.floor(pagination.page));
  const pageSize = Math.max(1, Math.min(100, Math.floor(pagination.pageSize)));
  const skip = (page - 1) * pageSize;
  const search = filters.search?.trim();

  const session = await getSession();
  try {
    const where = rollupWhere(filters);

    const rows = await session.run(
      `
      ${ACCOUNT_ROLLUP}
      ${where}
      RETURN a, prospectCount, qualifiedCount, icpScore, timingScore
      ORDER BY ${orderByClause(filters.sort)}
      SKIP ${skip} LIMIT ${pageSize}
      `,
      { search: search ?? "" },
    );

    const totalResult = await session.run(
      `
      ${ACCOUNT_ROLLUP}
      ${where}
      RETURN count(a) AS total
      `,
      { search: search ?? "" },
    );

    return {
      accounts: rows.records.map(mapRollupRow),
      total: toNumber(totalResult.records[0]?.get("total")) ?? 0,
      page,
      pageSize,
    };
  } finally {
    await session.close();
  }
}

export interface AccountCounts {
  total: number;
  targets: number;
  qualified: number;
  warm: number;
}

export async function getAccountCounts(): Promise<AccountCounts> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      ${ACCOUNT_ROLLUP}
      RETURN
        count(a) AS total,
        sum(CASE WHEN icpScore >= ${DEFAULT_THRESHOLDS.icpMinimum} THEN 1 ELSE 0 END) AS targets,
        sum(CASE WHEN qualifiedCount > 0 THEN 1 ELSE 0 END) AS qualified,
        sum(CASE WHEN timingScore > 0 THEN 1 ELSE 0 END) AS warm
      `,
    );
    const row = result.records[0];
    return {
      total: toNumber(row?.get("total")) ?? 0,
      targets: toNumber(row?.get("targets")) ?? 0,
      qualified: toNumber(row?.get("qualified")) ?? 0,
      warm: toNumber(row?.get("warm")) ?? 0,
    };
  } finally {
    await session.close();
  }
}

export interface AccountProspectSummary {
  id: string;
  name: string;
  title?: string;
  status: string;
  personaScore: number | null;
  qualificationStatus: string | null;
  lastContactedAt?: string;
  /** Earliest-due open action item, merged in by the account route from Postgres. */
  nextAction?: { id: string; title: string; dueAt: string } | null;
}

export interface AccountDimensionObservation {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  confidence: number;
  matchScore?: number;
  effectiveMatch?: number;
  classification?: string;
  hardExclusion?: boolean;
}

export interface AccountTimingSignals {
  dimensionKey: string;
  signals: Array<{ signal: string; date: string; evidence: string[]; confidence: number }>;
  dimensionValue?: number;
  signalCount: number;
}

export interface AccountDetail {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  icpScore: number | null;
  timingScore: number | null;
  hardExcluded: boolean;
  reviewReason?: string;
  computedAt?: string;
  icpMatches: DimensionMatch[];
  /** Per fit dimension: what the researcher found (observation + evidence) joined with its match. */
  icpObservations: AccountDimensionObservation[];
  timingBreakdown: TimingDimensionBreakdown[];
  /** Per timing dimension: the dated signals found, joined with the decayed dimension value. */
  timingSignals: AccountTimingSignals[];
  prospects: AccountProspectSummary[];
}

export async function getAccountDetail(id: string): Promise<AccountDetail | null> {
  const session = await getSession();
  try {
    const accountResult = await session.run(`MATCH (a:Account {id: $id}) RETURN a`, { id });
    if (accountResult.records.length === 0) return null;
    const account = mapAccount(accountResult.records[0].get("a").properties);

    // Account-level score (ICP fit + timing), written by runAccountResearch.
    const scoreResult = await session.run(
      `MATCH (a:Account {id: $id})-[:HAS_SCORE]->(s:AccountScore) RETURN s`,
      { id },
    );
    const score = scoreResult.records[0]?.get("s")?.properties as Record<string, unknown> | undefined;
    const timingBreakdown = score ? parseJson<TimingDimensionBreakdown[]>(score.timingBreakdownJson, []) : [];
    const timingValueByKey = new Map(timingBreakdown.map((entry) => [entry.dimensionKey, entry]));

    // ICP fit matches (how well each fit observation matched the ideal).
    const matchResult = await session.run(
      `MATCH (a:Account {id: $id})-[:HAS_MATCH]->(m:DimensionMatch) RETURN m ORDER BY m.dimensionKey`,
      { id },
    );
    const icpMatches: DimensionMatch[] = matchResult.records.map((record) => {
      const m = record.get("m").properties as Record<string, unknown>;
      return {
        dimensionKey: m.dimensionKey as string,
        matchScore: toNumber(m.matchScore) ?? 0,
        effectiveMatch: toNumber(m.effectiveMatch) ?? 0,
        classification: m.classification as DimensionMatch["classification"],
        hardExclusion: m.hardExclusion as boolean,
        confidence: toNumber(m.confidence) ?? 0,
      };
    });
    const matchByKey = new Map(icpMatches.map((m) => [m.dimensionKey, m]));

    // The raw observations the researcher found (spec §17 "what we found").
    const obsResult = await session.run(
      `MATCH (a:Account {id: $id})-[:HAS_OBSERVATION]->(o:AccountObservation) RETURN o ORDER BY o.dimensionKey`,
      { id },
    );
    const icpObservations: AccountDimensionObservation[] = [];
    const timingSignals: AccountTimingSignals[] = [];
    for (const record of obsResult.records) {
      const o = record.get("o").properties as Record<string, unknown>;
      const dimensionKey = o.dimensionKey as string;
      const evidence = parseJson<string[]>(o.evidenceJson, []);
      if ((o.shape as string) === "signals") {
        const signals = parseJson<AccountTimingSignals["signals"]>(o.signalsJson, []);
        const entry = timingValueByKey.get(dimensionKey);
        timingSignals.push({ dimensionKey, signals, dimensionValue: entry?.dimensionValue, signalCount: signals.length });
      } else {
        const match = matchByKey.get(dimensionKey);
        icpObservations.push({
          dimensionKey,
          observedValue: (o.observedValue as string | null) ?? undefined,
          evidence,
          confidence: toNumber(o.confidence) ?? 0,
          matchScore: match?.matchScore,
          effectiveMatch: match?.effectiveMatch,
          classification: match?.classification,
          hardExclusion: match?.hardExclusion,
        });
      }
    }

    // Prospects under the account, each with its persona score + qualification status.
    const prospectResult = await session.run(
      `
      MATCH (p:Prospect)-[:BELONGS_TO]->(a:Account {id: $id})
      OPTIONAL MATCH (p)-[:HAS_SCORE]->(ps:ProspectScore)
      OPTIONAL MATCH (p)-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
      RETURN p, ps, q
      ORDER BY ps.personaScore DESC, p.name
      `,
      { id },
    );
    const prospects: AccountProspectSummary[] = prospectResult.records.map((record) => {
      const p = record.get("p").properties as Record<string, unknown>;
      const ps = (record.get("ps") as { properties: Record<string, unknown> } | null)?.properties;
      const q = (record.get("q") as { properties: Record<string, unknown> } | null)?.properties;
      return {
        id: p.id as string,
        name: p.name as string,
        title: (p.title as string | null) ?? undefined,
        status: (p.status as string | null) ?? "new",
        personaScore: ps ? toNumber(ps.personaScore) : null,
        qualificationStatus: (q?.status as string | null) ?? null,
        lastContactedAt: p.lastContactedAt?.toString(),
      };
    });

    return {
      id: account.id,
      name: account.name,
      normalizedName: account.normalizedName,
      createdAt: account.createdAt,
      icpScore: score ? toNumber(score.icpScore) : null,
      timingScore: score ? toNumber(score.timingScore) : null,
      hardExcluded: Boolean(score?.hardExcluded),
      reviewReason: (score?.reviewReason as string | null) ?? undefined,
      computedAt: (score?.computedAt as string | null) ?? undefined,
      icpMatches,
      icpObservations,
      timingBreakdown,
      timingSignals,
      prospects,
    };
  } finally {
    await session.close();
  }
}
