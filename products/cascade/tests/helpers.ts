process.env.CASCADE_SCHEMA = "cascade";

import {
  assetsInCascade,
  cascade_settingsInCascade as cascadeSettingsInCascade,
  contactsInCascade,
  contentInCascade,
  databaseFor,
  delivery_domainsInCascade as deliveryDomainsInCascade,
  delivery_provider_connectionsInCascade as deliveryProviderConnectionsInCascade,
  delivery_sender_identitiesInCascade as deliverySenderIdentitiesInCascade,
  emailsInCascade,
  enrollmentsInCascade,
  eventsInCascade,
  funnel_routesInCascade as funnelRoutesInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  funnelsInCascade,
  offersInCascade,
  sendsInCascade,
  stage_daily_statsInCascade as stageDailyStatsInCascade,
  templatesInCascade,
  variant_statsInCascade as variantStatsInCascade,
  variantsInCascade,
  webhook_receiptsInCascade as webhookReceiptsInCascade,
} from "@content-automation/database";
import type { Pool } from "pg";
import { getCascadePool } from "../data/pool";

/** Reset data without mutating migration-owned database structure. */
export async function freshSchema(): Promise<Pool> {
  const pool = getCascadePool();
  await databaseFor(pool).transaction(async (tx) => {
    await tx.delete(webhookReceiptsInCascade);
    await tx.delete(eventsInCascade);
    await tx.delete(variantStatsInCascade);
    await tx.delete(stageDailyStatsInCascade);
    await tx.delete(sendsInCascade);
    await tx.delete(enrollmentsInCascade);
    await tx.delete(funnelRoutesInCascade);
    await tx.delete(variantsInCascade);
    await tx.delete(emailsInCascade);
    await tx.delete(deliverySenderIdentitiesInCascade);
    await tx.delete(deliveryDomainsInCascade);
    await tx.delete(deliveryProviderConnectionsInCascade);
    await tx.delete(assetsInCascade);
    await tx.delete(offersInCascade);
    await tx.delete(contentInCascade);
    await tx.delete(funnelStepsInCascade);
    await tx.delete(funnelsInCascade);
    await tx.delete(contactsInCascade);
    await tx.delete(templatesInCascade);
    await tx.delete(cascadeSettingsInCascade);
  });
  return pool;
}
