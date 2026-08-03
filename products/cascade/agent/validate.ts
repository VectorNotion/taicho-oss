import mjml2html from "mjml";
import { assetsInCascade, databaseFor, offersInCascade, variantsInCascade } from "@content-automation/database";
import { eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import { getEmailBundle } from "../data/email-repository";
import { activateVariant, getSetting, markRejected, markValidated } from "../data/variant-repository";

const ASSET_REF = /\{\{\{?assets\.\[?([^\].}]+)\]?\./g;
const CLAIM_PATTERN = /\b\d+\s?%\s?(?:off|discount)|\bfree\b|\$\d+/gi;

/**
 * The hallucination gate (non-negotiable per docs/closed-loop.md): a variant
 * becomes send-eligible only after its asset references resolve, its offer
 * claims match the offers source of truth, and its template compiles.
 */
export async function validateVariant(pool: Pool, variantId: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  const db = databaseFor(pool);
  const [variant] = await db
    .select({ emailId: variantsInCascade.email_id, status: variantsInCascade.status })
    .from(variantsInCascade)
    .where(eq(variantsInCascade.id, variantId))
    .limit(1);
  if (!variant) return { ok: false, errors: [`variant ${variantId} not found`] };
  if (variant.status !== "draft") {
    return {
      ok: false,
      errors: [`variant ${variantId} is '${variant.status}', only draft variants can validate`],
    };
  }

  const bundle = await getEmailBundle(pool, variant.emailId);
  if (!bundle) {
    await markRejected(pool, variantId, "email bundle missing");
    return { ok: false, errors: ["email bundle missing"] };
  }

  const textCorpus = [bundle.subject, bundle.preheader ?? "", ...Object.values(bundle.slots)].join("\n");

  // 1. Asset references must resolve to synced assets.
  const referenced = [...textCorpus.matchAll(ASSET_REF)].map((m) => m[1]);
  if (referenced.length > 0) {
    const known = await db
      .select({ sourceId: assetsInCascade.source_id })
      .from(assetsInCascade)
      .where(inArray(assetsInCascade.source_id, referenced));
    const knownSet = new Set(known.map((r) => r.sourceId));
    for (const ref of new Set(referenced)) {
      if (!knownSet.has(ref)) errors.push(`asset reference does not resolve: ${ref}`);
    }
  }

  // 2. Offer claims must be backed by an active offer in the source of truth.
  const claims = textCorpus.match(CLAIM_PATTERN) ?? [];
  if (claims.length > 0) {
    const offers = await db
      .select({ claim: offersInCascade.claim })
      .from(offersInCascade)
      .where(eq(offersInCascade.active, true));
    const claimCorpus = offers.map((r) => r.claim.toLowerCase()).join("\n");
    for (const claim of new Set(claims.map((c) => c.trim().toLowerCase()))) {
      if (!claimCorpus.includes(claim)) errors.push(`unbacked offer claim: "${claim}"`);
    }
  }

  // 3. The template must compile and carry an unsubscribe path.
  try {
    const compiled = await mjml2html(bundle.templateMjml, { validationLevel: "soft" });
    const hasUnsub = bundle.templateMjml.includes("{{{unsubscribeUrl}}}") || compiled.html.includes("/u/");
    if (!hasUnsub) errors.push("email design has no unsubscribe link");
  } catch (err) {
    errors.push(`email design does not compile: ${err instanceof Error ? err.message : err}`);
  }

  if (errors.length > 0) {
    await markRejected(pool, variantId, errors.join("; "));
    return { ok: false, errors };
  }
  await markValidated(pool, variantId);
  return { ok: true, errors: [] };
}

/** Human approval: validated -> active (arm cap enforced by activateVariant). */
export async function approveVariant(pool: Pool, variantId: string): Promise<void> {
  await activateVariant(pool, variantId);
}

/**
 * The autonomy dial. Under "approve_all" (default) validated variants wait
 * for a human; under "auto_activate" the loop may activate them itself.
 */
export async function maybeAutoActivate(pool: Pool, variantId: string): Promise<boolean> {
  const autonomy = await getSetting(pool, "autonomy", "approve_all");
  if (autonomy !== "auto_activate") return false;
  await activateVariant(pool, variantId);
  return true;
}
