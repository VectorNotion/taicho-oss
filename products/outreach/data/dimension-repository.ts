import { getSession } from "@content-automation/platform/data/graph";
import type {
  CreateDimensionInput,
  DimensionDefinition,
  UpdateDimensionInput,
} from "../domain/qualification";
import { DEFAULT_DIMENSIONS } from "./default-dimensions";

/**
 * DimensionDefinition storage (spec §2, §18). ICP / Persona / Timing are the
 * (appliesTo × dimensionType) groups of these nodes — see domain/qualification.ts.
 */

function mapDimension(props: Record<string, unknown>): DimensionDefinition {
  return {
    id: props.id as string,
    key: props.key as string,
    name: props.name as string,
    dimensionType: props.dimensionType as DimensionDefinition["dimensionType"],
    appliesTo: props.appliesTo as DimensionDefinition["appliesTo"],
    researchInstruction: props.researchInstruction as string,
    idealValue: (props.idealValue as string | null) ?? undefined,
    weight: toNumber(props.weight),
    halfLifeDays: props.halfLifeDays == null ? undefined : toNumber(props.halfLifeDays),
    freshnessWindowDays: toNumber(props.freshnessWindowDays),
    hardExclusionRule: (props.hardExclusionRule as string | null) ?? undefined,
    isActive: props.isActive as boolean,
    createdAt: props.createdAt?.toString() || new Date().toISOString(),
    updatedAt: props.updatedAt?.toString(),
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

const CREATE_CYPHER = `
  CREATE (d:DimensionDefinition {
    id: randomUUID(),
    key: $key,
    name: $name,
    dimensionType: $dimensionType,
    appliesTo: $appliesTo,
    researchInstruction: $researchInstruction,
    idealValue: $idealValue,
    weight: $weight,
    halfLifeDays: $halfLifeDays,
    freshnessWindowDays: $freshnessWindowDays,
    hardExclusionRule: $hardExclusionRule,
    isActive: $isActive,
    createdAt: localdatetime(),
    updatedAt: localdatetime()
  })
  RETURN d
`;

function createParams(input: CreateDimensionInput): Record<string, unknown> {
  return {
    key: input.key,
    name: input.name,
    dimensionType: input.dimensionType,
    appliesTo: input.appliesTo,
    researchInstruction: input.researchInstruction,
    idealValue: input.idealValue ?? null,
    weight: input.weight,
    halfLifeDays: input.halfLifeDays ?? null,
    freshnessWindowDays: input.freshnessWindowDays,
    hardExclusionRule: input.hardExclusionRule ?? null,
    isActive: input.isActive,
  };
}

/**
 * List dimension definitions. With `seedIfEmpty`, an empty graph is seeded
 * with the spec's default ICP/Persona/Timing dimensions on first read.
 */
export async function getDimensionDefinitions(opts?: {
  activeOnly?: boolean;
  seedIfEmpty?: boolean;
}): Promise<DimensionDefinition[]> {
  const session = await getSession();
  try {
    const query = opts?.activeOnly
      ? `MATCH (d:DimensionDefinition {isActive: true}) RETURN d ORDER BY d.appliesTo, d.dimensionType, d.key`
      : `MATCH (d:DimensionDefinition) RETURN d ORDER BY d.appliesTo, d.dimensionType, d.key`;
    const result = await session.run(query);
    if (result.records.length > 0 || !opts?.seedIfEmpty) {
      return result.records.map((record) => mapDimension(record.get("d").properties));
    }

    // Seed guard: another caller may have raced us; MERGE on key keeps it idempotent.
    for (const input of DEFAULT_DIMENSIONS) {
      await session.run(
        `
        MERGE (d:DimensionDefinition {key: $key})
        ON CREATE SET d.id = randomUUID(),
                      d.name = $name,
                      d.dimensionType = $dimensionType,
                      d.appliesTo = $appliesTo,
                      d.researchInstruction = $researchInstruction,
                      d.idealValue = $idealValue,
                      d.weight = $weight,
                      d.halfLifeDays = $halfLifeDays,
                      d.freshnessWindowDays = $freshnessWindowDays,
                      d.hardExclusionRule = $hardExclusionRule,
                      d.isActive = $isActive,
                      d.createdAt = localdatetime(),
                      d.updatedAt = localdatetime()
        `,
        createParams(input)
      );
    }
    const seeded = await session.run(query);
    return seeded.records.map((record) => mapDimension(record.get("d").properties));
  } finally {
    await session.close();
  }
}

export async function createDimensionDefinition(
  input: CreateDimensionInput
): Promise<DimensionDefinition> {
  const session = await getSession();
  try {
    const result = await session.run(CREATE_CYPHER, createParams(input));
    return mapDimension(result.records[0].get("d").properties);
  } finally {
    await session.close();
  }
}

export async function updateDimensionDefinition(
  id: string,
  patch: UpdateDimensionInput
): Promise<DimensionDefinition | null> {
  const session = await getSession();
  try {
    const setClauses: string[] = ["d.updatedAt = localdatetime()"];
    const params: Record<string, unknown> = { id };
    const fields: Array<keyof UpdateDimensionInput> = [
      "key", "name", "dimensionType", "appliesTo", "researchInstruction",
      "idealValue", "weight", "halfLifeDays", "freshnessWindowDays",
      "hardExclusionRule", "isActive",
    ];
    for (const field of fields) {
      if (patch[field] !== undefined) {
        setClauses.push(`d.${field} = $${field}`);
        params[field] = patch[field];
      }
    }
    const result = await session.run(
      `MATCH (d:DimensionDefinition {id: $id}) SET ${setClauses.join(", ")} RETURN d`,
      params
    );
    if (result.records.length === 0) return null;
    return mapDimension(result.records[0].get("d").properties);
  } finally {
    await session.close();
  }
}

export async function deleteDimensionDefinition(id: string): Promise<boolean> {
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (d:DimensionDefinition {id: $id}) DELETE d RETURN count(d) AS deleted`,
      { id }
    );
    return toNumber(result.records[0].get("deleted")) > 0;
  } finally {
    await session.close();
  }
}
