export type CatalogItemKind =
  | "product"
  | "service"
  | "subscription"
  | "retainer"
  | "bundle"
  | "other";

export type CatalogItemStatus = "active" | "archived";

export interface CatalogItem {
  id: string;
  name: string;
  kind: CatalogItemKind;
  summary: string;
  positioning: string;
  outcomes: string;
  differentiators: string;
  proof: string;
  researchGuidance: string;
  voice: string;
  status: CatalogItemStatus;
  createdAt: string;
  updatedAt: string;
}

export type CreateCatalogItemInput = Omit<CatalogItem, "id" | "createdAt" | "updatedAt">;
export type UpdateCatalogItemInput = Partial<CreateCatalogItemInput>;

/** Stable text passed to research and generation. Empty fields are omitted. */
export function catalogItemContext(item: CatalogItem | null | undefined): string {
  if (!item) return "";
  return [
    `Catalog item: ${item.name} (${item.kind})`,
    item.summary && `What is sold: ${item.summary}`,
    item.positioning && `Positioning: ${item.positioning}`,
    item.outcomes && `Customer outcomes: ${item.outcomes}`,
    item.differentiators && `Differentiators: ${item.differentiators}`,
    item.proof && `Proof: ${item.proof}`,
    item.researchGuidance && `Research guidance: ${item.researchGuidance}`,
    item.voice && `Catalog-specific voice: ${item.voice}`,
  ].filter(Boolean).join("\n");
}
