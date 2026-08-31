import { createHash, randomUUID } from "node:crypto";
import { getSession } from "@content-automation/platform/data/graph";
import {
  DEFAULT_OUTREACH_PROMPT_CONTENT,
  OUTREACH_PROMPT_KEY,
  OUTREACH_PROMPT_VARIABLES,
  validateOutreachPromptContent,
  type OutreachPromptContent,
  type OutreachPromptDraft,
  type OutreachPromptVersion,
  type OutreachPromptWorkspace,
} from "../domain/outreach-prompts";

function outreachPromptContentHash(content: OutreachPromptContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function parseContent(value: unknown): OutreachPromptContent {
  if (typeof value !== "string") return DEFAULT_OUTREACH_PROMPT_CONTENT;
  try {
    return JSON.parse(value) as OutreachPromptContent;
  } catch {
    return DEFAULT_OUTREACH_PROMPT_CONTENT;
  }
}

function mapVersion(properties: Record<string, unknown>): OutreachPromptVersion {
  return {
    id: properties.id as string,
    key: OUTREACH_PROMPT_KEY,
    version: Number(properties.version),
    status: "published",
    content: parseContent(properties.contentJson),
    contentHash: properties.contentHash as string,
    createdAt: properties.createdAt?.toString() ?? new Date().toISOString(),
    createdBy: properties.createdBy as string,
  };
}

async function ensureDefaultPrompt(): Promise<void> {
  const session = await getSession();
  try {
    const contentHash = outreachPromptContentHash(DEFAULT_OUTREACH_PROMPT_CONTENT);
    await session.run(
      `
      MERGE (p:OutreachPrompt {key: $key})
      ON CREATE SET p.activeVersion = 1, p.createdAt = localdatetime()
      MERGE (v:OutreachPromptVersion {key: $key, version: 1})
      ON CREATE SET v.id = $id,
                    v.status = 'published',
                    v.contentJson = $contentJson,
                    v.contentHash = $contentHash,
                    v.createdAt = localdatetime(),
                    v.createdBy = 'system-default'
      MERGE (p)-[:HAS_VERSION]->(v)
      SET p.activeVersion = coalesce(p.activeVersion, 1), p.updatedAt = localdatetime()
      `,
      {
        id: randomUUID(),
        key: OUTREACH_PROMPT_KEY,
        contentJson: JSON.stringify(DEFAULT_OUTREACH_PROMPT_CONTENT),
        contentHash,
      },
    );
  } finally {
    await session.close();
  }
}

export async function getOutreachPromptWorkspace(): Promise<OutreachPromptWorkspace> {
  await ensureDefaultPrompt();
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (p:OutreachPrompt {key: $key})-[:HAS_VERSION]->(active:OutreachPromptVersion)
      WHERE active.version = p.activeVersion
      OPTIONAL MATCH (p)-[:HAS_DRAFT]->(draft:OutreachPromptDraft)
      OPTIONAL MATCH (p)-[:HAS_VERSION]->(version:OutreachPromptVersion)
      RETURN active, draft, version ORDER BY version.version DESC
      `,
      { key: OUTREACH_PROMPT_KEY },
    );
    if (result.records.length === 0) throw new Error("The outreach prompt registry could not be initialized.");
    const active = mapVersion(result.records[0].get("active").properties);
    const draftNode = result.records[0].get("draft") as { properties: Record<string, unknown> } | null;
    const draft: OutreachPromptDraft | null = draftNode ? {
      key: OUTREACH_PROMPT_KEY,
      basedOnVersion: Number(draftNode.properties.basedOnVersion),
      content: parseContent(draftNode.properties.contentJson),
      contentHash: draftNode.properties.contentHash as string,
      updatedAt: draftNode.properties.updatedAt?.toString() ?? new Date().toISOString(),
      updatedBy: draftNode.properties.updatedBy as string,
    } : null;
    const versions = result.records.map((record) => mapVersion(record.get("version").properties));
    return {
      key: OUTREACH_PROMPT_KEY,
      owner: "Outreach",
      purpose: "Generate workspace outreach messages for email, InMail, traditional InMail, and content comments.",
      allowedVariables: [...OUTREACH_PROMPT_VARIABLES],
      active,
      draft,
      versions: versions.map(({ id, version, contentHash, createdAt, createdBy }) => ({
        id, version, contentHash, createdAt, createdBy,
      })),
    };
  } finally {
    await session.close();
  }
}

export async function getActiveOutreachPromptVersion(): Promise<OutreachPromptVersion> {
  return (await getOutreachPromptWorkspace()).active;
}

export async function saveOutreachPromptDraft(
  content: OutreachPromptContent,
  actorId: string,
  expected: { activeVersion: number; draftContentHash: string | null },
): Promise<OutreachPromptWorkspace | null> {
  const errors = validateOutreachPromptContent(content);
  if (errors.length > 0) throw new Error(errors.join(" "));
  await ensureDefaultPrompt();
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (p:OutreachPrompt {key: $key})
      WHERE p.activeVersion = $expectedActiveVersion
      OPTIONAL MATCH (p)-[:HAS_DRAFT]->(existing:OutreachPromptDraft {key: $key})
      WITH p, existing
      WHERE ($expectedDraftHash IS NULL AND existing IS NULL)
         OR existing.contentHash = $expectedDraftHash
      MERGE (p)-[:HAS_DRAFT]->(draft:OutreachPromptDraft {key: $key})
      SET draft.basedOnVersion = $expectedActiveVersion,
          draft.contentJson = $contentJson,
          draft.contentHash = $contentHash,
          draft.updatedAt = localdatetime(),
          draft.updatedBy = $actorId,
          p.updatedAt = localdatetime()
      RETURN draft
      `,
      {
        key: OUTREACH_PROMPT_KEY,
        expectedActiveVersion: expected.activeVersion,
        expectedDraftHash: expected.draftContentHash,
        contentJson: JSON.stringify(content),
        contentHash: outreachPromptContentHash(content),
        actorId,
      },
    );
    if (result.records.length === 0) return null;
  } finally {
    await session.close();
  }
  return getOutreachPromptWorkspace();
}

export async function publishOutreachPromptDraft(
  actorId: string,
  expected: { activeVersion: number; draftContentHash: string },
): Promise<OutreachPromptWorkspace | null> {
  const workspace = await getOutreachPromptWorkspace();
  if (!workspace.draft) {
    if (workspace.active.version !== expected.activeVersion) return null;
    throw new Error("Save a draft before publishing it.");
  }
  const errors = validateOutreachPromptContent(workspace.draft.content);
  if (errors.length > 0) throw new Error(errors.join(" "));
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (p:OutreachPrompt {key: $key})-[:HAS_DRAFT]->(draft:OutreachPromptDraft {key: $key})
      WHERE p.activeVersion = $expectedActiveVersion
        AND draft.basedOnVersion = $expectedActiveVersion
        AND draft.contentHash = $expectedDraftHash
      WITH p, draft, p.activeVersion + 1 AS nextVersion
      CREATE (version:OutreachPromptVersion {
        id: $id,
        key: $key,
        version: nextVersion,
        status: 'published',
        contentJson: draft.contentJson,
        contentHash: draft.contentHash,
        createdAt: localdatetime(),
        createdBy: $actorId
      })
      CREATE (p)-[:HAS_VERSION]->(version)
      SET p.activeVersion = nextVersion, p.updatedAt = localdatetime()
      DETACH DELETE draft
      RETURN version
      `,
      {
        id: randomUUID(),
        key: OUTREACH_PROMPT_KEY,
        actorId,
        expectedActiveVersion: expected.activeVersion,
        expectedDraftHash: expected.draftContentHash,
      },
    );
    if (result.records.length === 0) return null;
  } finally {
    await session.close();
  }
  return getOutreachPromptWorkspace();
}
