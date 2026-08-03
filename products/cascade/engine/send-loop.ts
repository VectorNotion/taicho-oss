import {
  contactsInCascade,
  databaseFor,
  enrollmentsInCascade,
  eventsInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  sendsInCascade,
  variant_statsInCascade as variantStatsInCascade,
  variantsInCascade,
} from "@content-automation/database";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import {
  createLogger,
  observeOperation,
  type ActorType,
} from "@content-automation/observability";
import type { Contact } from "../domain/types";
import { composeSend } from "./compose";
import type { Mailer } from "./mailer";

const MAX_ATTEMPTS = 5;
const log = createLogger("cascade.send-loop");

class SendAttemptFailure extends Error {
  constructor(
    readonly finalAttempt: boolean,
    options: { cause: unknown },
  ) {
    super("Cascade email transport attempt failed.", options);
    this.name = "SendAttemptFailure";
  }
}

export interface SendLoopResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Transport loop: claims queued sends one at a time with SKIP LOCKED,
 * composes, rechecks suppression, and hands finished HTML to the mailer.
 * Transport failures leave the send queued (attempts+1) up to MAX_ATTEMPTS.
 */
export async function runSendLoop(
  pool: Pool,
  mailer: Mailer,
  opts: {
    batchSize?: number;
    providerConnectionId?: string;
    sender?: { id: string; name: string; email: string };
  } = {},
): Promise<SendLoopResult> {
  const batchSize = opts.batchSize ?? 20;
  const result: SendLoopResult = { sent: 0, failed: 0, skipped: 0 };
  const send = alias(sendsInCascade, "send");

  for (let i = 0; i < batchSize; i++) {
    const client = await pool.connect();
    const db = databaseFor(client);
    try {
      await db.execute(sql`begin`);
      const [row] = await db
        .select({
          id: send.id,
          attempts: send.attempts,
          variantId: send.variant_id,
          variantEmailId: variantsInCascade.email_id,
          organizationId: send.organization_id,
          createdBy: send.created_by,
          actorType: send.actor_type,
          requestId: send.request_id,
          parentExecutionId: send.parent_execution_id,
          traceId: send.trace_id,
          traceparent: send.traceparent,
          stepConfig: funnelStepsInCascade.config,
          contactId: contactsInCascade.id,
          contactEmail: contactsInCascade.email,
          timezone: contactsInCascade.timezone,
          attributes: contactsInCascade.attributes,
          subscriptionStatus: contactsInCascade.subscription_status,
          workspaceContactId: contactsInCascade.workspace_contact_id,
          outreachLeadId: contactsInCascade.outreach_lead_id,
          enrollmentId: enrollmentsInCascade.id,
        })
        .from(send)
        .innerJoin(enrollmentsInCascade, eq(enrollmentsInCascade.id, send.enrollment_id))
        .innerJoin(contactsInCascade, eq(contactsInCascade.id, enrollmentsInCascade.contact_id))
        .innerJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, send.step_id))
        .leftJoin(variantsInCascade, eq(variantsInCascade.id, send.variant_id))
        .where(and(eq(send.status, "queued"), lt(send.attempts, MAX_ATTEMPTS)))
        .orderBy(asc(send.created_at))
        .for("update", { of: send, skipLocked: true })
        .limit(1);
      if (!row) {
        await db.execute(sql`commit`);
        break;
      }
      await db
        .update(sendsInCascade)
        .set({ request_id: sql`coalesce(${sendsInCascade.request_id}, ${sendsInCascade.id}::text)` })
        .where(eq(sendsInCascade.id, row.id));
      try {
        const outcome = await observeOperation(
          "cascade.email.send",
          {
            requestId: row.requestId ?? row.id,
            traceCarrier: { traceparent: row.traceparent ?? undefined },
            parentExecutionId: row.parentExecutionId ?? row.enrollmentId,
            organizationId: row.organizationId ?? undefined,
            actorId: row.createdBy ?? undefined,
            actorType: (row.actorType ?? "system") as ActorType,
            jobId: row.id,
            attributes: {
              "cascade.enrollment.id": row.enrollmentId,
              "cascade.send.attempt": Number(row.attempts) + 1,
              "cascade.send.has_variant": Boolean(row.variantId),
            },
          },
          async () => {
            // Suppression recheck — status may have changed since enqueue. No exceptions.
            if (row.subscriptionStatus !== "subscribed") {
              await db.update(sendsInCascade).set({ status: "skipped" }).where(eq(sendsInCascade.id, row.id));
              await db.execute(sql`commit`);
              return "skipped" as const;
            }

            const contact: Contact = {
              id: row.contactId,
              email: row.contactEmail,
              timezone: row.timezone,
              attributes: row.attributes as Record<string, unknown>,
              subscriptionStatus: row.subscriptionStatus as Contact["subscriptionStatus"],
              workspaceContactId: row.workspaceContactId,
              outreachLeadId: row.outreachLeadId,
            };
            const config = row.stepConfig as { emailId?: string; subject?: string; body?: string };
            // A bandit-selected variant overrides the step's own email.
            const emailId = row.variantEmailId ?? config.emailId;

            try {
              const composed = await composeSend(pool, {
                sendId: row.id,
                organizationId: row.organizationId ?? "legacy",
                emailId,
                inline: emailId ? undefined : { subject: config.subject ?? "", body: config.body ?? "" },
                contact,
              });
              const { providerMessageId } = await mailer.send({
                to: contact.email,
                from: opts.sender
                  ? `${opts.sender.name} <${opts.sender.email}>`
                  : composed.from,
                subject: composed.subject,
                html: composed.html,
                text: composed.text,
                headers: composed.headers,
              });
              await db
                .update(sendsInCascade)
                .set({
                  status: "sent",
                  provider_message_id: providerMessageId,
                  delivery_provider_id: opts.providerConnectionId ?? null,
                  sender_identity_id: opts.sender?.id ?? null,
                })
                .where(eq(sendsInCascade.id, row.id));
              await db.insert(eventsInCascade).values({
                contact_id: contact.id,
                enrollment_id: row.enrollmentId,
                send_id: row.id,
                type: "sent",
              });
              if (row.variantId) {
                await db
                  .update(variantStatsInCascade)
                  .set({ sends: sql`${variantStatsInCascade.sends} + 1` })
                  .where(eq(variantStatsInCascade.variant_id, row.variantId));
              }
              await db.execute(sql`commit`);
              return "sent" as const;
            } catch (cause) {
              const attemptsNow = Number(row.attempts) + 1;
              await db
                .update(sendsInCascade)
                .set({
                  attempts: sql`${sendsInCascade.attempts} + 1`,
                  status: sql`case when ${sendsInCascade.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end`,
                  delivery_provider_id: opts.providerConnectionId ?? null,
                  sender_identity_id: opts.sender?.id ?? null,
                })
                .where(eq(sendsInCascade.id, row.id));
              await db.execute(sql`commit`);
              throw new SendAttemptFailure(attemptsNow >= MAX_ATTEMPTS, { cause });
            }
          },
        );
        result[outcome] += 1;
      } catch (error) {
        if (error instanceof SendAttemptFailure) {
          if (error.finalAttempt) result.failed += 1;
          log.warn("cascade.send.attempt_failed", {
            send_id: row.id,
            final_attempt: error.finalAttempt,
          });
          continue;
        }
        throw error;
      }
    } catch (err) {
      await db.execute(sql`rollback`);
      throw err;
    } finally {
      client.release();
    }
  }
  return result;
}
