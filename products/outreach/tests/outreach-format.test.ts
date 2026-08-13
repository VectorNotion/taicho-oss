import assert from "node:assert/strict";
import test from "node:test";
import { formatOutreachContent } from "../domain/outreach-format";

test("email drafts receive a first-name greeting and at most two sentences per paragraph", () => {
  const formatted = formatOutreachContent(
    "Pain creates delay. Teams lose trust. A guarded workflow fixes the issue. Approval stays visible. I can map the first workflow. Would Tuesday work?",
    "Laura Cross",
    "email",
  );

  assert.equal(formatted, [
    "Hi Laura,",
    "Pain creates delay. Teams lose trust.",
    "A guarded workflow fixes the issue. Approval stays visible.",
    "I can map the first workflow. Would Tuesday work?",
  ].join("\n\n"));
});

test("an existing greeting is normalized instead of duplicated", () => {
  const formatted = formatOutreachContent(
    "Hello Laura Cross,\n\nA short problem paragraph.\n\nA short next step.",
    "Laura Cross",
    "inmail",
  );

  assert.equal(formatted, "Hi Laura,\n\nA short problem paragraph.\n\nA short next step.");
});

test("content comments retain their social format without a greeting", () => {
  const content = "Strong point about approval gates. This makes adoption safer.";
  assert.equal(formatOutreachContent(content, "Laura Cross", "content_comment"), content);
});
