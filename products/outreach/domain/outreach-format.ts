import type { OutreachMedium } from "./types";

function recipientFirstName(prospectName: string): string {
  return prospectName.trim().split(/\s+/)[0] || "there";
}

function withoutGreeting(content: string): string {
  return content
    .replace(/^(?:hi|hello|hey)\s+[^,\n]{1,60}(?:,|\n+)\s*/i, "")
    .trim();
}

function sentences(paragraph: string): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...segmenter.segment(paragraph)]
    .map(({ segment }) => segment.trim())
    .filter(Boolean);
}

function shortParagraphs(content: string): string[] {
  const sourceParagraphs = content
    .replaceAll("\r\n", "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return sourceParagraphs.flatMap((paragraph) => {
    const parts = sentences(paragraph);
    if (parts.length <= 2) return [paragraph];

    const grouped: string[] = [];
    for (let index = 0; index < parts.length; index += 2) {
      grouped.push(parts.slice(index, index + 2).join(" "));
    }
    return grouped;
  });
}

/**
 * Keeps generated and legacy drafts readable in the UI and clipboard even if
 * a model omits whitespace. Content comments intentionally keep their native
 * social format and do not receive an email-style greeting.
 */
export function formatOutreachContent(
  content: string,
  prospectName: string,
  medium: OutreachMedium,
): string {
  const normalized = content.replaceAll("\r\n", "\n").trim();
  if (!normalized || medium === "content_comment") return normalized;

  const body = withoutGreeting(normalized);
  const paragraphs = shortParagraphs(body);
  return [`Hi ${recipientFirstName(prospectName)},`, ...paragraphs].join("\n\n");
}
