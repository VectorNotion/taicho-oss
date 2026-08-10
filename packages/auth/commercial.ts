import {
  estimateAndReserve,
  requireCapability,
  FeatureUnavailableError,
  InsufficientCreditsError,
  SubscriptionInactiveError,
  type CapabilityId,
} from "@content-automation/platform/commercial";
import { getAuthorizationContext } from "./server";

type BackgroundAction = "build_project_graph" | "do_research" | "extract_topics" |
  "refine_content_idea" | "generate_content_ideas" | "generate_content_draft" | "research_prospect" | "qualify_prospect";
type JobCommercialContext = { organizationId: string; initiatingUserId: string; walletUserId: string; creditReservationId: string };

const actionPricing: Record<BackgroundAction, { credits: number; capability: CapabilityId }> = {
  build_project_graph: { credits: 30, capability: "content.full" },
  do_research: { credits: 80, capability: "research" },
  extract_topics: { credits: 40, capability: "research" },
  refine_content_idea: { credits: 30, capability: "content.full" },
  generate_content_ideas: { credits: 50, capability: "content.full" },
  generate_content_draft: { credits: 80, capability: "content.full" },
  research_prospect: { credits: 80, capability: "outreach" },
  qualify_prospect: { credits: 40, capability: "outreach" },
};

export async function reserveBackgroundAction(request: Request, action: BackgroundAction): Promise<{
  commercial: JobCommercialContext;
  estimatedCredits: number;
}> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) throw new Error("Unauthenticated");
  const price = actionPricing[action];
  await requireCapability(context.organizationId, context.session.user.id, price.capability);
  const idempotencyKey = `${context.organizationId}:${context.session.user.id}:${action}:${crypto.randomUUID()}`;
  const reservation = await estimateAndReserve({
    organizationId: context.organizationId,
    initiatingUserId: context.session.user.id,
    action,
    estimatedCredits: price.credits,
    idempotencyKey,
  });
  return {
    estimatedCredits: price.credits,
    commercial: {
      organizationId: context.organizationId,
      initiatingUserId: context.session.user.id,
      walletUserId: String(reservation.wallet_user_id),
      creditReservationId: reservation.id as string,
    },
  };
}

export function commercialErrorResponse(error: unknown) {
  if (error instanceof InsufficientCreditsError) {
    return Response.json({ error: error.message, code: error.code, required: error.required, available: error.available, refreshAt: error.refreshAt }, { status: 402 });
  }
  if (error instanceof FeatureUnavailableError) {
    return Response.json({ error: error.message, code: error.code, capability: error.capability, planId: error.planId }, { status: 403 });
  }
  if (error instanceof SubscriptionInactiveError) {
    return Response.json(
      { error: error.message, code: error.code, status: error.status, periodEnd: error.periodEnd },
      { status: 403 },
    );
  }
  if (error instanceof Error && error.message === "Unauthenticated") return Response.json({ error: error.message }, { status: 401 });
  return null;
}

export async function reserveVariableCost(request: Request, input: { action: string; credits: number; capability: CapabilityId }) {
  const context = await getAuthorizationContext(request.headers);
  if (!context) throw new Error("Unauthenticated");
  await requireCapability(context.organizationId, context.session.user.id, input.capability);
  const reservation = await estimateAndReserve({
    organizationId: context.organizationId, initiatingUserId: context.session.user.id,
    action: input.action, estimatedCredits: input.credits,
    idempotencyKey: `${context.organizationId}:${context.session.user.id}:${input.action}:${crypto.randomUUID()}`,
  });
  return { context, reservationId: reservation.id as string, estimatedCredits: input.credits };
}
