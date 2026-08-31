import assert from "node:assert/strict";
import test from "node:test";
import { createContact, listContacts } from "../data/contact-repository";
import { importWorkspaceContact } from "../data/intake";
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
  assert.equal((await getFunnel(pool, funnel.id))?.stepCount, 0);
  assert.equal((await listFunnels(pool, { workspaceContactId: "unlinked-contact" }))[0]?.currentMembership, null);

  const renamed = await renameFunnel(pool, funnel.id, "Active customers");
  assert.equal(renamed.name, "Active customers");
  assert.equal(renamed.version, funnel.version + 1);
  assert.deepEqual((await listFunnels(pool)).map((item) => item.name), ["Active customers"]);

  await removeFunnelMember(pool, funnel.id, contact.id);
  assert.equal((await getFunnel(pool, funnel.id))?.memberCount, 0);
});

test("funnel lists identify only memberships for the requested workspace contact", async () => {
  const pool = await freshSchema();
  const joined = await createFunnel(pool, { name: "Joined" });
  await createFunnel(pool, { name: "Eligible" });
  const contact = await importWorkspaceContact(pool, {
    email: "linked@example.test",
    workspaceContactId: "11111111-1111-4111-8111-111111111111",
  });
  const other = await importWorkspaceContact(pool, {
    email: "other@example.test",
    workspaceContactId: "22222222-2222-4222-8222-222222222222",
  });
  const membership = await addFunnelMember(pool, { funnelId: joined.id, contactId: contact.id });
  await addFunnelMember(pool, { funnelId: joined.id, contactId: other.id });

  const funnels = await listFunnels(pool, { workspaceContactId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(funnels.find((funnel) => funnel.id === joined.id)?.currentMembership?.id, membership.id);
  assert.equal(funnels.find((funnel) => funnel.name === "Eligible")?.currentMembership, null);
});

test("workspace re-imports refresh details without overwriting the first relationship source", async () => {
  const pool = await freshSchema();
  await importWorkspaceContact(pool, {
    email: "source@example.test",
    workspaceContactId: "11111111-1111-4111-8111-111111111111",
    attributes: { name: "Original", source: "outreach" },
  });
  await importWorkspaceContact(pool, {
    email: "source@example.test",
    workspaceContactId: "11111111-1111-4111-8111-111111111111",
    attributes: { name: "Refreshed", source: "manual" },
  });
  const [contact] = await listContacts(pool);
  assert.equal(contact?.attributes.name, "Refreshed");
  assert.equal(contact?.attributes.source, "outreach");
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
