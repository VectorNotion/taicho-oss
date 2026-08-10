import {
  addFunnelMember,
  createFunnel,
  listFunnels,
} from "../data/funnel-repository";
import { createPlainTextEmail } from "../data/plain-text-email-repository";
import { importOutreachProspect } from "../data/intake";
import { getCascadePool } from "../data/pool";
import { ensureCascadeSchema } from "../data/schema";

const pool = getCascadePool();
await ensureCascadeSchema(pool);

const existing = (await listFunnels(pool)).find((item) => item.name === "Demo customers");
if (existing) {
  console.log(`Demo funnel already exists (${existing.id}); nothing to seed.`);
  await pool.end();
  process.exit(0);
}

const funnel = await createFunnel(pool, { name: "Demo customers" });
await createPlainTextEmail(pool, {
  funnelId: funnel.id,
  name: "Welcome note",
  subject: "Welcome to the demo",
  body: "Thanks for joining. This is manually managed plain text.",
});
await createPlainTextEmail(pool, {
  funnelId: funnel.id,
  name: "Follow-up note",
  subject: "Checking in",
  body: "A second reusable plain-text email for external automation.",
});

const contact = await importOutreachProspect(pool, {
  email: "demo@example.com",
  outreachProspectId: "demo-prospect",
  attributes: { name: "Demo Person", company: "DemoCorp" },
});
const member = await addFunnelMember(pool, {
  funnelId: funnel.id,
  contactId: contact.id,
});

console.log(`Seeded funnel=${funnel.id}`);
console.log(`  contact=${contact.email} member=${member.id}`);
console.log("  emails=Welcome note, Follow-up note");
await pool.end();
