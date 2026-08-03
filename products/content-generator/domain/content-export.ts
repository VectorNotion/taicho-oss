export type ContentExportFormat = "markdown" | "plain_text";

export interface ContentExportSource {
  content: string;
  title: string;
}

export interface ContentExport {
  body: string;
  filename: string;
  mimeType: string;
}

function filenameStem(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || "content";
}

export function buildContentExport(
  source: ContentExportSource,
  format: ContentExportFormat,
): ContentExport {
  const title = source.title.trim();
  const content = source.content.trim();
  const stem = filenameStem(title);

  if (format === "markdown") {
    return {
      body: `# ${title}\n\n${content}\n`,
      filename: `${stem}.md`,
      mimeType: "text/markdown;charset=utf-8",
    };
  }

  return {
    body: `${title}\n\n${content}\n`,
    filename: `${stem}.txt`,
    mimeType: "text/plain;charset=utf-8",
  };
}
