import assert from "node:assert/strict";
import test from "node:test";
import { deriveProspectPipelineState } from "../domain/prospect-lifecycle";
import type { ActionItem } from "../domain/action-items";

const prospect = { status: "new" as const, lastContactedAt: undefined };
const noEvidence = { hasResearch: false, hasDraft: false, hasSentMessage: false };

test("a new prospect with no evidence is untouched", () => {
  assert.deepEqual(deriveProspectPipelineState(prospect, noEvidence), {
    lifecycle: "untouched",
    hasResearch: false,
    hasDraft: false,
    hasContact: false,
    nextAction: undefined,
  });
});

test("research and drafts advance an untouched prospect", () => {
  assert.equal(
    deriveProspectPipelineState(prospect, { ...noEvidence, hasResearch: true }).lifecycle,
    "researched",
  );
  assert.equal(
    deriveProspectPipelineState(prospect, { ...noEvidence, hasResearch: true, hasDraft: true }).lifecycle,
    "draft_ready",
  );
});

test("an open action is visible before contact and retained after contact", () => {
  const nextAction = { id: "action-1" } as ActionItem;
  const beforeContact = deriveProspectPipelineState(prospect, { ...noEvidence, nextAction });
  assert.equal(beforeContact.lifecycle, "follow_up_scheduled");
  assert.equal(beforeContact.nextAction, nextAction);

  const afterContact = deriveProspectPipelineState(
    { status: "contacted", lastContactedAt: "2026-08-16T10:00:00.000Z" },
    { ...noEvidence, hasSentMessage: true, nextAction },
  );
  assert.equal(afterContact.lifecycle, "contacted");
  assert.equal(afterContact.hasContact, true);
  assert.equal(afterContact.nextAction, nextAction);
});

test("a reply is the terminal visible lifecycle even with a follow-up", () => {
  const state = deriveProspectPipelineState(
    { status: "replied", lastContactedAt: "2026-08-16T10:00:00.000Z" },
    { ...noEvidence, hasSentMessage: true, nextAction: { id: "action-1" } as ActionItem },
  );
  assert.equal(state.lifecycle, "replied");
});
