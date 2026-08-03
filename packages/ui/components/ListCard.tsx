import { Card } from "./ui/card";

/**
 * The §8 list-surface wrapper. Owns the anatomy every table card must share:
 * - no baked-in Card padding (the stock Card's py-6 with a p-0 content area
 *   produces lopsided vertical-only padding — the exact defect this fixes)
 * - optional header band (px-6) separated from the table by a border
 * - full-bleed table whose first/last column gutters align with the header
 *   text at 24px, last row borderless so it meets the card edge cleanly
 */
export function ListCard({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {title && (
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-none">{title}</h3>
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className="[&_tbody_tr:last-child]:border-0 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
        {children}
      </div>
    </Card>
  );
}
