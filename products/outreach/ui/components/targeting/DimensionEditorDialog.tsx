"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type {
  DimensionAppliesTo,
  DimensionDefinition,
  DimensionType,
} from "@/products/outreach/domain/qualification";

const DEFAULT_WEIGHT = "0.2";
const DEFAULT_FRESHNESS = "120";
const DEFAULT_HALF_LIFE = "45";

type FormState = {
  name: string;
  dimensionType: DimensionType;
  researchInstruction: string;
  idealValue: string;
  weight: string;
  freshnessWindowDays: string;
  halfLifeDays: string;
  hardExclusionRule: string;
  isActive: boolean;
};

function emptyForm(): FormState {
  return {
    name: "",
    dimensionType: "fit",
    researchInstruction: "",
    idealValue: "",
    weight: DEFAULT_WEIGHT,
    freshnessWindowDays: DEFAULT_FRESHNESS,
    halfLifeDays: DEFAULT_HALF_LIFE,
    hardExclusionRule: "",
    isActive: true,
  };
}

function toForm(dimension: DimensionDefinition): FormState {
  return {
    name: dimension.name,
    dimensionType: dimension.dimensionType,
    researchInstruction: dimension.researchInstruction,
    idealValue: dimension.idealValue ?? "",
    weight: dimension.weight.toString(),
    freshnessWindowDays: dimension.freshnessWindowDays.toString(),
    halfLifeDays: dimension.halfLifeDays?.toString() ?? DEFAULT_HALF_LIFE,
    hardExclusionRule: dimension.hardExclusionRule ?? "",
    isActive: dimension.isActive,
  };
}

/** "Funding Round" → "funding_round" (snake_case, letter-initial). */
function toKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/g, "");
  return slug || `dimension_${Date.now()}`;
}

export function DimensionEditorDialog({
  open,
  onOpenChange,
  appliesTo,
  dimension,
  onSaved,
  catalogItemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appliesTo: DimensionAppliesTo;
  dimension?: DimensionDefinition | null;
  onSaved: () => void;
  catalogItemId?: string;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(dimension ? toForm(dimension) : emptyForm());
    setErrors({});
    setActionError(null);
  }, [open, dimension]);

  // Persona (prospect) dimensions are always fit; the type control is hidden.
  const dimensionType: DimensionType =
    appliesTo === "account" ? form.dimensionType : "fit";
  const isTiming = dimensionType === "timing";
  const isFit = dimensionType === "fit";
  const isEdit = Boolean(dimension);

  async function submit() {
    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) nextErrors.name = "Enter a dimension name.";
    if (!form.researchInstruction.trim()) {
      nextErrors.researchInstruction = "Describe what researchers should investigate.";
    }
    const weight = Number(form.weight);
    const freshnessWindowDays = Number(form.freshnessWindowDays);
    const halfLifeDays = Number(form.halfLifeDays);
    if (!form.weight.trim() || !Number.isFinite(weight) || weight <= 0 || weight > 1) {
      nextErrors.weight = "Weight must be greater than 0 and at most 1.";
    }
    if (
      !form.freshnessWindowDays.trim()
      || !Number.isInteger(freshnessWindowDays)
      || freshnessWindowDays <= 0
    ) {
      nextErrors.freshnessWindowDays = "Freshness window must be a positive whole number of days.";
    }
    if (
      isTiming
      && (!form.halfLifeDays.trim() || !Number.isInteger(halfLifeDays) || halfLifeDays <= 0)
    ) {
      nextErrors.halfLifeDays = "Half-life must be a positive whole number of days.";
    }
    setErrors(nextErrors);
    setActionError(null);
    if (Object.keys(nextErrors).length > 0) return;

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      dimensionType,
      appliesTo,
      researchInstruction: form.researchInstruction.trim(),
      weight,
      freshnessWindowDays,
      idealValue: isFit && form.idealValue.trim() ? form.idealValue.trim() : undefined,
      hardExclusionRule:
        isFit && form.hardExclusionRule.trim() ? form.hardExclusionRule.trim() : undefined,
      halfLifeDays: isTiming ? halfLifeDays : undefined,
      isActive: form.isActive,
    };
    if (!isEdit) body.key = toKey(form.name);
    if (!isEdit && catalogItemId) body.catalogItemId = catalogItemId;
    if (isEdit) body.expectedRevision = dimension!.revision;

    setSaving(true);
    try {
      if (isEdit) await apiMutate("PATCH", `/outreach/dimensions/${dimension!.id}`, body);
      else await apiMutate("POST", "/outreach/dimensions", body);
      toast.success(isEdit ? "Dimension updated" : "Dimension added");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : "Could not save the dimension. Try again.";
      if (!(error instanceof ApiError)) console.error("Failed to save dimension:", error);
      setActionError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const lensLabel = appliesTo === "account" ? "ICP" : "Persona";

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${dimension!.name}` : `Add ${lensLabel} dimension`}
          </DialogTitle>
          <DialogDescription>
            Define what researchers look for and how findings are scored against your{" "}
            {lensLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="dimension-name">Name</Label>
            <Input
              id="dimension-name"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={appliesTo === "account" ? "Internal AI capability" : "Decision authority"}
              value={form.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {appliesTo === "account" && (
            <div className="grid gap-2">
              <Label htmlFor="dimension-type">Type</Label>
              <Select
                onValueChange={(value) =>
                  setForm({ ...form, dimensionType: value as DimensionType })
                }
                value={form.dimensionType}
              >
                <SelectTrigger id="dimension-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fit">Fit — gates qualification</SelectItem>
                  <SelectItem value="timing">Timing — ranks by recency</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="dimension-instruction">Research instruction</Label>
            <Textarea
              id="dimension-instruction"
              onChange={(event) =>
                setForm({ ...form, researchInstruction: event.target.value })
              }
              placeholder="What should the research system investigate for this dimension?"
              rows={3}
              value={form.researchInstruction}
            />
            {errors.researchInstruction && (
              <p className="text-xs text-destructive">{errors.researchInstruction}</p>
            )}
          </div>

          {isFit && (
            <div className="grid gap-2">
              <Label htmlFor="dimension-ideal">Ideal value</Label>
              <Textarea
                id="dimension-ideal"
                onChange={(event) => setForm({ ...form, idealValue: event.target.value })}
                placeholder="What a strong match looks like."
                rows={2}
                value={form.idealValue}
              />
              <p className="text-xs text-muted-foreground">
                Findings are scored by how closely they match this. Optional.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="dimension-weight">Weight</Label>
              <Input
                id="dimension-weight"
                max="1"
                min="0"
                onChange={(event) => setForm({ ...form, weight: event.target.value })}
                step="0.05"
                type="number"
                value={form.weight}
              />
              <p className="text-xs text-muted-foreground">Relative weight, 0–1.</p>
              {errors.weight && <p className="text-xs text-destructive">{errors.weight}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dimension-freshness">Freshness window (days)</Label>
              <Input
                id="dimension-freshness"
                min="1"
                onChange={(event) =>
                  setForm({ ...form, freshnessWindowDays: event.target.value })
                }
                type="number"
                value={form.freshnessWindowDays}
              />
              <p className="text-xs text-muted-foreground">
                Days before a finding is re-researched.
              </p>
              {errors.freshnessWindowDays && (
                <p className="text-xs text-destructive">{errors.freshnessWindowDays}</p>
              )}
            </div>
          </div>

          {isTiming && (
            <div className="grid gap-2">
              <Label htmlFor="dimension-halflife">Half-life (days)</Label>
              <Input
                id="dimension-halflife"
                min="1"
                onChange={(event) => setForm({ ...form, halfLifeDays: event.target.value })}
                type="number"
                value={form.halfLifeDays}
              />
              <p className="text-xs text-muted-foreground">
                How fast a timing signal decays in the ranking.
              </p>
              {errors.halfLifeDays && (
                <p className="text-xs text-destructive">{errors.halfLifeDays}</p>
              )}
            </div>
          )}

          {isFit && (
            <div className="grid gap-2">
              <Label htmlFor="dimension-exclusion">Hard-exclusion rule</Label>
              <Textarea
                id="dimension-exclusion"
                onChange={(event) =>
                  setForm({ ...form, hardExclusionRule: event.target.value })
                }
                placeholder="A deterministic pass/fail rule that disqualifies outright. Optional."
                rows={2}
                value={form.hardExclusionRule}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Switch
              checked={form.isActive}
              id="dimension-active"
              onCheckedChange={(isActive) => setForm({ ...form, isActive })}
            />
            <div>
              <Label htmlFor="dimension-active">Active for qualification</Label>
              <p className="text-xs text-muted-foreground">
                Inactive dimensions stay configured but are excluded from new qualification runs.
              </p>
            </div>
          </div>

          {actionError && (
            <p className="text-sm text-destructive" role="alert">{actionError}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={saving}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add dimension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
