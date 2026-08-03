import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "../components/ui/rich-text-editor";

const MARKDOWN = `# Launch post

Most creators publish, wait a week, and **guess** why a post worked.

- a thousand audience reads for $0.008
- *paired design* — differences come from the creative
- results in [minutes](https://example.com)`;

describe("markdown boundary for RichTextEditor", () => {
  it("parses markdown into the editor's HTML node set", () => {
    const html = markdownToHtml(MARKDOWN);
    expect(html).toContain("<h1>Launch post</h1>");
    expect(html).toContain("<strong>guess</strong>");
    expect(html).toContain("<em>paired design</em>");
    expect(html).toContain('<a href="https://example.com">minutes</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
  });

  it("serializes editor HTML back to markdown", () => {
    const markdown = htmlToMarkdown(
      "<h1>Launch post</h1><p>We <strong>score</strong> every <em>hook</em>.</p><ul><li>one</li><li><a href=\"https://example.com\">two</a></li></ul>",
    );
    expect(markdown).toContain("# Launch post");
    expect(markdown).toContain("**score**");
    expect(markdown).toContain("*hook*");
    expect(markdown).toContain("- one");
    expect(markdown).toContain("[two](https://example.com)");
  });

  it("round-trips the editor's node set stably", () => {
    const once = htmlToMarkdown(markdownToHtml(MARKDOWN));
    const twice = htmlToMarkdown(markdownToHtml(once));
    expect(twice).toBe(once);
    expect(once).toContain("# Launch post");
    expect(once).toContain("**guess**");
    expect(once).toContain("[minutes](https://example.com)");
  });
});
