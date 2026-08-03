import {
  contactsInCascade,
  databaseFor,
  type Database,
  enrollmentsInCascade,
  eventsInCascade,
  sendsInCascade,
  variant_statsInCascade as variantStatsInCascade,
} from "@content-automation/database";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { routeOnInterest } from "./routing";

type Queryable = Pool | PoolClient | Database;

function ingestDatabase(source: Queryable): Database {
  return "$count" in source ? source : databaseFor(source);
}

interface SendContext {
  sendId: string;
  contactId: string;
  enrollmentId: string;
  funnelId: string;
}

async function sendContext(
  pool: Queryable,
  sendId: string,
): Promise<SendContext | null> {
  const [row] = await ingestDatabase(pool)
    .select({
      sendId: sendsInCascade.id,
      contactId: enrollmentsInCascade.contact_id,
      enrollmentId: enrollmentsInCascade.id,
      funnelId: enrollmentsInCascade.funnel_id,
    })
    .from(sendsInCascade)
    .innerJoin(enrollmentsInCascade, eq(enrollmentsInCascade.id, sendsInCascade.enrollment_id))
    .where(eq(sendsInCascade.id, sendId))
    .limit(1);
  return row ?? null;
}

async function sendContextByProviderId(
  pool: Queryable,
  providerMessageId: string,
  providerConnectionId?: string,
): Promise<SendContext | null> {
  const conditions = [eq(sendsInCascade.provider_message_id, providerMessageId)];
  if (providerConnectionId) conditions.push(eq(sendsInCascade.delivery_provider_id, providerConnectionId));
  const [row] = await ingestDatabase(pool)
    .select({
      sendId: sendsInCascade.id,
      contactId: enrollmentsInCascade.contact_id,
      enrollmentId: enrollmentsInCascade.id,
      funnelId: enrollmentsInCascade.funnel_id,
    })
    .from(sendsInCascade)
    .innerJoin(enrollmentsInCascade, eq(enrollmentsInCascade.id, sendsInCascade.enrollment_id))
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

const VARIANT_STAT_COLUMNS = {
  open: "opens",
  click: "clicks",
  interest: "interests",
  convert: "conversions",
} as const;

async function insertEvent(
  pool: Queryable,
  ctx: SendContext,
  type: string,
): Promise<void> {
  const db = ingestDatabase(pool);
  await db.insert(eventsInCascade).values({
    contact_id: ctx.contactId,
    enrollment_id: ctx.enrollmentId,
    send_id: ctx.sendId,
    type,
  });
  const column = VARIANT_STAT_COLUMNS[type as keyof typeof VARIANT_STAT_COLUMNS];
  if (column) {
    const [send] = await db
      .select({ variantId: sendsInCascade.variant_id })
      .from(sendsInCascade)
      .where(eq(sendsInCascade.id, ctx.sendId))
      .limit(1);
    if (send?.variantId) {
      const statColumn = variantStatsInCascade[column];
      await db
        .update(variantStatsInCascade)
        .set({ [column]: sql`${statColumn} + 1` })
        .where(eq(variantStatsInCascade.variant_id, send.variantId));
    }
  }
}

export async function recordOpen(pool: Pool, sendId: string): Promise<void> {
  const ctx = await sendContext(pool, sendId);
  if (!ctx) return;
  await insertEvent(pool, ctx, "open");
}

export async function recordClick(
  pool: Pool,
  sendId: string,
  url: string,
  interest: boolean,
): Promise<{ routed: boolean }> {
  const ctx = await sendContext(pool, sendId);
  if (!ctx) return { routed: false };
  await insertEvent(pool, ctx, "click");
  if (!interest) return { routed: false };
  await insertEvent(pool, ctx, "interest");
  return routeOnInterest(pool, sendId);
}

export async function suppressContact(
  pool: Queryable,
  contactId: string,
): Promise<void> {
  const db = ingestDatabase(pool);
  await db
    .update(contactsInCascade)
    .set({ subscription_status: "suppressed" })
    .where(and(eq(contactsInCascade.id, contactId), ne(contactsInCascade.subscription_status, "suppressed")));
  await db
    .update(enrollmentsInCascade)
    .set({ state: "stopped", updated_at: sql`now()` })
    .where(and(eq(enrollmentsInCascade.contact_id, contactId), eq(enrollmentsInCascade.state, "active")));
}

const PROVIDER_EVENT_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounce",
  "email.complained": "complaint",
  "email.opened": "open",
  "email.clicked": "click",
};

export async function ingestProviderEvent(
  pool: Queryable,
  evt: {
    type: string;
    providerMessageId: string;
    providerConnectionId?: string;
  },
): Promise<void> {
  const mapped = PROVIDER_EVENT_MAP[evt.type];
  if (!mapped) return;
  const ctx = await sendContextByProviderId(
    pool,
    evt.providerMessageId,
    evt.providerConnectionId,
  );
  if (!ctx) return;
  await insertEvent(pool, ctx, mapped);
  if (mapped === "bounce" || mapped === "complaint") {
    await suppressContact(pool, ctx.contactId);
  }
}
