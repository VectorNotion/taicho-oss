"use client";

import { useCallback, useEffect, useState } from "react";
import { Crosshair, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  DimensionAppliesTo,
  DimensionDefinition,
} from "@/products/outreach/domain/qualification";
import { DimensionEditorDialog } from "./DimensionEditorDialog";

const LENSES: {
  value: DimensionAppliesTo;
  tab: string;
  noun: string;
}[] = [
  { value: "account", tab: "ICP", noun: "ICP" },
  { value: "prospect", tab: "Persona", noun: "Persona" },
];

function dimensionMeta(dimension: DimensionDefinition): string[] {
  return [
    `weight ${dimension.weight}`,
    `freshness ${dimension.freshnessWindowDays}d`,
    ...(dimension.halfLifeDays ? [`half-life ${dimension.halfLifeDays}d`] : []),
    ...(dimension.hardExclusionRule ? ["hard exclusion"] : []),
    ...(dimension.isActive ? [] : ["inactive"]),
  ];
}

function LensPanel({ appliesTo, noun }: { appliesTo: DimensionAppliesTo; noun: string }) {
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
          `/api/outreach/dimensions?appliesTo=${appliesTo}`,
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
    [appliesTo],
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
                actions={[
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
                  <Badge variant={dimension.dimensionType === "timing" ? "secondary" : "outline"}>
                    {dimension.dimensionType}
                  </Badge>
                }
                key={dimension.id}
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
  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        description="Define who's worth pursuing: your ICP (the right company) and Persona (the right person). Researchers hunt for these; every finding is scored against them."
        title="Targeting"
      />

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
            <LensPanel appliesTo={lens.value} noun={lens.noun} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
