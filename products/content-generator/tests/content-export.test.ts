import assert from "node:assert/strict";
import test from "node:test";
import { buildContentExport } from "../domain/content-export";

test("content export produces a portable Markdown document and safe filename", () => {
  const result = buildContentExport(
    {
      title: "  Café launch: A/B plan?  ",
      content: "  First paragraph.\n\nSecond paragraph.  ",
    },
    "markdown",
  );

  assert.deepEqual(result, {
    body: "# Café launch: A/B plan?\n\nFirst paragraph.\n\nSecond paragraph.\n",
    filename: "cafe-launch-a-b-plan.md",
    mimeType: "text/markdown;charset=utf-8",
  });
});

test("plain-text export preserves readable title and body separation", () => {
  const result = buildContentExport(
    { title: "Launch notes", content: "Ready to post." },
    "plain_text",
  );

  assert.equal(result.body, "Launch notes\n\nReady to post.\n");
  assert.equal(result.filename, "launch-notes.txt");
  assert.equal(result.mimeType, "text/plain;charset=utf-8");
});

test("content export falls back to a stable filename", () => {
  assert.equal(
    buildContentExport({ title: "🎉", content: "Launch" }, "markdown").filename,
    "content.md",
  );
});
