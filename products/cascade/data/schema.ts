import {
  assetsInCascade,
  cascade_settingsInCascade,
  contactsInCascade,
  contentInCascade,
  databaseFor,
  delivery_domainsInCascade,
  delivery_provider_connectionsInCascade,
  delivery_sender_identitiesInCascade,
  emailsInCascade,
  enrollmentsInCascade,
  eventsInCascade,
  funnel_routesInCascade,
  funnel_stepsInCascade,
  funnelsInCascade,
  offersInCascade,
  sendsInCascade,
  stage_daily_statsInCascade,
  templatesInCascade,
  variant_statsInCascade,
  variantsInCascade,
  webhook_receiptsInCascade,
} from "@content-automation/database";
import { isNull, sql } from "drizzle-orm";
import type { Pool } from "pg";

/** Cascade tables are provisioned exclusively by the root Drizzle migrations. */
export async function ensureCascadeSchema(_pool: Pool): Promise<void> {
  return Promise.resolve();
}

/** Explicitly assign pre-tenancy rows. Never call this based on request context. */
export async function assignLegacyCascadeData(pool: Pool, organizationId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(organizationId)) throw new Error("Invalid organization ID.");
  await databaseFor(pool).transaction(async (tx) => {
    await tx.execute(sql`set local row_security = off`);
    await tx.update(funnelsInCascade).set({ organization_id: organizationId }).where(isNull(funnelsInCascade.organization_id));
    await tx.update(funnel_stepsInCascade).set({ organization_id: organizationId }).where(isNull(funnel_stepsInCascade.organization_id));
    await tx.update(contactsInCascade).set({ organization_id: organizationId }).where(isNull(contactsInCascade.organization_id));
    await tx.update(enrollmentsInCascade).set({ organization_id: organizationId }).where(isNull(enrollmentsInCascade.organization_id));
    await tx.update(sendsInCascade).set({ organization_id: organizationId }).where(isNull(sendsInCascade.organization_id));
    await tx.update(templatesInCascade).set({ organization_id: organizationId }).where(isNull(templatesInCascade.organization_id));
    await tx.update(contentInCascade).set({ organization_id: organizationId }).where(isNull(contentInCascade.organization_id));
    await tx.update(emailsInCascade).set({ organization_id: organizationId }).where(isNull(emailsInCascade.organization_id));
    await tx.update(funnel_routesInCascade).set({ organization_id: organizationId }).where(isNull(funnel_routesInCascade.organization_id));
    await tx.update(assetsInCascade).set({ organization_id: organizationId }).where(isNull(assetsInCascade.organization_id));
    await tx.update(stage_daily_statsInCascade).set({ organization_id: organizationId }).where(isNull(stage_daily_statsInCascade.organization_id));
    await tx.update(variantsInCascade).set({ organization_id: organizationId }).where(isNull(variantsInCascade.organization_id));
    await tx.update(variant_statsInCascade).set({ organization_id: organizationId }).where(isNull(variant_statsInCascade.organization_id));
    await tx.update(offersInCascade).set({ organization_id: organizationId }).where(isNull(offersInCascade.organization_id));
    await tx.update(cascade_settingsInCascade).set({ organization_id: organizationId }).where(isNull(cascade_settingsInCascade.organization_id));
    await tx.update(eventsInCascade).set({ organization_id: organizationId }).where(isNull(eventsInCascade.organization_id));
    await tx.update(webhook_receiptsInCascade).set({ organization_id: organizationId }).where(isNull(webhook_receiptsInCascade.organization_id));
    await tx.update(delivery_provider_connectionsInCascade).set({ organization_id: organizationId }).where(isNull(delivery_provider_connectionsInCascade.organization_id));
    await tx.update(delivery_domainsInCascade).set({ organization_id: organizationId }).where(isNull(delivery_domainsInCascade.organization_id));
    await tx.update(delivery_sender_identitiesInCascade).set({ organization_id: organizationId }).where(isNull(delivery_sender_identitiesInCascade.organization_id));
  });
}

export async function dropCascadeSchema(_pool: Pool): Promise<void> {
  return Promise.resolve();
}
