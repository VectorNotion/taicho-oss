/**
 * Notification email for platform surfaces (flow out.deliver, approval
 * nudges, loop briefs). Transport is entirely Cascade's Mailer stack —
 * this module resolves the org's configured provider through
 * resolveWorkspaceDeliveryRuntime and never constructs a provider client
 * of its own. Importing products/cascade from packages/platform mirrors
 * packages/platform/agents/registry.ts (products/* via the `@/*` alias).
 */
import type { Pool } from 'pg';
import { getCascadePool } from '@/products/cascade/data/pool';
import {
  resolveWorkspaceDeliveryRuntime,
  type WorkspaceDeliveryRuntime,
} from '@/products/cascade/delivery/runtime';

export type NotificationEmailInput = {
  organizationId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type NotificationEmailDependencies = {
  /** Test seam, mirroring Cascade's `dependencies: { client? }` convention. */
  resolveRuntime?: (pool: Pool) => Promise<WorkspaceDeliveryRuntime>;
};

/** Providers receive finished HTML only: escape, then paragraph-wrap. */
export function notificationHtml(text: string): string {
  const paragraphs = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${block.replace(/\n/g, '<br/>')}</p>`);
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;',
    'font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;',
    'line-height:1.6;color:#1a1a1a">',
    paragraphs.join(''),
    '</body></html>',
  ].join('');
}

export async function sendNotificationEmail(
  input: NotificationEmailInput,
  dependencies: NotificationEmailDependencies = {},
): Promise<{ delivered: boolean; provider: string }> {
  const pool = getCascadePool(input.organizationId);
  const runtime = dependencies.resolveRuntime
    ? await dependencies.resolveRuntime(pool)
    : await resolveWorkspaceDeliveryRuntime(pool);
  // No verified default sender means no usable provider (covers the
  // unconfigured org, the production DisabledMailer fallback, and e2e
  // mode). Degrade instead of throwing — the caller records a warning.
  if (!runtime.sender) return { delivered: false, provider: 'none' };
  await runtime.mailer.send({
    to: input.to,
    from: `${runtime.sender.name} <${runtime.sender.email}>`,
    subject: input.subject,
    text: input.text,
    html: input.html ?? notificationHtml(input.text),
    headers: {},
  });
  return { delivered: true, provider: runtime.provider ?? 'unknown' };
}
