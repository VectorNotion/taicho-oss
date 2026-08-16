import {
  combineContentInsightProviders,
  type ContentInsightFeed,
} from "@/products/content-generator/domain/content-insight";
import { getOutreachContentInsights } from "@/products/outreach/services/content-insights";

/** App-level provider registry. Future Content modules append providers here. */
export async function getCurrentContentInsightFeed(): Promise<ContentInsightFeed> {
  const outreach = await getOutreachContentInsights();
  return combineContentInsightProviders([outreach]);
}
