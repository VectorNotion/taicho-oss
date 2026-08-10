"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appliesTo: DimensionAppliesTo;
  dimension?: DimensionDefinition | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(dimension ? toForm(dimension) : emptyForm());
    setErrors({});
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
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const weight = Number(form.weight);
    const freshnessWindowDays = Number(form.freshnessWindowDays);
    const halfLifeDays = Number(form.halfLifeDays);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      dimensionType,
      appliesTo,
      researchInstruction: form.researchInstruction.trim(),
      weight: Number.isFinite(weight) && weight > 0 ? weight : Number(DEFAULT_WEIGHT),
      freshnessWindowDays:
        Number.isFinite(freshnessWindowDays) && freshnessWindowDays > 0
          ? freshnessWindowDays
          : Number(DEFAULT_FRESHNESS),
      idealValue: isFit && form.idealValue.trim() ? form.idealValue.trim() : undefined,
      hardExclusionRule:
        isFit && form.hardExclusionRule.trim() ? form.hardExclusionRule.trim() : undefined,
      halfLifeDays:
        isTiming && Number.isFinite(halfLifeDays) && halfLifeDays > 0
          ? halfLifeDays
          : undefined,
    };
    if (!isEdit) body.key = toKey(form.name);

    setSaving(true);
    try {
      const response = await fetch(
        isEdit ? `/api/outreach/dimensions/${dimension!.id}` : "/api/outreach/dimensions",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error("Failed to save dimension");
      toast.success(isEdit ? "Dimension updated" : "Dimension added");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      console.error("Failed to save dimension:", error);
      toast.error("Could not save the dimension. Try again.");
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
