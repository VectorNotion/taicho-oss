import http from "node:http";
import {
  contactsInCascade,
  databaseFor,
  type Database,
  enrollmentsInCascade,
  eventsInCascade,
  sendsInCascade,
  webhook_receiptsInCascade as webhookReceiptsInCascade,
} from "@content-automation/database";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import {
  activateExecutionContext,
  createLogger,
  headersAtExternalBoundary,
  observeOperation,
  publicCorrelationHeaders,
} from "@content-automation/observability";
import {
  findDeliveryWebhookConfiguration,
  markDeliveryWebhookReceived,
} from "../data/delivery-settings-repository";
import { verifyToken } from "./tokens";
import { renderDashboard } from "./dashboard";
import { ingestProviderEvent, recordClick, recordOpen } from "./ingest";
import {
  normalizeMailchimpWebhookEvent,
  parseMailchimpWebhookEvents,
  verifyMailchimpWebhook,
} from "./mailchimp-webhook";
import { verifyResendWebhook } from "./resend-webhook";
import {
  normalizeSendGridWebhookEvent,
  parseSendGridWebhookEvents,
  verifySendGridWebhook,
} from "./sendgrid-webhook";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const log = createLogger("cascade.http");

export type CascadeHttpPools = {
  control: Pool;
  forOrganization: (organizationId: string) => Pool;
  /** Development-only aggregate dashboard. Never expose this in production. */
  dashboard?: Pool;
};

function httpPools(input: Pool | CascadeHttpPools): CascadeHttpPools {
  if ("forOrganization" in input) return input;
  return {
    control: input,
    forOrganization: () => input,
    dashboard: input,
  };
}

class PayloadTooLargeError extends Error {}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLargeError();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    total += bytes.byteLength;
    if (total > maxBytes) throw new PayloadTooLargeError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleUnsubscribe(pool: Pool, contactId: string): Promise<boolean> {
  return databaseFor(pool).transaction(async (tx) => {
    const changed = await tx
      .update(contactsInCascade)
      .set({ subscription_status: "unsubscribed" })
      .where(and(eq(contactsInCascade.id, contactId), eq(contactsInCascade.subscription_status, "subscribed")))
      .returning({ id: contactsInCascade.id });
    if (changed.length === 0) return false;
    await tx
      .update(enrollmentsInCascade)
      .set({ state: "stopped", updated_at: sql`now()` })
      .where(and(eq(enrollmentsInCascade.contact_id, contactId), eq(enrollmentsInCascade.state, "active")));
    await tx.insert(eventsInCascade).values({ contact_id: contactId, type: "unsub" });
    return true;
  });
}

/**
 * Engine-owned HTTP surface: RFC 8058 one-click unsubscribe, open pixel,
 * click redirect, and provider webhooks. No UI lives here.
 */
export function createCascadeHttpServer(input: Pool | CascadeHttpPools): http.Server {
  const pools = httpPools(input);
  return http.createServer(async (req, res) => {
    const incomingHeaders = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) incomingHeaders.append(name, item);
      } else if (value !== undefined) {
        incomingHeaders.set(name, value);
      }
    }
    const trustedHeaders = headersAtExternalBoundary(incomingHeaders);
    activateExecutionContext({ headers: trustedHeaders, actorType: "system" });
    const correlation = publicCorrelationHeaders(trustedHeaders);
    for (const [name, value] of correlation.entries()) res.setHeader(name, value);
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const [, route, token] = url.pathname.split("/");

      if (url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
        return;
      }

      if (url.pathname === "/" || url.pathname === "/dashboard") {
        if (!pools.dashboard || process.env.NODE_ENV === "production") {
          res.writeHead(404).end("not found");
          return;
        }
        const html = await renderDashboard(pools.dashboard);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
        return;
      }

      if (route === "u" && token && (req.method === "POST" || req.method === "GET")) {
        const payload = verifyToken(token);
        if (
          !payload
          || payload.t !== "unsub"
          || typeof payload.c !== "string"
          || typeof payload.o !== "string"
        ) {
          res.writeHead(400).end("invalid token");
          return;
        }
        const contactId = payload.c;
        const organizationId = payload.o;
        const pool = pools.forOrganization(organizationId);
        await observeOperation(
          "cascade.contact.unsubscribe",
          {
            executionId: correlation.get("x-vector-notion-execution-id") ?? undefined,
            requestId: correlation.get("x-vector-notion-request-id") ?? undefined,
            organizationId,
            actorType: "system",
            attributes: { "cascade.contact.id": contactId },
          },
          () => handleUnsubscribe(pool, contactId),
        );
        if (req.method === "POST") {
          res.writeHead(200, { "Content-Type": "text/plain" }).end("You are unsubscribed.");
        } else {
          res
            .writeHead(200, { "Content-Type": "text/html" })
            .end("<html><body><p>You are unsubscribed.</p></body></html>");
        }
        return;
      }

      if (route === "o" && token && req.method === "GET") {
        const payload = verifyToken(token);
        if (
          !payload
          || payload.t !== "open"
          || typeof payload.s !== "string"
          || typeof payload.o !== "string"
        ) {
          res.writeHead(400).end("invalid token");
          return;
        }
        const sendId = payload.s;
        const organizationId = payload.o;
        const pool = pools.forOrganization(organizationId);
        await observeOperation(
          "cascade.email.open",
          {
            executionId: correlation.get("x-vector-notion-execution-id") ?? undefined,
            requestId: correlation.get("x-vector-notion-request-id") ?? undefined,
            actorType: "system",
            parentExecutionId: sendId,
            organizationId,
            attributes: { "cascade.send.id": sendId },
          },
          () => recordOpen(pool, sendId),
        );
        res.writeHead(200, { "Content-Type": "image/gif", "Content-Length": GIF.length }).end(GIF);
        return;
      }

      if (route === "c" && token && req.method === "GET") {
        const payload = verifyToken(token);
        if (
          !payload
          || payload.t !== "click"
          || typeof payload.s !== "string"
          || typeof payload.u !== "string"
          || typeof payload.o !== "string"
        ) {
          res.writeHead(400).end("invalid token");
          return;
        }
        const sendId = payload.s;
        const destination = payload.u;
        const isInterest = payload.i === 1;
        const organizationId = payload.o;
        const pool = pools.forOrganization(organizationId);
        await observeOperation(
          "cascade.email.click",
          {
            executionId: correlation.get("x-vector-notion-execution-id") ?? undefined,
            requestId: correlation.get("x-vector-notion-request-id") ?? undefined,
            actorType: "system",
            parentExecutionId: sendId,
            organizationId,
            attributes: { "cascade.send.id": sendId, "cascade.click.interest": isInterest },
          },
          () => recordClick(pool, sendId, destination, isInterest),
        );
        res.writeHead(302, { Location: destination }).end();
        return;
      }

      const deliveryWebhook = url.pathname.match(
        /^\/webhooks\/delivery\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      );
      if (deliveryWebhook && req.method === "POST") {
        const providerConnectionId = deliveryWebhook[1];
        const configuration = await findDeliveryWebhookConfiguration(
          pools.control,
          providerConnectionId,
        );
        if (!configuration) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
          return;
        }
        let rawBody: string;
        try {
          rawBody = await readBody(req, MAX_WEBHOOK_BYTES);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            res
              .writeHead(413, { "Content-Type": "text/plain" })
              .end("payload too large");
            return;
          }
          throw error;
        }

        const events: Array<{
          receiptId: string;
          type: string;
          providerMessageId: string;
        }> = [];
        if (configuration.provider === "resend") {
          const eventId = verifyResendWebhook({
            secret: configuration.webhookSecret,
            body: rawBody,
            eventId: req.headers["svix-id"] as string | undefined,
            timestamp: req.headers["svix-timestamp"] as string | undefined,
            signatures: req.headers["svix-signature"] as string | undefined,
          });
          if (!eventId) {
            log.warn("cascade.provider.webhook.verification_failed", {
              provider: "resend",
              payload_bytes: Buffer.byteLength(rawBody),
            });
            res
              .writeHead(401, { "Content-Type": "text/plain" })
              .end("webhook verification failed");
            return;
          }
          let body: Record<string, any>;
          try {
            const parsed = JSON.parse(rawBody || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new SyntaxError();
            }
            body = parsed;
          } catch {
            res
              .writeHead(400, { "Content-Type": "text/plain" })
              .end("invalid webhook payload");
            return;
          }
          if (
            typeof body.type === "string"
            && typeof body.data?.email_id === "string"
          ) {
            events.push({
              receiptId: `resend:${eventId}`,
              type: body.type,
              providerMessageId: body.data.email_id,
            });
          }
        } else if (configuration.provider === "mailchimp") {
          const fields = new URLSearchParams(rawBody);
          if (
            !verifyMailchimpWebhook({
              secret: configuration.webhookSecret,
              url: configuration.webhookUrl,
              fields,
              signature: req.headers["x-mandrill-signature"] as
                | string
                | undefined,
            })
          ) {
            log.warn("cascade.provider.webhook.verification_failed", {
              provider: "mailchimp",
              payload_bytes: Buffer.byteLength(rawBody),
            });
            res
              .writeHead(401, { "Content-Type": "text/plain" })
              .end("webhook verification failed");
            return;
          }
          try {
            for (const event of parseMailchimpWebhookEvents(fields)) {
              const normalized = normalizeMailchimpWebhookEvent(event);
              if (normalized) events.push(normalized);
            }
          } catch {
            res
              .writeHead(400, { "Content-Type": "text/plain" })
              .end("invalid webhook payload");
            return;
          }
        } else {
          if (
            !verifySendGridWebhook({
              publicKey: configuration.webhookSecret,
              body: rawBody,
              signature: req.headers[
                "x-twilio-email-event-webhook-signature"
              ] as string | undefined,
              timestamp: req.headers[
                "x-twilio-email-event-webhook-timestamp"
              ] as string | undefined,
            })
          ) {
            log.warn("cascade.provider.webhook.verification_failed", {
              provider: "sendgrid",
              payload_bytes: Buffer.byteLength(rawBody),
            });
            res
              .writeHead(401, { "Content-Type": "text/plain" })
              .end("webhook verification failed");
            return;
          }
          try {
            for (const event of parseSendGridWebhookEvents(rawBody)) {
              const normalized = normalizeSendGridWebhookEvent(event);
              if (normalized) events.push(normalized);
            }
          } catch {
            res
              .writeHead(400, { "Content-Type": "text/plain" })
              .end("invalid webhook payload");
            return;
          }
        }

        const pool = pools.forOrganization(configuration.organizationId);
        await markDeliveryWebhookReceived(pool, providerConnectionId);
        let accepted = false;
        for (const event of events) {
          const processed = await databaseFor(pool).transaction(async (tx) => {
            const receipt = await tx
              .insert(webhookReceiptsInCascade)
              .values({ organization_id: configuration.organizationId, id: event.receiptId })
              .onConflictDoNothing({
                target: [webhookReceiptsInCascade.organization_id, webhookReceiptsInCascade.id],
              })
              .returning({ id: webhookReceiptsInCascade.id });
            if (receipt.length === 0) return false;
            await observeOperation(
                "cascade.provider.webhook",
                {
                  executionId:
                    correlation.get("x-vector-notion-execution-id") ?? undefined,
                  requestId:
                    correlation.get("x-vector-notion-request-id") ?? undefined,
                  organizationId: configuration.organizationId,
                  actorType: "service",
                  attributes: {
                    "cascade.provider.id": providerConnectionId,
                    "cascade.provider.name": configuration.provider,
                    "cascade.provider.event_type": event.type,
                  },
                },
                () =>
                  ingestProviderEvent(tx as Database, {
                    type: event.type,
                    providerMessageId: event.providerMessageId,
                    providerConnectionId,
                  }),
              );
            return true;
          });
          if (processed) accepted = true;
        }
        res
          .writeHead(accepted || events.length === 0 ? 200 : 202, {
            "Content-Type": "text/plain",
          })
          .end(accepted || events.length === 0 ? "ok" : "accepted");
        return;
      }

      if (url.pathname === "/webhooks/resend" && req.method === "POST") {
        let rawBody: string;
        try {
          rawBody = await readBody(req, MAX_WEBHOOK_BYTES);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            res.writeHead(413, { "Content-Type": "text/plain" }).end("payload too large");
            return;
          }
          throw error;
        }
        const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
        const eventId = webhookSecret
          ? verifyResendWebhook({
              secret: webhookSecret,
              body: rawBody,
              eventId: req.headers["svix-id"] as string | undefined,
              timestamp: req.headers["svix-timestamp"] as string | undefined,
              signatures: req.headers["svix-signature"] as string | undefined,
            })
          : null;
        if (!eventId) {
          log.warn("cascade.provider.webhook.verification_failed", {
            payload_bytes: Buffer.byteLength(rawBody),
          });
          res.writeHead(401, { "Content-Type": "text/plain" }).end("webhook verification failed");
          return;
        }
        let body: Record<string, any>;
        try {
          const parsed = JSON.parse(rawBody || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError();
          body = parsed;
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain" }).end("invalid webhook payload");
          return;
        }
        if (typeof body.type === "string" && typeof body.data?.email_id === "string") {
          const [owner] = await databaseFor(pools.control)
            .select({ organizationId: sendsInCascade.organization_id })
            .from(sendsInCascade)
            .where(eq(sendsInCascade.provider_message_id, body.data.email_id))
            .limit(1);
          const organizationId = owner?.organizationId;
          if (!organizationId) {
            res.writeHead(202, { "Content-Type": "text/plain" }).end("ignored");
            return;
          }
          const pool = pools.forOrganization(organizationId);
          const receipt = await databaseFor(pool)
            .insert(webhookReceiptsInCascade)
            .values({ organization_id: organizationId, id: eventId })
            .onConflictDoNothing({
              target: [webhookReceiptsInCascade.organization_id, webhookReceiptsInCascade.id],
            })
            .returning({ id: webhookReceiptsInCascade.id });
          if (receipt.length === 0) {
            res.writeHead(202, { "Content-Type": "text/plain" }).end("accepted");
            return;
          }
          await observeOperation(
            "cascade.provider.webhook",
            {
              executionId: correlation.get("x-vector-notion-execution-id") ?? undefined,
              requestId: correlation.get("x-vector-notion-request-id") ?? undefined,
              organizationId,
              actorType: "service",
              attributes: { "cascade.provider.event_type": body.type },
            },
            () => ingestProviderEvent(pool, { type: body.type, providerMessageId: body.data.email_id }),
          );
        }
        res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
        return;
      }

      res.writeHead(404).end("not found");
    } catch (err) {
      log.error("cascade.http.request_failed", err, {
        http_method: req.method,
      });
      res.writeHead(500).end("error");
    }
  });
}
