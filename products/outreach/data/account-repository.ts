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

export interface AccountListFilters {
  search?: string;
  /** 'targets' = ICP ≥ minimum; 'qualified' = has a QUALIFIED prospect; 'warm' = timing > 0. */
  segment?: "targets" | "qualified" | "warm";
}

export interface AccountListPage {
  accounts: AccountListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const ACCOUNT_ROLLUP = `
  MATCH (a:Account)
  OPTIONAL MATCH (a)<-[:BELONGS_TO]-(p:Prospect)
  OPTIONAL MATCH (p)-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
  WITH a,
       count(DISTINCT p) AS prospectCount,
       sum(CASE WHEN q.status = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualifiedCount,
       max(q.icpScore) AS icpScore,
       max(q.timingScore) AS timingScore
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
      ORDER BY coalesce(icpScore, -1) DESC, coalesce(timingScore, -1) DESC, a.name
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
}

export interface AccountDetail {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  icpScore: number | null;
  timingScore: number | null;
  icpMatches: DimensionMatch[];
  timingBreakdown: TimingDimensionBreakdown[];
  prospects: AccountProspectSummary[];
}

export async function getAccountDetail(id: string): Promise<AccountDetail | null> {
  const session = await getSession();
  try {
    const accountResult = await session.run(`MATCH (a:Account {id: $id}) RETURN a`, { id });
    if (accountResult.records.length === 0) return null;
    const account = mapAccount(accountResult.records[0].get("a").properties);

    // Account-level ICP matches (the fit dimensions scored against the company).
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

    // Prospects under the account, each with its persona score + status.
    const prospectResult = await session.run(
      `
      MATCH (p:Prospect)-[:BELONGS_TO]->(a:Account {id: $id})
      OPTIONAL MATCH (p)-[:HAS_PROSPECT_QUALIFICATION]->(q:ProspectQualification)
      RETURN p, q
      ORDER BY q.personaScore DESC, p.name
      `,
      { id },
    );

    let icpScore: number | null = null;
    let timingScore: number | null = null;
    let timingBreakdown: TimingDimensionBreakdown[] = [];
    const prospects: AccountProspectSummary[] = prospectResult.records.map((record) => {
      const p = record.get("p").properties as Record<string, unknown>;
      const qNode = record.get("q") as { properties: Record<string, unknown> } | null;
      const q = qNode?.properties;
      if (q) {
        // ICP + timing are account-level; capture from the first qualification seen.
        if (icpScore == null) icpScore = toNumber(q.icpScore);
        if (timingScore == null) timingScore = toNumber(q.timingScore);
        if (timingBreakdown.length === 0) {
          timingBreakdown = parseJson<TimingDimensionBreakdown[]>(q.timingBreakdownJson, []);
        }
      }
      return {
        id: p.id as string,
        name: p.name as string,
        title: (p.title as string | null) ?? undefined,
        status: (p.status as string | null) ?? "new",
        personaScore: q ? toNumber(q.personaScore) : null,
        qualificationStatus: (q?.status as string | null) ?? null,
      };
    });

    return {
      id: account.id,
      name: account.name,
      normalizedName: account.normalizedName,
      createdAt: account.createdAt,
      icpScore,
      timingScore,
      icpMatches,
      timingBreakdown,
      prospects,
    };
  } finally {
    await session.close();
  }
}
