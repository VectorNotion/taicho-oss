import {
  capabilityIds,
  type CapabilityId,
  type CommercialSummary,
  type PlanCatalogEntry,
  type UsageKind,
  type WalletSummary,
} from "./contract";
import { emptyAgentUsageSummary, type AgentUsageSummary } from "./agent-usage";

/**
 * The billing seam. Open-core code talks to billing exclusively through this
 * interface; it never imports the commercial implementation. The default
 * provider is unmetered (everything allowed, reservations are free no-ops),
 * which is the self-hosted behavior. The commercial deployment replaces it at
 * process boot via `setCommercialProvider` (see
 * `@content-automation/commerce/register`).
 */
export interface CommercialProvider {
  getCommercialSummary(organizationId: string, userId: string): Promise<CommercialSummary>;
  requireCapability(
    organizationId: string,
    userId: string,
    capability: CapabilityId,
  ): Promise<CommercialSummary>;
  estimateAndReserve(input: {
    organizationId: string;
    initiatingUserId: string;
    action: string;
    estimatedCredits: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; wallet_user_id: string | null }>;
  settleReservation(input: {
    reservationId: string;
    actualCredits: number;
    usageKind?: UsageKind;
    provider?: string;
    model?: string;
    measuredUnits?: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  releaseReservation(reservationId: string, reason?: string): Promise<void>;
  summarizeAgentUsage(
    organizationId: string,
    options?: { days?: number },
  ): Promise<AgentUsageSummary>;
  isPlatformOperator(email: string): boolean;
  provisionCommercialOrganization(organizationId: string, userId: string): Promise<unknown>;
}

const UNMETERED_CREDITS = 1_000_000_000;

const unmeteredPlan: PlanCatalogEntry = {
  id: "self-hosted",
  payloadPlanId: "self-hosted",
  payloadUpdatedAt: new Date(0).toISOString(),
  name: "Self-hosted",
  description: "Unmetered self-hosted deployment.",
  displayPrice: "Free",
  amountMinor: 0,
  currency: "USD",
  billingInterval: null,
  intervalCount: null,
  billingModel: "trial",
  includedCredits: UNMETERED_CREDITS,
  creditOwner: "organization",
  creditCadence: "none",
  trialDays: null,
  capabilities: [...capabilityIds],
  perUser: false,
  perSeat: false,
  contactSales: false,
  selfServe: true,
  callToActionLabel: null,
  highlighted: false,
  sortOrder: 0,
  providerPlanId: null,
  existingSubscriberPolicy: "cycle-end",
};

function unmeteredWallet(userId: string): WalletSummary {
  return {
    walletId: "self-hosted",
    userId,
    creditOwner: "organization",
    available: UNMETERED_CREDITS,
    included: UNMETERED_CREDITS,
    purchased: 0,
    reserved: 0,
    overdraftLimit: 0,
    nextRefreshAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export class UnmeteredCommercialProvider implements CommercialProvider {
  async getCommercialSummary(organizationId: string, userId: string): Promise<CommercialSummary> {
    const now = new Date();
    return {
      organizationId,
      generatedAt: now.toISOString(),
      plan: unmeteredPlan,
      subscriptionStatus: "active",
      commerciallyActive: true,
      seatCount: 1,
      periodStart: new Date(0).toISOString(),
      periodEnd: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      wallet: unmeteredWallet(userId),
    };
  }

  async requireCapability(organizationId: string, userId: string): Promise<CommercialSummary> {
    return this.getCommercialSummary(organizationId, userId);
  }

  async estimateAndReserve(input: { initiatingUserId: string }) {
    // Must be a bare UUID: it lands in the uuid `credit_reservation_id` column on
    // jobs. settle/release are no-ops here and nothing reads the id, so no marker.
    return { id: crypto.randomUUID(), wallet_user_id: input.initiatingUserId };
  }

  async settleReservation() {
    return undefined;
  }

  async releaseReservation() {}

  async summarizeAgentUsage(_organizationId: string, options?: { days?: number }) {
    return emptyAgentUsageSummary(options?.days ?? 30);
  }

  isPlatformOperator() {
    return false;
  }

  async provisionCommercialOrganization() {
    return undefined;
  }
}

// Next.js can evaluate this module in more than one server bundle inside the
// same process. Module-local state lets one bundle install metered billing
// while a background reconciler imported by another bundle silently keeps the
// unmetered default. Store the provider on the process-wide symbol registry so
// request handlers and reconcilers always settle/release the same reservations.
const commercialProviderKey = Symbol.for("content-automation.commercial-provider");

function providerRegistry(): Record<symbol, CommercialProvider | undefined> {
  return globalThis as typeof globalThis & Record<symbol, CommercialProvider | undefined>;
}

export function setCommercialProvider(provider: CommercialProvider) {
  providerRegistry()[commercialProviderKey] = provider;
}

export function commercialProvider(): CommercialProvider {
  const registry = providerRegistry();
  return registry[commercialProviderKey] ??= new UnmeteredCommercialProvider();
}

// Drop-in delegates matching the historical `@content-automation/commerce/server`
// signatures, so call sites swap an import path and nothing else.
export const getCommercialSummary: CommercialProvider["getCommercialSummary"] = (...args) =>
  commercialProvider().getCommercialSummary(...args);
export const requireCapability: CommercialProvider["requireCapability"] = (...args) =>
  commercialProvider().requireCapability(...args);
export const estimateAndReserve: CommercialProvider["estimateAndReserve"] = (...args) =>
  commercialProvider().estimateAndReserve(...args);
export const settleReservation: CommercialProvider["settleReservation"] = (...args) =>
  commercialProvider().settleReservation(...args);
export const releaseReservation: CommercialProvider["releaseReservation"] = (...args) =>
  commercialProvider().releaseReservation(...args);
export const summarizeAgentUsage: CommercialProvider["summarizeAgentUsage"] = (organizationId, options) => {
  const provider = commercialProvider();
  if (typeof provider.summarizeAgentUsage !== "function") {
    return Promise.resolve(emptyAgentUsageSummary(options?.days ?? 30));
  }
  return provider.summarizeAgentUsage(organizationId, options);
};
export const isPlatformOperator: CommercialProvider["isPlatformOperator"] = (...args) =>
  commercialProvider().isPlatformOperator(...args);
export const provisionCommercialOrganization: CommercialProvider["provisionCommercialOrganization"] = (
  ...args
) => commercialProvider().provisionCommercialOrganization(...args);
