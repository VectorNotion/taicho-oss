"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { ListSurface } from "@/components/ListSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CreatePersonaInput, Persona } from "@/products/outreach/domain/types";

type PersonaForm = {
  name: string;
  description: string;
  targetTitles: string;
  companySizeMin: string;
  companySizeMax: string;
  fundingStages: string;
  targetDomains: string;
  signals: string;
  isActive: boolean;
};

const emptyForm: PersonaForm = {
  name: "",
  description: "",
  targetTitles: "",
  companySizeMin: "",
  companySizeMax: "",
  fundingStages: "",
  targetDomains: "",
  signals: "",
  isActive: true,
};

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toForm(persona: Persona): PersonaForm {
  return {
    name: persona.name,
    description: persona.description,
    targetTitles: persona.targetTitles.join(", "),
    companySizeMin: persona.companySizeMin?.toString() ?? "",
    companySizeMax: persona.companySizeMax?.toString() ?? "",
    fundingStages: persona.fundingStages?.join(", ") ?? "",
    targetDomains: persona.targetDomains?.join(", ") ?? "",
    signals: persona.signals.join(", "),
    isActive: persona.isActive,
  };
}

function companySize(persona: Persona): string {
  if (persona.companySizeMin != null && persona.companySizeMax != null) return `${persona.companySizeMin}–${persona.companySizeMax}`;
  if (persona.companySizeMin != null) return `${persona.companySizeMin}+`;
  if (persona.companySizeMax != null) return `≤${persona.companySizeMax}`;
  return "—";
}

export function PersonasPageClient({ initialPersonas }: { initialPersonas: Persona[] }) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [editing, setEditing] = useState<Persona | "new" | null>(null);
  const [form, setForm] = useState<PersonaForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof PersonaForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Persona | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  function startCreate() {
    setEditing("new");
    setForm(emptyForm);
    setErrors({});
    setSaveError(null);
    setActionError(null);
    setDeleteError(null);
    setDeleteTarget(null);
  }

  function startEdit(persona: Persona) {
    setEditing(persona);
    setForm(toForm(persona));
    setErrors({});
    setSaveError(null);
    setActionError(null);
    setDeleteError(null);
    setDeleteTarget(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setSaveError(null);
  }

  function payload(): CreatePersonaInput | null {
    const nextErrors: Partial<Record<keyof PersonaForm, string>> = {};
    if (!form.name.trim()) nextErrors.name = "Enter a persona name.";
    if (!form.description.trim()) nextErrors.description = "Describe who this persona represents.";
    if (list(form.targetTitles).length === 0) nextErrors.targetTitles = "Add at least one target title.";
    if (list(form.signals).length === 0) nextErrors.signals = "Add at least one qualification signal.";
    if (form.companySizeMin && form.companySizeMax && Number(form.companySizeMin) > Number(form.companySizeMax)) {
      nextErrors.companySizeMax = "Maximum size must be greater than or equal to minimum size.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return null;

    return {
      name: form.name.trim(),
      description: form.description.trim(),
      targetTitles: list(form.targetTitles),
      companySizeMin: form.companySizeMin ? Number(form.companySizeMin) : undefined,
      companySizeMax: form.companySizeMax ? Number(form.companySizeMax) : undefined,
      fundingStages: list(form.fundingStages),
      targetDomains: list(form.targetDomains),
      signals: list(form.signals),
      isActive: form.isActive,
    };
  }

  async function savePersona() {
    const data = payload();
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const current = editing === "new" ? null : editing;
      const { data: result } = current
        ? await apiMutate<{ persona: Persona }>("PATCH", `/outreach/personas/${current.id}`, {
          ...data,
          expectedRevision: current.revision,
        })
        : await apiMutate<{ persona: Persona }>("POST", "/outreach/personas", data);
      const saved = result.persona;
      setPersonas((items) => current ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
      toast.success(current ? "Persona updated" : "Persona created");
      cancelEdit();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not save the persona. Try again.";
      setSaveError(message);
      if (!(error instanceof ApiError)) console.error("Failed to save persona:", error);
      const current = editing === "new" ? null : editing;
      if (current && error instanceof ApiError && error.status === 409) {
        try {
          const { persona } = await apiGet<{ persona: Persona }>(`/outreach/personas/${current.id}`);
          setPersonas((items) => items.map((item) => item.id === persona.id ? persona : item));
        } catch {
          // Preserve the draft and original list if the recovery read also fails.
        }
      }
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function togglePersona(persona: Persona) {
    setPendingToggle(persona.id);
    setActionError(null);
    try {
      const { data: result } = await apiMutate<{ persona: Persona }>("PATCH", `/outreach/personas/${persona.id}`, {
        isActive: !persona.isActive,
        expectedRevision: persona.revision,
      });
      const updated = result.persona;
      setPersonas((items) => items.map((item) => item.id === updated.id ? updated : item));
      toast.success(updated.isActive ? "Persona activated" : "Persona deactivated");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not update the persona. Try again.";
      setActionError(message);
      if (!(error instanceof ApiError)) console.error("Failed to update persona:", error);
      toast.error(message);
    } finally {
      setPendingToggle(null);
    }
  }

  async function deletePersona() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiMutate("DELETE", `/outreach/personas/${deleteTarget.id}`, { confirm: true });
      setPersonas((items) => items.filter((item) => item.id !== deleteTarget.id));
      if (editing !== "new" && editing?.id === deleteTarget.id) cancelEdit();
      toast.success("Persona deleted");
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not delete the persona. Try again.";
      setDeleteError(message);
      if (!(error instanceof ApiError)) console.error("Failed to delete persona:", error);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  const filteredPersonas = personas.filter((persona) => {
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "active" ? persona.isActive : !persona.isActive);
    const searchable = [
      persona.name,
      persona.description,
      ...persona.targetTitles,
      ...(persona.targetDomains ?? []),
      ...(persona.fundingStages ?? []),
      ...persona.signals,
    ].join(" ").toLowerCase();
    return matchesStatus && searchable.includes(searchQuery.trim().toLowerCase());
  });
  const hasFilters = Boolean(searchQuery) || statusFilter !== "all";
  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  return <div className="w-full min-w-0 space-y-8">
    <PageHeader
      title="Personas"
      description="Define reusable audience profiles for qualification and audience-aware work across the platform."
      actions={editing ? <Button variant="outline" onClick={cancelEdit}>Cancel editing</Button> : <Button onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Create persona</Button>}
    />

    {editing && <Card>
      <CardHeader>
        <CardTitle>{editing === "new" ? "Create persona" : `Edit ${editing.name}`}</CardTitle>
        <CardDescription>Set the titles, company profile, and signals that define a strong match.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {saveError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{saveError}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="persona-name">Name</Label><Input id="persona-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="AI-curious CTO" />{errors.name && <p className="text-xs text-destructive">{errors.name}</p>}</div>
          <div className="grid gap-2"><Label htmlFor="persona-titles">Target titles</Label><Input id="persona-titles" value={form.targetTitles} onChange={(event) => setForm({ ...form, targetTitles: event.target.value })} placeholder="CTO, VP Engineering, Head of AI" />{errors.targetTitles ? <p className="text-xs text-destructive">{errors.targetTitles}</p> : <p className="text-xs text-muted-foreground">Separate multiple titles with commas.</p>}</div>
        </div>
        <div className="grid gap-2"><Label htmlFor="persona-description">Description</Label><Textarea id="persona-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Technical leaders evaluating practical AI systems for their teams." />{errors.description && <p className="text-xs text-destructive">{errors.description}</p>}</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="company-size-min">Minimum company size</Label><Input id="company-size-min" min="0" type="number" value={form.companySizeMin} onChange={(event) => setForm({ ...form, companySizeMin: event.target.value })} placeholder="50" /></div>
          <div className="grid gap-2"><Label htmlFor="company-size-max">Maximum company size</Label><Input id="company-size-max" min="0" type="number" value={form.companySizeMax} onChange={(event) => setForm({ ...form, companySizeMax: event.target.value })} placeholder="500" />{errors.companySizeMax && <p className="text-xs text-destructive">{errors.companySizeMax}</p>}</div>
          <div className="grid gap-2"><Label htmlFor="persona-domains">Target domains</Label><Input id="persona-domains" value={form.targetDomains} onChange={(event) => setForm({ ...form, targetDomains: event.target.value })} placeholder="SaaS, FinTech, HealthTech" /><p className="text-xs text-muted-foreground">Separate multiple domains with commas.</p></div>
          <div className="grid gap-2"><Label htmlFor="persona-funding">Funding stages</Label><Input id="persona-funding" value={form.fundingStages} onChange={(event) => setForm({ ...form, fundingStages: event.target.value })} placeholder="Seed, Series A, Series B" /><p className="text-xs text-muted-foreground">Separate multiple stages with commas.</p></div>
        </div>
        <div className="grid gap-2"><Label htmlFor="persona-signals">Qualification signals</Label><Textarea id="persona-signals" value={form.signals} onChange={(event) => setForm({ ...form, signals: event.target.value })} rows={2} placeholder="Hiring AI engineers, scaling manual workflows, active AI initiative" />{errors.signals ? <p className="text-xs text-destructive">{errors.signals}</p> : <p className="text-xs text-muted-foreground">Separate the behaviors or characteristics that indicate a good fit with commas.</p>}</div>
        <div className="flex items-center justify-between gap-4 border-t pt-6">
          <div className="flex items-center gap-3"><Switch id="persona-active" checked={form.isActive} onCheckedChange={(isActive) => setForm({ ...form, isActive })} /><div><Label htmlFor="persona-active">Active across the workspace</Label><p className="text-xs text-muted-foreground">Active personas are available to services such as Outreach qualification.</p></div></div>
          <Button onClick={() => void savePersona()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing === "new" ? "Create persona" : "Save persona"}</Button>
        </div>
      </CardContent>
    </Card>}

    <ListSurface
      count={filteredPersonas.length}
      description="Reusable audience profiles available to audience-aware services."
      emptyState={
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Users className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">
              {hasFilters ? "No personas match these filters" : "No personas yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasFilters
                ? "Try another search or status."
                : "Personas define the audiences your workspace wants to understand and reach."}
            </p>
          </div>
          {hasFilters ? (
            <Button onClick={resetFilters} variant="outline">Clear filters</Button>
          ) : !editing ? (
            <Button variant="outline" onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Create persona</Button>
          ) : null}
        </div>
      }
      filters={
        <>
          {(["all", "active", "inactive"] as const).map((status) => (
            <Button
              key={status}
              onClick={() => setStatusFilter(status)}
              size="sm"
              variant={statusFilter === status ? "secondary" : "ghost"}
            >
              {status === "all" ? "All" : status === "active" ? "Active" : "Inactive"}
            </Button>
          ))}
          {hasFilters && (
            <Button onClick={resetFilters} size="sm" variant="ghost">Clear</Button>
          )}
        </>
      }
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search personas…"
      searchValue={searchQuery}
      title="Workspace personas"
    >
      {actionError || filteredPersonas.length > 0 ? (
        <>
          {actionError ? <p className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{actionError}</p> : null}
          {filteredPersonas.length > 0 ? <ListRows>
            {filteredPersonas.map((persona) => (
              <ListRow
                actions={[
                  {
                    icon: Pencil,
                    label: `Edit ${persona.name}`,
                    onSelect: () => startEdit(persona),
                  },
                  {
                    disabled: pendingToggle === persona.id,
                    icon: Power,
                    label: persona.isActive ? `Deactivate ${persona.name}` : `Activate ${persona.name}`,
                    onSelect: () => void togglePersona(persona),
                  },
                  {
                    destructive: true,
                    icon: Trash2,
                    label: `Delete ${persona.name}`,
                    onSelect: () => {
                      setDeleteTarget(persona);
                      if (editing !== "new" && editing?.id === persona.id) cancelEdit();
                    },
                  },
                ]}
                badge={
                  <Badge variant={persona.isActive ? "default" : "secondary"}>
                    {persona.isActive ? "Active" : "Inactive"}
                  </Badge>
                }
                key={persona.id}
                meta={[
                  persona.description,
                  persona.targetTitles.length > 0 ? persona.targetTitles.join(", ") : "No target titles",
                  `Company size ${companySize(persona)}`,
                ]}
                title={persona.name}
              />
            ))}
          </ListRows> : null}
          {deleteTarget && (
            <div className="space-y-3 border-t px-6 py-4">
              {deleteError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{deleteError}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Permanently delete &ldquo;{deleteTarget.name}&rdquo; from the workspace?
                </p>
                <div className="flex items-center gap-2">
                  <Button disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError(null); }} size="sm" variant="outline">Cancel</Button>
                  <Button disabled={deleting} onClick={() => void deletePersona()} size="sm" variant="destructive">
                    {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Delete persona
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </ListSurface>
  </div>;
}
