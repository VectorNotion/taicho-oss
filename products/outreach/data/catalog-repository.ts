import { getSession } from "@content-automation/platform/data/graph";
import type {
  CatalogItem,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
} from "../domain/catalog";

function mapCatalogItem(props: Record<string, unknown>): CatalogItem {
  return {
    id: String(props.id),
    name: String(props.name),
    kind: props.kind as CatalogItem["kind"],
    summary: String(props.summary ?? ""),
    positioning: String(props.positioning ?? ""),
    outcomes: String(props.outcomes ?? ""),
    differentiators: String(props.differentiators ?? ""),
    proof: String(props.proof ?? ""),
    researchGuidance: String(props.researchGuidance ?? ""),
    voice: String(props.voice ?? ""),
    status: props.status as CatalogItem["status"],
    createdAt: props.createdAt?.toString() ?? new Date().toISOString(),
    updatedAt: props.updatedAt?.toString() ?? new Date().toISOString(),
  };
}

function params(input: CreateCatalogItemInput): Record<string, unknown> {
  return {
    name: input.name,
    kind: input.kind,
    summary: input.summary,
    positioning: input.positioning,
    outcomes: input.outcomes,
    differentiators: input.differentiators,
    proof: input.proof,
    researchGuidance: input.researchGuidance,
    voice: input.voice,
    status: input.status,
  };
}

export async function listCatalogItems(options?: { activeOnly?: boolean }): Promise<CatalogItem[]> {
  const session = await getSession();
  try {
    const result = await session.run(
      options?.activeOnly
        ? "MATCH (item:CatalogItem {status: 'active'}) RETURN item ORDER BY toLower(item.name), item.id"
        : "MATCH (item:CatalogItem) RETURN item ORDER BY item.status, toLower(item.name), item.id",
    );
    return result.records.map((record) => mapCatalogItem(record.get("item").properties));
  } finally {
    await session.close();
  }
}

export async function getCatalogItem(id: string): Promise<CatalogItem | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      "MATCH (item:CatalogItem {id: $id}) RETURN item",
      { id },
    );
    return result.records[0]
      ? mapCatalogItem(result.records[0].get("item").properties)
      : null;
  } finally {
    await session.close();
  }
}

export async function createCatalogItem(input: CreateCatalogItemInput): Promise<CatalogItem> {
  const session = await getSession();
  try {
    const result = await session.run(
      `CREATE (item:CatalogItem {
        id: randomUUID(), name: $name, kind: $kind, summary: $summary,
        positioning: $positioning, outcomes: $outcomes,
        differentiators: $differentiators, proof: $proof,
        researchGuidance: $researchGuidance, voice: $voice, status: $status,
        createdAt: localdatetime(), updatedAt: localdatetime()
      }) RETURN item`,
      params(input),
    );
    return mapCatalogItem(result.records[0].get("item").properties);
  } finally {
    await session.close();
  }
}

export async function updateCatalogItem(
  id: string,
  patch: UpdateCatalogItemInput,
): Promise<CatalogItem | null> {
  const session = await getSession();
  try {
    const values: Record<string, unknown> = { id };
    const sets = ["item.updatedAt = localdatetime()"];
    const fields: Array<keyof UpdateCatalogItemInput> = [
      "name", "kind", "summary", "positioning", "outcomes", "differentiators",
      "proof", "researchGuidance", "voice", "status",
    ];
    for (const field of fields) {
      if (patch[field] !== undefined) {
        sets.push(`item.${field} = $${field}`);
        values[field] = patch[field];
      }
    }
    const result = await session.run(
      `MATCH (item:CatalogItem {id: $id})
       SET ${sets.join(", ")}
       WITH item
       OPTIONAL MATCH (prospect:Prospect)-[:PURSUED_FOR]->(item)
       SET prospect.catalogItemName = item.name
       RETURN DISTINCT item`,
      values,
    );
    return result.records[0]
      ? mapCatalogItem(result.records[0].get("item").properties)
      : null;
  } finally {
    await session.close();
  }
}

export async function deleteCatalogItem(id: string): Promise<boolean> {
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (item:CatalogItem {id: $id})
       OPTIONAL MATCH (prospect:Prospect)-[:PURSUED_FOR]->(item)
       WITH item, count(prospect) AS uses
       FOREACH (_ IN CASE WHEN uses = 0 THEN [1] ELSE [] END | DETACH DELETE item)
       RETURN uses`,
      { id },
    );
    if (!result.records[0]) return false;
    const raw = result.records[0].get("uses");
    const uses = typeof raw?.toNumber === "function" ? raw.toNumber() : Number(raw ?? 0);
    return uses === 0;
  } finally {
    await session.close();
  }
}

export async function assignProspectCatalogItem(
  prospectId: string,
  catalogItemId: string | null,
): Promise<CatalogItem | null> {
  const session = await getSession();
  try {
    if (!catalogItemId) {
      await session.run(
        `MATCH (prospect:Prospect {id: $prospectId})
         OPTIONAL MATCH (prospect)-[existing:PURSUED_FOR]->(:CatalogItem)
         DELETE existing
         REMOVE prospect.catalogItemId, prospect.catalogItemName
         SET prospect.updatedAt = localdatetime()`,
        { prospectId },
      );
      return null;
    }
    const result = await session.run(
      `MATCH (prospect:Prospect {id: $prospectId}), (item:CatalogItem {id: $catalogItemId, status: 'active'})
       OPTIONAL MATCH (prospect)-[existing:PURSUED_FOR]->(:CatalogItem)
       DELETE existing
       MERGE (prospect)-[:PURSUED_FOR]->(item)
       SET prospect.catalogItemId = item.id,
           prospect.catalogItemName = item.name,
           prospect.updatedAt = localdatetime()
       RETURN item`,
      { prospectId, catalogItemId },
    );
    return result.records[0]
      ? mapCatalogItem(result.records[0].get("item").properties)
      : null;
  } finally {
    await session.close();
  }
}

export async function getProspectCatalogItem(prospectId: string): Promise<CatalogItem | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (:Prospect {id: $prospectId})-[:PURSUED_FOR]->(item:CatalogItem)
       RETURN item`,
      { prospectId },
    );
    return result.records[0]
      ? mapCatalogItem(result.records[0].get("item").properties)
      : null;
  } finally {
    await session.close();
  }
}
