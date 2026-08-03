import { getCascadePool } from "../data/pool";
import { ensureCascadeSchema } from "../data/schema";
import { createFunnel, setFunnelRoute } from "../data/funnel-repository";
import { enrollContact } from "../data/enrollment-repository";
import { createContent, createEmail, createTemplate } from "../data/email-repository";
import { StaticContentSource, syncAssets } from "../data/asset-repository";
import { importOutreachLead } from "../data/intake";

const pool = getCascadePool();
await ensureCascadeSchema(pool);

const [existing] = await databaseFor(pool)
  .select({ id: funnelsInCascade.id })
  .from(funnelsInCascade)
  .where(eq(funnelsInCascade.name, "Demo onboarding"))
  .limit(1);
if (existing) {
  console.log(`Demo nurture data already exists (onboarding=${existing.id}); nothing to seed.`);
  await pool.end();
  process.exit(0);
}

await syncAssets(
  pool,
  new StaticContentSource([
    {
      sourceId: "demo-video",
      type: "video",
      title: "This week's video",
      url: "https://content.example/v/latest",
      topics: ["demo"],
    },
  ]),
);

const template = await createTemplate(pool, {
  name: "Demo base template",
  mjml: `
<mjml><mj-body><mj-section><mj-column>
  <mj-text font-size="18px">{{{slots.hero}}}</mj-text>
  <mj-text>{{{slots.body}}}</mj-text>
  <mj-text><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></mj-text>
</mj-column></mj-section></mj-body></mjml>`,
});
const content = await createContent(pool, {
  name: "Demo welcome content",
  subject: "Welcome, {{contact.attributes.company}}",
  slots: {
    hero: "Watch {{assets.[demo-video].title}}",
    body: `<a href="https://content.example/v/latest">Watch the video</a> or <a href="https://cascade.example/book-call">book a call</a>.`,
  },
});
const email = await createEmail(pool, {
  name: "Demo welcome message",
  templateId: template.id,
  contentId: content.id,
  fromEmail: "hello@mail.example.com",
  fromName: "Cascade Demo",
  interestUrl: "https://cascade.example/book-call",
});

const { funnel: onboarding } = await createFunnel(pool, {
  name: "Demo onboarding",
  steps: [
    { type: "email", config: { emailId: email.id } },
    { type: "delay", config: { seconds: 60 } },
    { type: "email", config: { subject: "One minute later", body: "Following up." } },
    { type: "goal", config: {} },
  ],
});
const { funnel: discovery } = await createFunnel(pool, {
  name: "Demo discovery",
  steps: [{ type: "email", config: { subject: "Discovery next steps", body: "Let's talk." } }],
});
const { funnel: newsletter } = await createFunnel(pool, {
  name: "Demo newsletter",
  steps: [],
  openEnded: true,
});
await setFunnelRoute(pool, onboarding.id, "interest", discovery.id);
await setFunnelRoute(pool, onboarding.id, "completed", newsletter.id);

const lead = await importOutreachLead(pool, {
  email: "demo@example.com",
  outreachLeadId: "demo-lead",
  attributes: { company: "DemoCorp" },
});
const enrollment = await enrollContact(pool, onboarding.id, lead.id);

console.log(`Seeded onboarding=${onboarding.id}`);
console.log(`  discovery=${discovery.id} (interest route)`);
console.log(`  newsletter=${newsletter.id} (completed route, open-ended)`);
console.log(`  contact=${lead.email} enrollment=${enrollment.id}`);
console.log(`Run 'pnpm cascade:worker': welcome sends now, follow-up after 60s, then the`);
console.log(`goal routes the contact into the newsletter queue. Click the /c/ interest`);
console.log(`link printed in the welcome html (via curl) to route into discovery instead.`);
await pool.end();
import { databaseFor, funnelsInCascade } from "@content-automation/database";
import { eq } from "drizzle-orm";
