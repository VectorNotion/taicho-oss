"use client";

import { useCallback, useEffect, useState } from "react";
import { Crosshair, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import { SegmentMeter } from "@/components/genui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  DimensionAppliesTo,
  DimensionDefinition,
} from "@/products/outreach/domain/qualification";
import type { CatalogItem } from "@/products/outreach/domain/catalog";
import { DimensionEditorDialog } from "./DimensionEditorDialog";

const LENSES: {
  value: DimensionAppliesTo;
  tab: string;
  noun: string;
}[] = [
  { value: "account", tab: "ICP", noun: "ICP" },
  { value: "prospect", tab: "Persona", noun: "Persona" },
];

/** Secondary facts for a dimension row — the weight now lives in the visual
 * indicator, so this line carries the freshness/decay/exclusion detail only. */
function dimensionMeta(dimension: DimensionDefinition): string[] {
  return [
    `freshness ${dimension.freshnessWindowDays}d`,
    ...(dimension.halfLifeDays ? [`half-life ${dimension.halfLifeDays}d`] : []),
    ...(dimension.hardExclusionRule ? ["hard exclusion"] : []),
    ...(dimension.isActive ? [] : ["inactive"]),
  ];
}

type WeightStat = { total: number; max: number };

/**
 * A dimension's pull on its score, made visible. `fit` and `timing` are scored
 * independently (fit gates, timing ranks), so the share and the bar are both
 * computed within the dimension's own type group: the bar fills relative to the
 * heaviest dimension of that type, and the caption states the exact share of
 * that group's weight ("18% of timing"). Fixed width so the indicators line up
 * into a scannable column.
 */
function WeightIndicator({
  weight,
  stats,
  typeLabel,
  inactive,
}: {
  weight: number;
  stats: WeightStat | undefined;
  typeLabel: string;
  inactive: boolean;
}) {
  const max = stats?.max ?? 0;
  const total = stats?.total ?? 0;
  const relative = max > 0 ? weight / max : 0;
  const share = total > 0 ? Math.round((weight / total) * 100) : 0;
  return (
    <div className={`shrink-0 ${inactive ? "opacity-40" : ""}`}>
      <SegmentMeter fraction={relative} />
      <div className="mt-1 text-[11px] leading-tight tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">{share}%</span> of {typeLabel}
      </div>
    </div>
  );
}

function LensPanel({ appliesTo, noun, catalogItemId }: { appliesTo: DimensionAppliesTo; noun: string; catalogItemId?: string }) {
  const [dimensions, setDimensions] = useState<DimensionDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DimensionDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DimensionDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/outreach/dimensions?appliesTo=${appliesTo}${catalogItemId ? `&catalogItemId=${encodeURIComponent(catalogItemId)}` : ""}`,
          { signal },
        );
        if (!response.ok) throw new Error("Failed to fetch dimensions");
        const data: DimensionDefinition[] = await response.json();
        if (!signal?.aborted) setDimensions(data);
      } catch (error) {
        if (signal?.aborted) return;
        console.error("Failed to load dimensions:", error);
        toast.error("Could not load dimensions. Refresh to try again.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [appliesTo, catalogItemId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function startCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function startEdit(dimension: DimensionDefinition) {
    setEditing(dimension);
    setEditorOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/outreach/dimensions/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete dimension");
      setDimensions((items) => items.filter((item) => item.id !== deleteTarget.id));
      toast.success("Dimension deleted");
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete dimension:", error);
      toast.error("Could not delete the dimension. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  const addButton = (
    <Button onClick={startCreate}>
      <Plus className="h-4 w-4" />
      Add dimension
    </Button>
  );

  // Weight share and bar scale are per scoring group: fit and timing are
  // separate scores, so a dimension's weight is measured against its own type.
  const weightStats = new Map<string, WeightStat>();
  for (const dimension of dimensions) {
    if (!dimension.isActive) continue;
    const stat = weightStats.get(dimension.dimensionType) ?? { total: 0, max: 0 };
    stat.total += dimension.weight;
    stat.max = Math.max(stat.max, dimension.weight);
    weightStats.set(dimension.dimensionType, stat);
  }
  const mixedTypes = new Set(dimensions.map((d) => d.dimensionType)).size > 1;

  return (
    <div className="space-y-6">
      <ListCard
        actions={loading || dimensions.length === 0 ? undefined : addButton}
        description={`Criteria researchers hunt for and score every ${noun} finding against.`}
        title={`${noun} dimensions`}
      >
        {loading ? (
          <ListRows>
            {Array.from({ length: 5 }).map((_, index) => (
              <li className="flex items-center gap-4 px-6 py-3.5" key={index}>
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-8 w-8 rounded-md" />
              </li>
            ))}
          </ListRows>
        ) : dimensions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Crosshair className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No {noun} dimensions yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add the criteria researchers should look for.
              </p>
            </div>
            <Button onClick={startCreate} variant="outline">
              <Plus className="h-4 w-4" />
              Add dimension
            </Button>
          </div>
        ) : (
          <ListRows>
            {dimensions.map((dimension) => (
              <ListRow
                actions={catalogItemId && !dimension.catalogItemId ? [] : [
                    {
                      icon: Pencil,
                      label: `Edit ${dimension.name}`,
                      onSelect: () => startEdit(dimension),
                    },
                    {
                      destructive: true,
                      icon: Trash2,
                      label: `Delete ${dimension.name}`,
                      onSelect: () => setDeleteTarget(dimension),
                    },
                  ]}
                badge={
                  <span className="flex gap-1.5">
                    {catalogItemId && !dimension.catalogItemId ? <Badge variant="outline">Workspace default</Badge> : null}
                    {mixedTypes ? <Badge variant={dimension.dimensionType === "timing" ? "secondary" : "outline"}>{dimension.dimensionType}</Badge> : null}
                  </span>
                }
                key={dimension.id}
                leading={
                  <WeightIndicator
                    inactive={!dimension.isActive}
                    stats={weightStats.get(dimension.dimensionType)}
                    typeLabel={dimension.dimensionType}
                    weight={dimension.weight}
                  />
                }
                meta={dimensionMeta(dimension)}
                title={dimension.name}
              />
            ))}
          </ListRows>
        )}
      </ListCard>

      <DimensionEditorDialog
        appliesTo={appliesTo}
        dimension={editing}
        onOpenChange={setEditorOpen}
        onSaved={() => void load()}
        open={editorOpen}
        catalogItemId={catalogItemId}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete dimension?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will no longer be researched or scored
              against. Findings already recorded for it stay on their entities but are no
              longer counted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deleting}
              onClick={() => void confirmDelete()}
              variant="destructive"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TargetingPageClient() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogItemId, setCatalogItemId] = useState("workspace");

  useEffect(() => {
    void fetch("/api/outreach/catalog?active=true")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((items: CatalogItem[]) => setCatalog(items))
      .catch(() => undefined);
  }, []);

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        description="Define who's worth pursuing: your ICP (the right company) and Persona (the right person). Researchers hunt for these; every finding is scored against them."
        title="Targeting"
      />

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Targeting for</span>
        <Select value={catalogItemId} onValueChange={setCatalogItemId}>
          <SelectTrigger className="w-72" aria-label="Choose Catalog context"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="workspace">Workspace defaults</SelectItem>
            {catalog.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {catalogItemId !== "workspace" ? (
        <p className="text-sm text-muted-foreground">
          Workspace defaults are inherited read-only; dimensions added here apply only to this Catalog item.
        </p>
      ) : null}

      <Tabs className="space-y-6" defaultValue="account">
        <TabsList>
          {LENSES.map((lens) => (
            <TabsTrigger key={lens.value} value={lens.value}>
              {lens.tab}
            </TabsTrigger>
          ))}
        </TabsList>
        {LENSES.map((lens) => (
          <TabsContent key={lens.value} value={lens.value}>
            <LensPanel appliesTo={lens.value} noun={lens.noun} catalogItemId={catalogItemId === "workspace" ? undefined : catalogItemId} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
