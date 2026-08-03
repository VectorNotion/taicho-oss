/**
 * Commercial vocabulary shared by every workspace. This module is the single
 * source for plan/capability/usage types and the typed errors that cross the
 * billing seam. It must not import from any package so that both the open
 * core and the commercial implementation can depend on it.
 */

export type PlanId = string;

export type BillingModel = "trial" | "per-user" | "per-seat" | "contact-sales";
export type CreditOwner = "user" | "organization";
export type CreditCadence = "trial" | "billing-period" | "none";

export const capabilityIds = [
  // `squad` remains parseable for already-versioned plan snapshots, but grants
  // no route, MCP tool, package, or Chat behavior.
  "content.basic", "ai.basic", "content.full", "content.publish", "research",
  "outreach", "cascade", "brain", "squad", "team.admin",
] as const;
export type CapabilityId = (typeof capabilityIds)[number];

export type UsageKind =
  | "model_input" | "model_output" | "model_reasoning" | "embedding"
  | "web_search" | "email_delivery" | "publishing" | "agent_action";
export type CreditSource = "included" | "purchased" | "adjustment" | "weekly_grant";
export type SubscriptionStatus = "active" | "expired" | "cancelled";

export type PlanCatalogEntry = {
  id: PlanId;
  payloadPlanId: string;
  payloadUpdatedAt: string;
  name: string;
  description: string;
  displayPrice: string;
  amountMinor: number;
  currency: string;
  billingInterval: "month" | "year" | null;
  intervalCount: number | null;
  billingModel: BillingModel;
  includedCredits: number;
  creditOwner: CreditOwner;
  creditCadence: CreditCadence;
  trialDays: number | null;
  capabilities: CapabilityId[];
  perUser: boolean;
  perSeat: boolean;
  contactSales: boolean;
  selfServe: boolean;
  callToActionLabel: string | null;
  highlighted: boolean;
  sortOrder: number;
  providerPlanId: string | null;
  existingSubscriberPolicy: "cycle-end" | "new-customers-only";
};

export type WalletSummary = {
  walletId: string;
  userId: string;
  creditOwner: CreditOwner;
  available: number;
  included: number;
  purchased: number;
  reserved: number;
  overdraftLimit: number;
  nextRefreshAt: string;
};

export type CommercialSummary = {
  organizationId: string;
  generatedAt: string;
  plan: PlanCatalogEntry;
  subscriptionStatus: SubscriptionStatus;
  commerciallyActive: boolean;
  seatCount: number;
  periodStart: string;
  periodEnd: string;
  wallet: WalletSummary;
};

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(readonly required: number, readonly available: number, readonly refreshAt: string) {
    super(`This action needs ${required} credits; ${available} are available.`);
  }
}

export class FeatureUnavailableError extends Error {
  readonly code = "FEATURE_UNAVAILABLE";
  constructor(readonly capability: CapabilityId, readonly planId: PlanId) {
    super(`${capability} is not available on the ${planId} plan.`);
  }
}

export class SubscriptionInactiveError extends Error {
  readonly code = "SUBSCRIPTION_INACTIVE";
  constructor(
    readonly status: Exclude<SubscriptionStatus, "active">,
    readonly periodEnd: string,
  ) {
    super(
      status === "expired"
        ? "This user subscription has expired."
        : "This user subscription is cancelled.",
    );
  }
}
