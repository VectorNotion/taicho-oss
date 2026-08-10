import { getSession } from "@content-automation/platform/data/graph";
import type { AccountRecord } from "../domain/qualification";

/**
 * Account resolution (spec §2, §3): an Account is the company behind a prospect.
 * Accounts are MERGEd per organization graph on the normalized company name so
 * every prospect from the same company lands on the same Account node.
 */

export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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
