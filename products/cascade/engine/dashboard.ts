import {
  cascade_settingsInCascade as cascadeSettingsInCascade,
  contactsInCascade,
  databaseFor,
  enrollmentsInCascade,
  eventsInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  funnelsInCascade,
  sendsInCascade,
  variant_statsInCascade as variantStatsInCascade,
  variantsInCascade,
} from "@content-automation/database";
import { count, desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="empty">nothing yet</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n")}</tbody></table>`;
}

/**
 * Minimal operator dashboard, server-rendered by the engine's HTTP surface.
 * Read-only view for development and operations; the full product UI belongs
 * in apps/unified.
 */
export async function renderDashboard(pool: Pool): Promise<string> {
  const db = databaseFor(pool);
  const [funnels, variants, sends, events, contacts, autonomy] = await Promise.all([
    db
      .select({
        name: funnelsInCascade.name,
        openEnded: funnelsInCascade.open_ended,
        active: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'active')::int`,
        completed: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'completed')::int`,
        stopped: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'stopped')::int`,
        atFrontier: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'active' and ${enrollmentsInCascade.current_step_id} is null)::int`,
      })
      .from(funnelsInCascade)
      .leftJoin(enrollmentsInCascade, eq(enrollmentsInCascade.funnel_id, funnelsInCascade.id))
      .groupBy(funnelsInCascade.id)
      .orderBy(desc(funnelsInCascade.created_at))
      .limit(20),
    db
      .select({
        funnel: funnelsInCascade.name,
        position: funnelStepsInCascade.position,
        status: variantsInCascade.status,
        generation: variantsInCascade.generation,
        createdBy: variantsInCascade.created_by,
        sends: variantStatsInCascade.sends,
        opens: variantStatsInCascade.opens,
        clicks: variantStatsInCascade.clicks,
        interests: variantStatsInCascade.interests,
        validationError: variantsInCascade.validation_error,
      })
      .from(variantsInCascade)
      .innerJoin(variantStatsInCascade, eq(variantStatsInCascade.variant_id, variantsInCascade.id))
      .innerJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, variantsInCascade.step_id))
      .innerJoin(funnelsInCascade, eq(funnelsInCascade.id, funnelStepsInCascade.funnel_id))
      .orderBy(desc(variantsInCascade.created_at))
      .limit(25),
    db
      .select({
        at: sql<string>`to_char(${sendsInCascade.created_at}, 'HH24:MI:SS')`,
        status: sendsInCascade.status,
        email: contactsInCascade.email,
        funnel: funnelsInCascade.name,
      })
      .from(sendsInCascade)
      .innerJoin(enrollmentsInCascade, eq(enrollmentsInCascade.id, sendsInCascade.enrollment_id))
      .innerJoin(contactsInCascade, eq(contactsInCascade.id, enrollmentsInCascade.contact_id))
      .innerJoin(funnelsInCascade, eq(funnelsInCascade.id, enrollmentsInCascade.funnel_id))
      .orderBy(desc(sendsInCascade.created_at))
      .limit(15),
    db
      .select({ type: eventsInCascade.type, n: count() })
      .from(eventsInCascade)
      .groupBy(eventsInCascade.type)
      .orderBy(desc(count())),
    db
      .select({
        total: count(),
        subscribed: sql<number>`count(*) filter (where ${contactsInCascade.subscription_status} = 'subscribed')::int`,
      })
      .from(contactsInCascade),
    db
      .select({ value: cascadeSettingsInCascade.value })
      .from(cascadeSettingsInCascade)
      .where(eq(cascadeSettingsInCascade.key, "autonomy"))
      .limit(1),
  ]);

  const c = contacts[0] ?? { total: 0, subscribed: 0 };
  const dial = autonomy[0] ? String(autonomy[0].value).replace(/"/g, "") : "approve_all";

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>Cascade</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1a1a2e;background:#fafaf8}
  h1{font-size:1.5rem} h1 small{font-weight:400;color:#888;font-size:.9rem}
  h2{font-size:1.05rem;margin:1.8rem 0 .5rem;border-bottom:2px solid #e8e4da;padding-bottom:.3rem}
  table{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff}
  th{text-align:left;background:#f0ede6;padding:.4rem .6rem;font-weight:600}
  td{padding:.35rem .6rem;border-top:1px solid #eee}
  .pill{display:inline-block;padding:.05rem .5rem;border-radius:9px;font-size:.78rem}
  .active{background:#dcefdc}.completed{background:#dde6f5}.stopped,.retired{background:#f5dddd}
  .draft{background:#eee}.validated{background:#fdf3d7}.sent{background:#dcefdc}
  .queued{background:#fdf3d7}.failed{background:#f5dddd}.skipped{background:#eee}
  .empty{color:#999;font-style:italic;font-size:.85rem}
  .stats{display:flex;gap:2rem;margin:.8rem 0}.stats div{background:#fff;border:1px solid #e8e4da;border-radius:8px;padding:.6rem 1.2rem}
  .stats b{font-size:1.3rem;display:block}
</style></head><body>
<h1>Cascade <small>funnel engine &middot; autonomy: <b>${esc(dial)}</b> &middot; auto-refreshes every 5s</small></h1>
<div class="stats">
  <div><b>${c.total}</b>contacts</div>
  <div><b>${c.subscribed}</b>subscribed</div>
  <div><b>${events.reduce((n, r) => n + r.n, 0)}</b>events</div>
</div>
<h2>Funnels</h2>
${table(
  ["funnel", "type", "active", "at frontier", "completed", "stopped"],
  funnels.map((f) => [
    esc(f.name),
    f.openEnded ? "open-ended queue" : "sequence",
    String(f.active),
    String(f.atFrontier),
    String(f.completed),
    String(f.stopped),
  ]),
)}
<h2>Variants (bandit arms)</h2>
${table(
  ["funnel", "step", "status", "gen", "by", "sends", "opens", "clicks", "interests", "rate"],
  variants.map((v) => [
    esc(v.funnel),
    String(v.position),
    `<span class="pill ${esc(v.status)}">${esc(v.status)}</span>${v.validationError ? ` <small title="${esc(v.validationError)}">⚠</small>` : ""}`,
    String(v.generation),
    esc(v.createdBy),
    String(v.sends),
    String(v.opens),
    String(v.clicks),
    String(v.interests),
    v.sends > 0 ? `${((v.interests / v.sends) * 100).toFixed(1)}%` : "—",
  ]),
)}
<h2>Recent sends</h2>
${table(
  ["time", "status", "contact", "funnel"],
  sends.map((s) => [
    esc(s.at),
    `<span class="pill ${esc(s.status)}">${esc(s.status)}</span>`,
    esc(s.email),
    esc(s.funnel),
  ]),
)}
<h2>Events</h2>
${table(["type", "count"], events.map((e) => [esc(e.type), String(e.n)]))}
</body></html>`;
}
