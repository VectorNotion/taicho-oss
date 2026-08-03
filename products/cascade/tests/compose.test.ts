import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createContact } from "../data/contact-repository";
import { createContent, createEmail, createTemplate } from "../data/email-repository";
import {
  composeSend,
  publicUrl,
  sanitizePreviewHtml,
} from "../engine/compose";
import { verifyToken } from "../engine/tokens";

const MJML = `
<mjml><mj-body>
  <mj-section><mj-column>
    <mj-text>{{{slots.hero}}}</mj-text>
    <mj-text><a href="https://example.com/article">Read</a> <a href="https://example.com/book-call">Book a call</a></mj-text>
    <mj-text><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></mj-text>
  </mj-column></mj-section>
</mj-body></mjml>`;

async function seedEmail(pool: any) {
  const template = await createTemplate(pool, { name: "t1", mjml: MJML });
  const content = await createContent(pool, {
    name: "c1",
    subject: "Hello {{contact.attributes.firstName}}",
    preheader: "pre",
    slots: { hero: "Watch {{assets.vid1.title}} at {{assets.vid1.url}}" },
  });
  return createEmail(pool, {
    name: "e1",
    templateId: template.id,
    contentId: content.id,
    fromEmail: "cascade@mail.example.com",
    fromName: "Cascade",
    interestUrl: "https://example.com/book-call",
  });
}

test("composes an MJML email with slots, merge, tracking, and unsub", async () => {
  const pool = await freshSchema();
  await pool.query(
    `INSERT INTO assets (source_id, type, title, url) VALUES ('vid1', 'video', 'The Video', 'https://example.com/v/1')`,
  );
  const email = await seedEmail(pool);
  const contact = await createContact(pool, { email: "lead@example.com" });
  await pool.query(`UPDATE contacts SET attributes = '{"firstName":"Sam"}' WHERE id = $1`, [contact.id]);
  contact.attributes = { firstName: "Sam" };

  const composed = await composeSend(pool, { sendId: "send-1", emailId: email.id, contact });

  assert.equal(composed.subject, "Hello Sam");
  assert.ok(composed.html.includes("Watch The Video at https://example.com/v/1"));
  assert.ok(composed.html.includes(`${publicUrl()}/c/`), "links rewritten");
  assert.ok(composed.html.includes(`${publicUrl()}/o/`), "open pixel present");
  assert.ok(composed.headers["List-Unsubscribe"].includes(`${publicUrl()}/u/`));
  assert.equal(composed.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(composed.from, "Cascade <cascade@mail.example.com>");
  assert.ok(composed.text.includes("Watch The Video"));
  assert.ok(!composed.html.includes(`href="https://example.com/article"`), "original links replaced");
});

test("interest link carries the interest flag, others do not", async () => {
  const pool = await freshSchema();
  const email = await seedEmail(pool);
  const contact = await createContact(pool, { email: "lead2@example.com" });

  const composed = await composeSend(pool, { sendId: "send-2", emailId: email.id, contact });

  const tokens = [...composed.html.matchAll(/\/c\/([A-Za-z0-9_.-]+)"/g)].map((m) => verifyToken(m[1]));
  const interest = tokens.filter((t) => t && t.i === 1);
  const plain = tokens.filter((t) => t && t.i === undefined);
  assert.equal(interest.length, 1);
  assert.equal((interest[0] as any).u, "https://example.com/book-call");
  assert.ok(plain.length >= 1);
});

test("updating a template clears the compile cache", async () => {
  const pool = await freshSchema();
  const email = await seedEmail(pool);
  const contact = await createContact(pool, { email: "cache@example.com" });

  await composeSend(pool, { sendId: "send-c1", emailId: email.id, contact }); // fills the cache
  const { updateTemplate } = await import("../data/email-repository");
  await updateTemplate(pool, email.templateId, {
    mjml: `<mjml><mj-body><mj-section><mj-column><mj-text>REVISED LAYOUT {{{slots.hero}}}</mj-text><mj-text><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>`,
  });
  const recomposed = await composeSend(pool, { sendId: "send-c2", emailId: email.id, contact });
  assert.ok(recomposed.html.includes("REVISED LAYOUT"), "new layout renders after update");
});

test("inline emails render body with unsubscribe", async () => {
  const pool = await freshSchema();
  const contact = await createContact(pool, { email: "lead3@example.com" });
  const composed = await composeSend(pool, {
    sendId: "send-3",
    inline: { subject: "Plain", body: "Just text" },
    contact,
  });
  assert.equal(composed.subject, "Plain");
  assert.ok(composed.html.includes("Just text"));
  assert.ok(composed.html.includes(`${publicUrl()}/u/`));
  assert.ok(composed.html.includes(`${publicUrl()}/o/`));
});

test("preview HTML cannot execute code or load remote resources", () => {
  const preview = sanitizePreviewHtml(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Ubuntu">
    <style>@import url("https://fonts.example.test/a.css"); .hero { background: url(https://images.example.test/a.png); }</style>
    <script>throw new Error("must not run")</script>
    </head><body onload="steal()">
      <img src="https://tracker.example.test/open.gif" onerror="steal()"><script src="/relative.js"></script>
      <div style="color: red; background: url(https://styles.example.test/a.png)">safe text</div>
      <noscript><xml><o:OfficeDocumentSettings /></xml></noscript>
      <a href="javascript:steal()">unsafe</a>
      <form action="https://attacker.example.test"><input name="secret"></form>
      <iframe src="https://attacker.example.test"></iframe>
    </body></html>`);

  assert.match(preview, /Content-Security-Policy/);
  assert.doesNotMatch(preview, /<script/i);
  assert.doesNotMatch(preview, /<noscript/i);
  assert.doesNotMatch(preview, /<link/i);
  assert.doesNotMatch(preview, /<form/i);
  assert.doesNotMatch(preview, /<iframe/i);
  assert.doesNotMatch(preview, /\son[a-z]+=/i);
  assert.doesNotMatch(preview, /javascript:/i);
  assert.doesNotMatch(preview, /https:\/\/fonts/i);
  assert.doesNotMatch(preview, /https:\/\/images/i);
  assert.doesNotMatch(preview, /https:\/\/styles/i);
  assert.doesNotMatch(preview, /https:\/\/tracker/i);
});
