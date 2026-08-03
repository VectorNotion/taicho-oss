import type { ContentType } from "./content";

type GeneratedParts = Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Turns each type-specific structured output into the canonical string stored
 * on a ContentDraft and scored by Resonance. The streaming UI calls the same
 * function on partial objects, keeping the preview and persisted artifact
 * byte-for-byte consistent as fields arrive.
 */
export function formatGeneratedContent(type: ContentType, output: GeneratedParts): string {
  if (type === "video_script") {
    return [
      text(output.hook),
      text(output.intro),
      ...strings(output.main_sections),
      text(output.conclusion),
      text(output.call_to_action),
    ].filter(Boolean).join("\n\n");
  }
  if (type === "blog_post") {
    return [
      text(output.title) && `# ${text(output.title)}`,
      text(output.introduction),
      ...strings(output.sections),
      text(output.conclusion),
    ].filter(Boolean).join("\n\n");
  }
  if (type === "tweet_thread") {
    const tweets = strings(output.tweets);
    return tweets.map((tweet, index) => `${index + 1}/${tweets.length || "?"} ${tweet}`).join("\n\n");
  }
  if (type === "x_post") {
    return text(output.post);
  }
  if (type === "ad_campaign") {
    return [
      text(output.headline) && `Headline: ${text(output.headline)}`,
      text(output.primary_text) && `Primary text:\n${text(output.primary_text)}`,
      text(output.description) && `Description: ${text(output.description)}`,
      text(output.call_to_action) && `CTA: ${text(output.call_to_action)}`,
    ].filter(Boolean).join("\n\n");
  }

  return [
    text(output.hook),
    text(output.body),
    text(output.call_to_action),
    strings(output.hashtags).join(" "),
  ].filter(Boolean).join("\n\n");
}

/**
 * Resonance's prompt contract accepts at most 5,000 characters and the model
 * itself has a bounded context window. Long-form content is represented by
 * its opening—the title, hook, and introduction that actually determine
 * scroll-stop/click behavior—while short formats pass through unchanged.
 */
export function contentForResonance(content: string, maxLength = 5_000): string {
  const normalized = content.trim();
  if (normalized.length <= maxLength) return normalized;
  const slice = normalized.slice(0, maxLength - 1);
  const lastBoundary = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
  const safeEnd = lastBoundary >= Math.floor(maxLength * 0.65) ? lastBoundary + 1 : slice.length;
  return `${slice.slice(0, safeEnd).trimEnd()}…`;
}

/**
 * Builds the exact artifact the audience judges.
 *
 * YouTube and blog decisions begin with a public title, so scoring only the
 * body would test a different artifact from the one a viewer encounters.
 * Feed formats keep their internal draft title out of the prompt because it
 * is not published with the post.
 */
export function contentArtifactForResonance(input: {
  type: ContentType;
  title: string;
  content: string;
}): string {
  if (input.type === "video_script") {
    return contentForResonance(
      `YouTube video title: ${input.title}\n\nVideo script:\n${input.content}`,
    );
  }
  if (input.type === "blog_post") {
    return contentForResonance(
      `Article title: ${input.title}\n\nArticle:\n${input.content}`,
    );
  }
  return contentForResonance(input.content);
}
