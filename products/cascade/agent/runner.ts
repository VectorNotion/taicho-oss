import type { Pool } from "pg";
import { createLogger } from "@content-automation/observability";
import type { Attribution } from "../data/graph-repository";
import {
  computeDueMembers,
  failStepOutput,
  getFunnelSettings,
  listRunEnabledFunnels,
  listStepOutputs,
  recordAttemptSent,
} from "../data/execution-repository";
import { getCascadeAdminPool, getCascadePool } from "../data/pool";
import type { CascadeBrain } from "./brain";
import { resolveCascadeBrain } from "./brain";
import { CascadeDeliveryError, type CascadeSender } from "../delivery/sender";
import { resolveCascadeSender } from "../delivery/sender";
import { generateTouchDrafts } from "./execution";

/**
 * The platform funnel runner: everything the external executor contract
 * does, hosted here. One funnel at a time it settles waits, drafts due
 * touches, and sends approved due drafts through the configured sender,
 * recording attempt_sent so the cursor advances. Per-funnel run_enabled
 * is the safety gate for the background pass; a manual run works
 * regardless because a human asked. This is funnel step-walking — the
 * dashboard-level Automations product (packages/flow) is a different
 * thing entirely.
 */

const log = createLogger("cascade.runner");

export interface FunnelRunSummary {
  funnelId: string;
  drafted: number;
  sent: number;
  failed: number;
  /** Due-and-approved sends skipped because no sender is configured. */
  skipped: number;
  senderConfigured: string | null;
}

export async function runFunnel(
  pool: Pool,
  input: { funnelId: string; now: Date },
  brain: CascadeBrain,
  sender: CascadeSender | null,
  attribution: Attribution,
): Promise<FunnelRunSummary> {
  const summary: FunnelRunSummary = {
    funnelId: input.funnelId,
    drafted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    senderConfigured: sender?.name ?? null,
  };

  const drafts = await generateTouchDrafts(pool, { funnelId: input.funnelId, now: input.now }, brain, attribution);
  summary.drafted = drafts.filter((draft) => !draft.error).length;
  summary.failed += drafts.filter((draft) => Boolean(draft.error)).length;

  const [schedule, outputs] = await Promise.all([
    computeDueMembers(pool, input.funnelId, input.now),
    listStepOutputs(pool, input.funnelId),
  ]);
  const outputById = new Map(outputs.map((output) => [output.id, output]));

  for (const entry of schedule) {
    if (Date.parse(entry.dueAt) > input.now.getTime()) continue;
    if (entry.draftStatus !== "approved" || !entry.draftId) continue;
    const output = outputById.get(entry.draftId);
    if (!output) continue;
    if (!sender) {
      summary.skipped += 1;
      continue;
    }
    let providerMessageId: string;
    try {
      ({ providerMessageId } = await sender.send(
        { to: entry.email, subject: output.subject, body: output.body },
        { idempotencyKey: output.id },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed += 1;
      if (!(error instanceof CascadeDeliveryError && error.retryable)) {
        await failStepOutput(pool, input.funnelId, entry.draftId, message);
      }
      log.error("cascade.runner.send_failed", error, { funnel_id: input.funnelId, member_id: entry.memberId });
      continue;
    }
    try {
      const recorded = await recordAttemptSent(pool, {
        funnelId: input.funnelId,
        contactId: entry.contactId,
        outputId: output.id,
        now: input.now,
        metadata: { provider: sender.name, providerMessageId },
      }, attribution);
      if (recorded.recorded) summary.sent += 1;
    } catch (error) {
      // Delivery has already crossed the external side-effect boundary. Keep
      // the draft approved so a restarted worker repeats the same provider
      // idempotency key and can finish the database transition safely.
      summary.failed += 1;
      log.error("cascade.runner.send_record_failed", error, {
        funnel_id: input.funnelId,
        member_id: entry.memberId,
        output_id: output.id,
        provider_message_id: providerMessageId,
      });
    }
  }
  return summary;
}

/**
 * Background pass over every run-enabled funnel in every organization.
 * Enumerates with the admin pool; all real work runs through each
 * organization's own RLS pool. Never rejects — a broken funnel is
 * logged and the pass moves on. Pre-tenancy rows without an
 * organization are skipped: no org means no RLS pool to run in.
 */
export async function runCascadeFunnelPass(now = new Date()): Promise<FunnelRunSummary[]> {
  const enabled = await listRunEnabledFunnels(getCascadeAdminPool());
  if (enabled.length === 0) return [];
  const brain = resolveCascadeBrain();
  const sender = resolveCascadeSender();
  const summaries: FunnelRunSummary[] = [];
  for (const funnel of enabled) {
    if (!funnel.organizationId) {
      log.debug?.("cascade.runner.skipped_no_organization", { funnel_id: funnel.funnelId });
      continue;
    }
    try {
      const pool = getCascadePool(funnel.organizationId);
      const summary = await runFunnel(pool, { funnelId: funnel.funnelId, now }, brain, sender, { actorType: "system" });
      summaries.push(summary);
      if (summary.drafted || summary.sent || summary.failed || summary.skipped) {
        log.info("cascade.runner.funnel_pass", {
          funnel_id: summary.funnelId,
          drafted: summary.drafted,
          sent: summary.sent,
          failed: summary.failed,
          skipped: summary.skipped,
          sender: summary.senderConfigured ?? "none",
        });
      }
    } catch (error) {
      log.error("cascade.runner.funnel_pass_failed", error, { funnel_id: funnel.funnelId });
    }
  }
  return summaries;
}
