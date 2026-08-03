import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { appendFunnelStep, createFunnel, setFunnelRoute } from "../data/funnel-repository";
import { enrollContact } from "../data/enrollment-repository";
import { createContent, createEmail, createTemplate } from "../data/email-repository";
import { StaticContentSource, syncAssets } from "../data/asset-repository";
import { importOutreachLead } from "../data/intake";
import { runDailyRollup } from "../data/rollups";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { recordClick } from "../engine/ingest";
import { verifyToken } from "../engine/tokens";

const MJML = `
<mjml><mj-body><mj-section><mj-column>
  <mj-text>{{{slots.body}}}</mj-text>
  <mj-text><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></mj-text>
</mj-column></mj-section></mj-body></mjml>`;

/**
 * The Phase 3 exit criterion, end to end in-process:
 * a lead from outreach enters onboarding; an interest click routes them to
 * discovery; a lead who completes onboarding without interest lands in the
 * newsletter queue; an appended newsletter step sends to waiting enrollments.
 */
test("full lifecycle: intake -> onboarding -> interest/newsletter -> appended issue", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();

  // Content engine assets feed the emails.
  await syncAssets(
    pool,
    new StaticContentSource([
      { sourceId: "vid-week", type: "video", title: "The weekly video", url: "https://content.example/v/1", topics: [] },
    ]),
  );

  // Onboarding email A with an interest CTA, built from template+content.
  const template = await createTemplate(pool, { name: "base", mjml: MJML });
  const contentA = await createContent(pool, {
    name: "onboarding-1",
    subject: "Welcome, {{contact.attributes.company}}",
    slots: { body: `Watch {{assets.[vid-week].title}}: <a href="{{assets.[vid-week].url}}">watch</a> or <a href="https://cascade.example/call">book a call</a>` },
  });
  const emailA = await createEmail(pool, {
    name: "onboarding-email-1",
    templateId: template.id,
    contentId: contentA.id,
    fromEmail: "hello@mail.example.com",
    interestUrl: "https://cascade.example/call",
  });

  // Funnels: onboarding chains to newsletter on completion, discovery on interest.
  const { funnel: onboarding } = await createFunnel(pool, {
    name: "onboarding",
    steps: [
      { type: "email", config: { emailId: emailA.id } },
      { type: "delay", config: { seconds: 0 } },
      { type: "goal", config: {} },
    ],
  });
  const { funnel: discovery } = await createFunnel(pool, {
    name: "discovery",
    steps: [{ type: "email", config: { subject: "Discovery next steps", body: "b" } }],
  });
  const { funnel: newsletter } = await createFunnel(pool, { name: "newsletter-queue", steps: [], openEnded: true });
  await setFunnelRoute(pool, onboarding.id, "interest", discovery.id);
  await setFunnelRoute(pool, onboarding.id, "completed", newsletter.id);

  // Two leads arrive from outreach.
  const hot = await importOutreachLead(pool, {
    email: "hot@corp.com",
    outreachLeadId: "lead-hot",
    attributes: { company: "HotCorp" },
  });
  const cool = await importOutreachLead(pool, {
    email: "cool@corp.com",
    outreachLeadId: "lead-cool",
    attributes: { company: "CoolCorp" },
  });
  const hotEnrollment = await enrollContact(pool, onboarding.id, hot.id);
  await enrollContact(pool, onboarding.id, cool.id);

  // Tick drains onboarding for both: email queued, goal completes, completed-route
  // parks both at the newsletter frontier. Send loop delivers email A.
  await runTick(pool);
  const flush = await runSendLoop(pool, mailer);
  assert.equal(flush.sent, 2);
  const welcome = mailer.sent.find((m) => m.to === "hot@corp.com")!;
  assert.equal(welcome.subject, "Welcome, HotCorp");
  assert.ok(welcome.html.includes("The weekly video"), "asset merged into the email");

  // Hot lead clicks the interest CTA (extract the real signed link from the html).
  const tokens = [...welcome.html.matchAll(/\/c\/([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]);
  const interestToken = tokens.find((t) => (verifyToken(t) as any)?.i === 1)!;
  const payload = verifyToken(interestToken) as { s: string; u: string };
  const routed = await recordClick(pool, payload.s, payload.u, true);
  assert.equal(routed.routed, true);

  // Hot: routed to discovery; the onboarding run is already completed, and the
  // newsletter membership is untouched (interest stops only the enrollment
  // that sent the email). Cool: waiting at the queue frontier.
  const state = await pool.query(
    `SELECT c.email, f.name, e.state FROM enrollments e
     JOIN contacts c ON c.id = e.contact_id JOIN funnels f ON f.id = e.funnel_id
     ORDER BY c.email, e.created_at`,
  );
  const rows = state.rows.map((r) => `${r.email}:${r.name}:${r.state}`);
  assert.ok(rows.includes("cool@corp.com:newsletter-queue:active"), "cool waits in the queue");
  assert.ok(rows.includes("hot@corp.com:discovery:active"), "hot routed to discovery");
  assert.ok(rows.includes("hot@corp.com:onboarding:completed"), "hot's onboarding run finished");
  assert.ok(rows.includes("hot@corp.com:newsletter-queue:active"), "queue membership survives interest");

  // Discovery email goes out.
  await runTick(pool);
  await runSendLoop(pool, mailer);
  assert.ok(mailer.sent.some((m) => m.to === "hot@corp.com" && m.subject === "Discovery next steps"));

  // A new newsletter issue is appended; the waiting enrollment wakes and receives it.
  await appendFunnelStep(pool, newsletter.id, {
    type: "email",
    config: { subject: "Issue #1", body: `New: <a href="https://content.example/v/1">watch</a>` },
  });
  await runTick(pool);
  await runSendLoop(pool, mailer);
  const issueRecipients = mailer.sent.filter((m) => m.subject === "Issue #1").map((m) => m.to).sort();
  assert.deepEqual(issueRecipients, ["cool@corp.com", "hot@corp.com"], "queue members get the issue");

  // The interest event trail exists and rolls up.
  const events = await pool.query(
    `SELECT type, count(*)::int AS n FROM events GROUP BY type ORDER BY type`,
  );
  const byType = Object.fromEntries(events.rows.map((r) => [r.type, r.n]));
  assert.equal(byType.sent, 5); // 2 onboarding + 1 discovery + 2 issues
  assert.equal(byType.click, 1);
  assert.equal(byType.interest, 1);

  const today = new Date().toISOString().slice(0, 10);
  await runDailyRollup(pool, today);
  const stats = await pool.query(`SELECT count(*)::int AS n FROM stage_daily_stats`);
  assert.ok(stats.rows[0].n >= 2, "rollup rows for multiple steps");

  assert.equal(hotEnrollment.funnelId, onboarding.id); // sanity: ids wired as expected
});
