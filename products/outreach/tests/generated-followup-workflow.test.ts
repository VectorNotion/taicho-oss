import assert from "node:assert/strict";
import test from "node:test";
import { saveGeneratedOutreach, type SaveGeneratedOutreachDeps } from "../agent/generator";
import { generatedFollowUpPayload } from "../domain/action-items";
import type { ActionItem } from "../domain/action-items";
import type { OutreachMessage } from "../domain/types";

const message: OutreachMessage = {
  id: "m1",
  prospectId: "p1",
  medium: "email",
  subject: "Hello",
  content: "Draft",
  status: "draft",
  generationId: "g1",
  generationType: "initial",
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

const action: ActionItem = {
  id: "a1",
  title: "Follow up with Ada",
  status: "open",
  dueAt: "2026-08-18T00:00:00.000Z",
  source: "auto_followup",
  prospectId: "p1",
  accountId: null,
  payload: generatedFollowUpPayload({
    messageId: "m1",
    medium: "email",
    generationType: "initial",
  }),
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
  completedAt: null,
};

function dependencies(input: {
  created: boolean;
  failFollowUp?: boolean;
  events: unknown[];
  deletedMessages: string[];
}): SaveGeneratedOutreachDeps {
  return {
    createMessage: async () => ({ message, created: input.created }),
    ensureFollowUp: async () => {
      if (input.failFollowUp) throw new Error("follow-up failed");
      return action;
    },
    recordEvent: async (event) => {
      input.events.push(event);
      return { id: "event-1", created: true };
    },
    deleteMessage: async (id) => {
      input.deletedMessages.push(id);
      return true;
    },
    deleteAction: async () => true,
    attemptId: () => "attempt-1",
  };
}

test("saving a generated draft waits for and returns its next automatic follow-up", async () => {
  const events: unknown[] = [];
  const deletedMessages: string[] = [];
  const saved = await saveGeneratedOutreach(
    { prospectId: "p1", medium: "email", generationId: "g1", generationType: "initial" },
    { subject: "Hello", content: "Draft" },
    "Ada",
    dependencies({ created: true, events, deletedMessages }),
  );
  assert.equal(saved.id, "m1");
  assert.equal(saved.nextAction?.id, "a1");
  assert.equal(saved.nextAction?.payload?.triggerMessageId, "m1");
  assert.equal(events.length, 1);
  assert.deepEqual(deletedMessages, []);
});

test("retrying the same generation reuses the draft and does not emit a duplicate event", async () => {
  const events: unknown[] = [];
  const saved = await saveGeneratedOutreach(
    { prospectId: "p1", medium: "email", generationId: "g1", generationType: "initial" },
    { subject: "Hello", content: "Draft" },
    "Ada",
    dependencies({ created: false, events, deletedMessages: [] }),
  );
  assert.equal(saved.nextAction?.id, "a1");
  assert.equal(events.length, 0);
});

test("a new draft is compensated when its required follow-up cannot be saved", async () => {
  const deletedMessages: string[] = [];
  await assert.rejects(
    saveGeneratedOutreach(
      { prospectId: "p1", medium: "email", generationId: "g1", generationType: "initial" },
      { subject: "Hello", content: "Draft" },
      "Ada",
      dependencies({ created: true, failFollowUp: true, events: [], deletedMessages }),
    ),
    /follow-up failed/,
  );
  assert.deepEqual(deletedMessages, ["m1"]);
});
