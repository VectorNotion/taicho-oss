import {
  databaseFor,
  plain_text_emailsInCascade as plainTextEmailsInCascade,
} from "@content-automation/database";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { PlainTextEmail } from "../domain/types";

export function plainTextEmailContent(input: { subject: string; body: string }): string {
  return `Subject: ${input.subject}\n\n${input.body}\n`;
}

function fromRow(row: {
  id: string;
  funnelId: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}): PlainTextEmail {
  return { ...row, content: plainTextEmailContent(row) };
}

const selection = {
  id: plainTextEmailsInCascade.id,
  funnelId: plainTextEmailsInCascade.funnel_id,
  name: plainTextEmailsInCascade.name,
  subject: plainTextEmailsInCascade.subject,
  body: plainTextEmailsInCascade.body,
  createdAt: plainTextEmailsInCascade.created_at,
  updatedAt: plainTextEmailsInCascade.updated_at,
};

function normalize(input: { name: string; subject: string; body: string }) {
  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!name || !subject || !body) throw new Error("name, subject, and body are required");
  return { name, subject, body };
}

export async function listPlainTextEmails(pool: Pool, funnelId: string): Promise<PlainTextEmail[]> {
  const rows = await databaseFor(pool).select(selection)
    .from(plainTextEmailsInCascade)
    .where(eq(plainTextEmailsInCascade.funnel_id, funnelId))
    .orderBy(desc(plainTextEmailsInCascade.updated_at));
  return rows.map(fromRow);
}

export async function getPlainTextEmail(pool: Pool, id: string): Promise<PlainTextEmail | null> {
  const [row] = await databaseFor(pool).select(selection)
    .from(plainTextEmailsInCascade)
    .where(eq(plainTextEmailsInCascade.id, id))
    .limit(1);
  return row ? fromRow(row) : null;
}

export async function createPlainTextEmail(
  pool: Pool,
  input: { funnelId: string; name: string; subject: string; body: string },
): Promise<PlainTextEmail> {
  const value = normalize(input);
  const [row] = await databaseFor(pool).insert(plainTextEmailsInCascade).values({
    funnel_id: input.funnelId,
    ...value,
  }).returning(selection);
  return fromRow(row);
}

export async function updatePlainTextEmail(
  pool: Pool,
  input: { funnelId: string; id: string; name: string; subject: string; body: string },
): Promise<PlainTextEmail> {
  const value = normalize(input);
  const [row] = await databaseFor(pool).update(plainTextEmailsInCascade)
    .set({ ...value, updated_at: sql`now()` })
    .where(and(
      eq(plainTextEmailsInCascade.id, input.id),
      eq(plainTextEmailsInCascade.funnel_id, input.funnelId),
    ))
    .returning(selection);
  if (!row) throw new Error("plain-text email not found");
  return fromRow(row);
}

export async function deletePlainTextEmail(
  pool: Pool,
  funnelId: string,
  id: string,
): Promise<void> {
  await databaseFor(pool).delete(plainTextEmailsInCascade).where(and(
    eq(plainTextEmailsInCascade.id, id),
    eq(plainTextEmailsInCascade.funnel_id, funnelId),
  ));
}
