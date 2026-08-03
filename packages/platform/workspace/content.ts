import { getSession } from "../data/graph";

export interface WorkspaceContentItem {
  id: string;
  kind: "idea" | "draft";
  title: string;
  summary: string;
  status: string;
  format: string | null;
  updatedAt: string;
  publishedAt: string | null;
  publishedUrl: string | null;
  href: string;
}

function text(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function date(value: unknown): string {
  if (!value) return new Date(0).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export async function listWorkspaceContent(): Promise<WorkspaceContentItem[]> {
  const session = await getSession();
  try {
    const drafts = await session.run(`
      MATCH (item:ContentDraft)
      RETURN item
      ORDER BY item.updatedAt DESC
    `);
    const ideas = await session.run(`
      MATCH (item:ContentIdea)
      RETURN item
      ORDER BY item.updatedAt DESC
    `);
    const items: WorkspaceContentItem[] = [
      ...drafts.records.map((record) => {
        const item = record.get("item").properties as Record<string, unknown>;
        return {
          id: text(item.id),
          kind: "draft" as const,
          title: text(item.title, "Untitled Post"),
          summary: text(item.content).slice(0, 240),
          status: text(item.status, "draft"),
          format: item.type == null ? null : text(item.type),
          updatedAt: date(item.updatedAt ?? item.createdAt),
          publishedAt: item.publishedAt == null ? null : date(item.publishedAt),
          publishedUrl: item.publishedUrl == null ? null : text(item.publishedUrl),
          href: `/content/${text(item.ideaId)}/posts/${text(item.id)}`,
        };
      }),
      ...ideas.records.map((record) => {
        const item = record.get("item").properties as Record<string, unknown>;
        return {
          id: text(item.id),
          kind: "idea" as const,
          title: text(item.title, "Untitled idea"),
          summary: text(item.description),
          status: text(item.status, "idea"),
          format: null,
          updatedAt: date(item.updatedAt ?? item.createdAt),
          publishedAt: null,
          publishedUrl: null,
          href: `/content/${text(item.id)}`,
        };
      }),
    ];
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    await session.close();
  }
}

export async function listPublishedWorkspaceContent(): Promise<
  Array<WorkspaceContentItem & { kind: "draft"; publishedUrl: string }>
> {
  const items = await listWorkspaceContent();
  return items.filter(
    (
      item,
    ): item is WorkspaceContentItem & { kind: "draft"; publishedUrl: string } =>
      item.kind === "draft"
      && item.status === "published"
      && Boolean(item.publishedUrl),
  );
}
