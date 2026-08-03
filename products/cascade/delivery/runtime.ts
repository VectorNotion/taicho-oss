import type { Pool } from "pg";
import { resolveDefaultDeliveryConfiguration } from "../data/delivery-settings-repository";
import {
  DeterministicE2eMailer,
  DisabledMailer,
  MailchimpTransactionalMailer,
  ResendMailer,
  SendGridMailer,
  selectMailer,
  type Mailer,
} from "../engine/mailer";

export interface WorkspaceDeliveryRuntime {
  mailer: Mailer;
  provider?: string;
  providerConnectionId?: string;
  sender?: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Resolve transport and sender at execution time so a settings change applies
 * without restarting the worker. Production fails closed until a healthy,
 * verified workspace default exists.
 */
export async function resolveWorkspaceDeliveryRuntime(
  pool: Pool,
): Promise<WorkspaceDeliveryRuntime> {
  if (process.env.CASCADE_MAILER_MODE === "e2e") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CASCADE_MAILER_MODE=e2e is forbidden in production.");
    }
    return { mailer: new DeterministicE2eMailer() };
  }

  const configured = await resolveDefaultDeliveryConfiguration(pool);
  if (configured) {
    const mailer = configured.provider === "resend"
      ? new ResendMailer({ apiKey: configured.credentials.apiKey })
      : configured.provider === "sendgrid"
        ? new SendGridMailer({ apiKey: configured.credentials.apiKey })
        : new MailchimpTransactionalMailer({
            apiKey: configured.credentials.apiKey,
          });
    return {
      mailer,
      provider: configured.provider,
      providerConnectionId: configured.providerConnectionId,
      sender: configured.sender,
    };
  }

  if (process.env.NODE_ENV === "production") {
    return {
      mailer: new DisabledMailer(
        "Email delivery is unavailable until Nurture Settings has a connected default provider and verified default sender.",
      ),
    };
  }
  return { mailer: selectMailer() };
}
