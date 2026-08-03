import {
  contentInCascade as contentTable,
  databaseFor,
  emailsInCascade as emailsTable,
  templatesInCascade as templatesTable,
} from "@content-automation/database";
import { desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { EmailRecord } from "../domain/types";

export async function createTemplate(
  pool: Pool,
  input: { name: string; mjml: string; designJson?: unknown },
): Promise<{ id: string }> {
  const [row] = await databaseFor(pool).insert(templatesTable).values({
    name: input.name,
    mjml: input.mjml,
    design_json: input.designJson ?? null,
  }).returning({ id: templatesTable.id });
  return row;
}

export async function createContent(
  pool: Pool,
  input: { name: string; subject: string; preheader?: string; slots: Record<string, string> },
): Promise<{ id: string }> {
  const [row] = await databaseFor(pool).insert(contentTable).values({
    name: input.name,
    subject: input.subject,
    preheader: input.preheader ?? null,
    slots: input.slots,
  }).returning({ id: contentTable.id });
  return row;
}

export async function createEmail(
  pool: Pool,
  input: {
    name: string;
    templateId: string;
    contentId: string;
    fromEmail: string;
    fromName?: string;
    interestUrl?: string;
  },
): Promise<EmailRecord> {
  const [row] = await databaseFor(pool).insert(emailsTable).values({
    name: input.name,
    template_id: input.templateId,
    content_id: input.contentId,
    from_email: input.fromEmail,
    from_name: input.fromName ?? null,
    interest_url: input.interestUrl ?? null,
  }).returning();
  return {
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    contentId: row.content_id,
    fromEmail: row.from_email,
    fromName: row.from_name,
    interestUrl: row.interest_url,
  };
}

export interface EmailBundle {
  email: EmailRecord;
  templateMjml: string;
  compiledHtml: string | null;
  subject: string;
  preheader: string | null;
  slots: Record<string, string>;
}

export async function getEmailBundle(pool: Pool, emailId: string): Promise<EmailBundle | null> {
  const [row] = await databaseFor(pool).select({
    id: emailsTable.id,
    name: emailsTable.name,
    template_id: emailsTable.template_id,
    content_id: emailsTable.content_id,
    from_email: emailsTable.from_email,
    from_name: emailsTable.from_name,
    interest_url: emailsTable.interest_url,
    mjml: templatesTable.mjml,
    compiled_html: templatesTable.compiled_html,
    subject: contentTable.subject,
    preheader: contentTable.preheader,
    slots: contentTable.slots,
  }).from(emailsTable)
    .innerJoin(templatesTable, eq(templatesTable.id, emailsTable.template_id))
    .innerJoin(contentTable, eq(contentTable.id, emailsTable.content_id))
    .where(eq(emailsTable.id, emailId)).limit(1);
  if (!row) return null;
  return {
    email: {
      id: row.id,
      name: row.name,
      templateId: row.template_id,
      contentId: row.content_id,
      fromEmail: row.from_email,
      fromName: row.from_name,
      interestUrl: row.interest_url,
    },
    templateMjml: row.mjml,
    compiledHtml: row.compiled_html,
    subject: row.subject,
    preheader: row.preheader,
    slots: row.slots as Record<string, string>,
  };
}

export async function cacheCompiledTemplate(pool: Pool, templateId: string, html: string): Promise<void> {
  await databaseFor(pool).update(templatesTable).set({ compiled_html: html })
    .where(eq(templatesTable.id, templateId));
}

export async function listTemplates(pool: Pool): Promise<Array<{ id: string; name: string; hasDesign: boolean }>> {
  const rows = await databaseFor(pool).select({
    id: templatesTable.id,
    name: templatesTable.name,
    hasDesign: sql<boolean>`${templatesTable.design_json} is not null`,
  }).from(templatesTable).orderBy(desc(templatesTable.created_at));
  return rows;
}

export async function getTemplate(
  pool: Pool,
  templateId: string,
): Promise<{ id: string; name: string; mjml: string; designJson: unknown | null } | null> {
  const [row] = await databaseFor(pool).select({
    id: templatesTable.id,
    name: templatesTable.name,
    mjml: templatesTable.mjml,
    design_json: templatesTable.design_json,
  }).from(templatesTable).where(eq(templatesTable.id, templateId)).limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, mjml: row.mjml, designJson: row.design_json };
}

/** Update a template's MJML; the compiled cache is cleared so the next send recompiles. */
export async function updateTemplate(
  pool: Pool,
  templateId: string,
  input: { mjml: string; name?: string; designJson?: unknown },
): Promise<void> {
  const [updated] = await databaseFor(pool).update(templatesTable).set({
    mjml: input.mjml,
    name: input.name ?? sql`${templatesTable.name}`,
    design_json: input.designJson ?? null,
    compiled_html: null,
  }).where(eq(templatesTable.id, templateId)).returning({ id: templatesTable.id });
  if (!updated) throw new Error("template not found");
}

export async function listContentRecords(
  pool: Pool,
): Promise<Array<{ id: string; name: string; subject: string }>> {
  return databaseFor(pool).select({
    id: contentTable.id,
    name: contentTable.name,
    subject: contentTable.subject,
  }).from(contentTable).orderBy(desc(contentTable.created_at));
}

export async function listEmails(
  pool: Pool,
): Promise<
  Array<{ id: string; name: string; templateName: string; contentName: string; fromEmail: string; interestUrl: string | null }>
> {
  return databaseFor(pool).select({
    id: emailsTable.id,
    name: emailsTable.name,
    templateName: templatesTable.name,
    contentName: contentTable.name,
    fromEmail: emailsTable.from_email,
    interestUrl: emailsTable.interest_url,
  }).from(emailsTable)
    .innerJoin(templatesTable, eq(templatesTable.id, emailsTable.template_id))
    .innerJoin(contentTable, eq(contentTable.id, emailsTable.content_id))
    .orderBy(desc(emailsTable.created_at));
}
