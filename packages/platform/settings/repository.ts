import { getSession } from "../data/graph";
import type { Settings, UpdateSettingsInput } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export class SettingsConflictError extends Error {
  readonly code = "CONFLICT";
  readonly status = 409;

  constructor() {
    super("Workspace identity changed in another session. Review your draft and save again.");
    this.name = "SettingsConflictError";
  }
}

/**
 * Get settings from FalkorDB. Creates with defaults if it does not exist.
 */
export async function getSettings(): Promise<Settings> {
  const session = await getSession();
  const updatedAt = new Date().toISOString();

  try {
    // Try to get existing settings
    const result = await session.run(`
      MATCH (s:Settings {id: "global"})
      RETURN s
    `);

    if (result.records.length > 0) {
      const record = result.records[0].get("s").properties;
      return {
        id: record.id,
        mission: record.mission,
        identity: record.identity,
        voice: record.voice,
        updatedAt: record.updatedAt?.toString() || new Date().toISOString(),
      };
    }

    // Create default settings if not exists
    const createResult = await session.run(
      `
      CREATE (s:Settings {
        id: "global",
        mission: $mission,
        identity: $identity,
        voice: $voice,
        updatedAt: $updatedAt
      })
      RETURN s
    `,
      { ...DEFAULT_SETTINGS, updatedAt }
    );

    const created = createResult.records[0].get("s").properties;
    return {
      id: created.id,
      mission: created.mission,
      identity: created.identity,
      voice: created.voice,
      updatedAt: created.updatedAt?.toString() || new Date().toISOString(),
    };
  } finally {
    await session.close();
  }
}

/**
 * Update settings in FalkorDB.
 */
export async function updateSettings(
  data: UpdateSettingsInput
): Promise<Settings> {
  const session = await getSession();

  try {
    // Build SET clause dynamically for provided fields
    const setClauses: string[] = ["s.updatedAt = $updatedAt"];
    const params: Record<string, string> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.mission !== undefined) {
      setClauses.push("s.mission = $mission");
      params.mission = data.mission;
    }
    if (data.identity !== undefined) {
      setClauses.push("s.identity = $identity");
      params.identity = data.identity;
    }
    if (data.voice !== undefined) {
      setClauses.push("s.voice = $voice");
      params.voice = data.voice;
    }

    const result = data.expectedUpdatedAt
      ? await session.run(
          `
          MATCH (s:Settings {id: "global"})
          WHERE toString(s.updatedAt) = $expectedUpdatedAt
          SET ${setClauses.join(", ")}
          RETURN s
        `,
          { ...params, expectedUpdatedAt: data.expectedUpdatedAt },
        )
      : await session.run(
          `
          MERGE (s:Settings {id: "global"})
          ON CREATE SET
            s.mission = $defaultMission,
            s.identity = $defaultIdentity,
            s.voice = $defaultVoice,
            s.updatedAt = $updatedAt
          SET ${setClauses.join(", ")}
          RETURN s
        `,
          {
            ...params,
            defaultMission: DEFAULT_SETTINGS.mission,
            defaultIdentity: DEFAULT_SETTINGS.identity,
            defaultVoice: DEFAULT_SETTINGS.voice,
          },
        );

    if (data.expectedUpdatedAt && result.records.length === 0) {
      throw new SettingsConflictError();
    }

    const record = result.records[0].get("s").properties;
    return {
      id: record.id,
      mission: record.mission,
      identity: record.identity,
      voice: record.voice,
      updatedAt: record.updatedAt?.toString() || new Date().toISOString(),
    };
  } finally {
    await session.close();
  }
}
