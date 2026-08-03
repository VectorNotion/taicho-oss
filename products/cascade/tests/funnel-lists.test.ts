import assert from "node:assert/strict";
import test from "node:test";
import { createContact } from "../data/contact-repository";
import {
  addFunnelMember,
  createFunnel,
  deleteFunnel,
  getFunnel,
  listFunnelMembers,
  listFunnels,
  removeFunnelMember,
  renameFunnel,
} from "../data/funnel-repository";
import {
  createPlainTextEmail,
  deletePlainTextEmail,
  getPlainTextEmail,
  listPlainTextEmails,
  updatePlainTextEmail,
} from "../data/plain-text-email-repository";
import { freshSchema } from "./helpers";
import { closeCascadePools } from "../data/pool";

test.after(async () => closeCascadePools());

test("funnels are simple named lists with idempotent people membership", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "Customers" });
  const contact = await createContact(pool, { email: "person@example.test" });

  const first = await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  const replay = await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  assert.equal(replay.id, first.id);
  assert.deepEqual((await listFunnelMembers(pool, funnel.id)).map((member) => member.email), [
    "person@example.test",
  ]);
  assert.equal((await getFunnel(pool, funnel.id))?.memberCount, 1);

  const renamed = await renameFunnel(pool, funnel.id, "Active customers");
  assert.equal(renamed.name, "Active customers");
  assert.deepEqual((await listFunnels(pool)).map((item) => item.name), ["Active customers"]);

  await removeFunnelMember(pool, funnel.id, contact.id);
  assert.equal((await getFunnel(pool, funnel.id))?.memberCount, 0);
});

test("funnels own named literal plain-text emails with CRUD and no rendering", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "Prospects" });
  const created = await createPlainTextEmail(pool, {
    funnelId: funnel.id,
    name: "Welcome",
    subject: "Hello {{name}}",
    body: "This stays literal: {{name}} and <strong>text</strong>.",
  });

  assert.equal(
    created.content,
    "Subject: Hello {{name}}\n\nThis stays literal: {{name}} and <strong>text</strong>.\n",
  );
  assert.equal((await getFunnel(pool, funnel.id))?.emailCount, 1);
  assert.deepEqual((await listPlainTextEmails(pool, funnel.id)).map((email) => email.name), ["Welcome"]);

  const updated = await updatePlainTextEmail(pool, {
    funnelId: funnel.id,
    id: created.id,
    name: "First note",
    subject: "A plain subject",
    body: "A plain body",
  });
  assert.equal(updated.content, "Subject: A plain subject\n\nA plain body\n");

  await deletePlainTextEmail(pool, funnel.id, created.id);
  assert.equal(await getPlainTextEmail(pool, created.id), null);
  await deleteFunnel(pool, funnel.id);
  assert.equal(await getFunnel(pool, funnel.id), null);
});

test("deleting a funnel cascades memberships and owned emails", async () => {
  const pool = await freshSchema();
  const funnel = await createFunnel(pool, { name: "Disposable" });
  const contact = await createContact(pool, { email: "keep-contact@example.test" });
  await addFunnelMember(pool, { funnelId: funnel.id, contactId: contact.id });
  await createPlainTextEmail(pool, {
    funnelId: funnel.id,
    name: "Note",
    subject: "Subject",
    body: "Body",
  });

  await deleteFunnel(pool, funnel.id);
  assert.equal((await listFunnelMembers(pool, funnel.id)).length, 0);
  assert.equal((await listPlainTextEmails(pool, funnel.id)).length, 0);
});
