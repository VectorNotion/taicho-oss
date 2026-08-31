import { getSession } from "@content-automation/platform/data/graph";
import type {
  Persona,
  CreatePersonaInput,
  UpdatePersonaInput,
} from "../domain/types";

/**
 * Map Neo4j record to Persona type
 */
function mapRecordToPersona(record: Record<string, unknown>): Persona {
  const revision = record.revision as { toNumber?: () => number } | number | undefined;
  return {
    id: record.id as string,
    name: record.name as string,
    description: record.description as string,
    targetTitles: record.targetTitles as string[],
    companySizeMin: record.companySizeMin as number | undefined,
    companySizeMax: record.companySizeMax as number | undefined,
    fundingStages: record.fundingStages as string[] | undefined,
    targetDomains: record.targetDomains as string[] | undefined,
    signals: record.signals as string[],
    isActive: record.isActive as boolean,
    revision: typeof revision === "object" && revision?.toNumber ? revision.toNumber() : Number(revision ?? 1),
    createdAt: record.createdAt?.toString() || new Date().toISOString(),
    updatedAt: record.updatedAt?.toString(),
  };
}

/**
 * Get all personas, optionally filtered by active status
 */
export async function getPersonas(activeOnly = false): Promise<Persona[]> {
  const session = await getSession();

  try {
    const query = activeOnly
      ? `MATCH (p:Persona {isActive: true}) RETURN p ORDER BY p.name`
      : `MATCH (p:Persona) RETURN p ORDER BY p.name`;

    const result = await session.run(query);

    return result.records.map((record) =>
      mapRecordToPersona(record.get("p").properties)
    );
  } finally {
    await session.close();
  }
}

/**
 * Get a single persona by ID
 */
export async function getPersonaById(id: string): Promise<Persona | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `MATCH (p:Persona {id: $id}) RETURN p`,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    return mapRecordToPersona(result.records[0].get("p").properties);
  } finally {
    await session.close();
  }
}

export async function getPersonaByName(name: string): Promise<Persona | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `MATCH (p:Persona)
       WHERE toLower(p.name) = toLower($name)
       RETURN p
       ORDER BY p.createdAt
       LIMIT 1`,
      { name: name.trim() },
    );
    return result.records[0]
      ? mapRecordToPersona(result.records[0].get("p").properties)
      : null;
  } finally {
    await session.close();
  }
}

/**
 * Create a new persona
 */
export async function createPersona(data: CreatePersonaInput): Promise<Persona | null> {
  if (await getPersonaByName(data.name)) return null;
  const session = await getSession();

  try {
    const result = await session.run(
      `
      CREATE (p:Persona {
        id: randomUUID(),
        name: $name,
        description: $description,
        targetTitles: $targetTitles,
        companySizeMin: $companySizeMin,
        companySizeMax: $companySizeMax,
        fundingStages: $fundingStages,
        targetDomains: $targetDomains,
        signals: $signals,
        isActive: $isActive,
        revision: 1,
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      RETURN p
      `,
      {
        name: data.name,
        description: data.description,
        targetTitles: data.targetTitles,
        companySizeMin: data.companySizeMin ?? null,
        companySizeMax: data.companySizeMax ?? null,
        fundingStages: data.fundingStages ?? [],
        targetDomains: data.targetDomains ?? [],
        signals: data.signals,
        isActive: data.isActive ?? true,
      }
    );

    return result.records[0]
      ? mapRecordToPersona(result.records[0].get("p").properties)
      : null;
  } finally {
    await session.close();
  }
}

/**
 * Update an existing persona
 */
export async function updatePersona(
  id: string,
  data: UpdatePersonaInput
): Promise<Persona | null> {
  const session = await getSession();

  try {
    // Build SET clause dynamically
    const setClauses: string[] = ["p.updatedAt = localdatetime()", "p.revision = coalesce(p.revision, 1) + 1"];
    const params: Record<string, unknown> = {
      id,
      expectedRevision: data.expectedRevision ?? null,
    };

    if (data.name !== undefined) {
      setClauses.push("p.name = $name");
      params.name = data.name;
    }
    if (data.description !== undefined) {
      setClauses.push("p.description = $description");
      params.description = data.description;
    }
    if (data.targetTitles !== undefined) {
      setClauses.push("p.targetTitles = $targetTitles");
      params.targetTitles = data.targetTitles;
    }
    if (data.companySizeMin !== undefined) {
      setClauses.push("p.companySizeMin = $companySizeMin");
      params.companySizeMin = data.companySizeMin;
    }
    if (data.companySizeMax !== undefined) {
      setClauses.push("p.companySizeMax = $companySizeMax");
      params.companySizeMax = data.companySizeMax;
    }
    if (data.fundingStages !== undefined) {
      setClauses.push("p.fundingStages = $fundingStages");
      params.fundingStages = data.fundingStages;
    }
    if (data.targetDomains !== undefined) {
      setClauses.push("p.targetDomains = $targetDomains");
      params.targetDomains = data.targetDomains;
    }
    if (data.signals !== undefined) {
      setClauses.push("p.signals = $signals");
      params.signals = data.signals;
    }
    if (data.isActive !== undefined) {
      setClauses.push("p.isActive = $isActive");
      params.isActive = data.isActive;
    }

    const result = await session.run(
      `
      MATCH (p:Persona {id: $id})
      WHERE $expectedRevision IS NULL OR coalesce(p.revision, 1) = $expectedRevision
      SET ${setClauses.join(", ")}
      RETURN p
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    return mapRecordToPersona(result.records[0].get("p").properties);
  } finally {
    await session.close();
  }
}

export async function isPersonaReferenced(id: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `MATCH (q:LegacyQualification {matchedPersonaId: $id})
       RETURN count(q) AS references`,
      { id },
    );
    const count = result.records[0]?.get("references");
    return typeof count?.toNumber === "function" ? count.toNumber() > 0 : Number(count ?? 0) > 0;
  } finally {
    await session.close();
  }
}

/**
 * Delete a persona by ID
 */
export async function deletePersona(id: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Persona {id: $id})
      DELETE p
      RETURN count(p) as deleted
      `,
      { id }
    );

    const deleted = result.records[0].get("deleted").toNumber();
    return deleted > 0;
  } finally {
    await session.close();
  }
}
