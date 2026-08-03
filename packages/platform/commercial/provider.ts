import {
  capabilityIds,
  type CapabilityId,
  type CommercialSummary,
  type PlanCatalogEntry,
  type UsageKind,
  type WalletSummary,
} from "./contract";

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
    return { id: `unmetered-${crypto.randomUUID()}`, wallet_user_id: input.initiatingUserId };
  }

  async settleReservation() {
    return undefined;
  }

  async releaseReservation() {}

  isPlatformOperator() {
    return false;
  }

  async provisionCommercialOrganization() {
    return undefined;
  }
}

let activeProvider: CommercialProvider = new UnmeteredCommercialProvider();

export function setCommercialProvider(provider: CommercialProvider) {
  activeProvider = provider;
}

export function commercialProvider(): CommercialProvider {
  return activeProvider;
}

// Drop-in delegates matching the historical `@content-automation/commerce/server`
// signatures, so call sites swap an import path and nothing else.
export const getCommercialSummary: CommercialProvider["getCommercialSummary"] = (...args) =>
  activeProvider.getCommercialSummary(...args);
export const requireCapability: CommercialProvider["requireCapability"] = (...args) =>
  activeProvider.requireCapability(...args);
export const estimateAndReserve: CommercialProvider["estimateAndReserve"] = (...args) =>
  activeProvider.estimateAndReserve(...args);
export const settleReservation: CommercialProvider["settleReservation"] = (...args) =>
  activeProvider.settleReservation(...args);
export const releaseReservation: CommercialProvider["releaseReservation"] = (...args) =>
  activeProvider.releaseReservation(...args);
export const isPlatformOperator: CommercialProvider["isPlatformOperator"] = (...args) =>
  activeProvider.isPlatformOperator(...args);
export const provisionCommercialOrganization: CommercialProvider["provisionCommercialOrganization"] = (
  ...args
) => activeProvider.provisionCommercialOrganization(...args);
