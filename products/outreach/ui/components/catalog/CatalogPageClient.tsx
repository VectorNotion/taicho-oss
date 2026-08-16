"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Boxes, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogItem, CatalogItemKind } from "@/products/outreach/domain/catalog";

const kinds: Array<{ value: CatalogItemKind; label: string }> = [
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "subscription", label: "Subscription" },
  { value: "retainer", label: "Retainer" },
  { value: "bundle", label: "Bundle" },
  { value: "other", label: "Other" },
];

type Form = Omit<CatalogItem, "id" | "createdAt" | "updatedAt">;
const emptyForm = (): Form => ({
  name: "", kind: "service", summary: "", positioning: "", outcomes: "",
  differentiators: "", proof: "", researchGuidance: "", voice: "", status: "active",
});

export function CatalogPageClient() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/outreach/catalog", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setItems(await response.json());
    } catch {
      toast.error("Could not load the Catalog");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function start(item?: CatalogItem) {
    setEditing(item ?? null);
    setForm(item ? {
      name: item.name, kind: item.kind, summary: item.summary,
      positioning: item.positioning, outcomes: item.outcomes,
      differentiators: item.differentiators, proof: item.proof,
      researchGuidance: item.researchGuidance, voice: item.voice, status: item.status,
    } : emptyForm());
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Enter a name");
    setSaving(true);
    try {
      const response = await fetch(
        editing ? `/api/outreach/catalog/${editing.id}` : "/api/outreach/catalog",
        { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Catalog item could not be saved");
      toast.success(editing ? "Catalog item updated" : "Catalog item added");
      setOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Catalog item could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/outreach/catalog/${deleteTarget.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Catalog item could not be deleted");
      toast.success("Catalog item deleted");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Catalog item could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        actions={<Button onClick={() => start()}><Plus className="size-4" />Add to catalog</Button>}
        description="Everything you sell—products, services, subscriptions, retainers, and bundles—with the context agents need to research and communicate accurately."
        title="Catalog"
      />
      <ListCard description={`${items.filter((item) => item.status === "active").length} active catalog items.`} title="What you sell">
        {loading ? (
          <div className="space-y-3 p-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : items.length === 0 ? (
          <div className="grid justify-items-center gap-3 px-6 py-16 text-center">
            <Boxes className="size-9 text-muted-foreground" />
            <div><p className="font-medium">Your Catalog is empty</p><p className="mt-1 text-sm text-muted-foreground">Add the first product, service, or package you want agents to understand.</p></div>
            <Button onClick={() => start()} variant="outline"><Plus className="size-4" />Add to catalog</Button>
          </div>
        ) : (
          <ListRows>{items.map((item) => (
            <ListRow
              actions={[
                { icon: Pencil, label: `Edit ${item.name}`, onSelect: () => start(item) },
                { destructive: true, icon: Trash2, label: `Delete ${item.name}`, onSelect: () => setDeleteTarget(item) },
              ]}
              badge={<span className="flex gap-1.5"><Badge variant="outline">{kinds.find((kind) => kind.value === item.kind)?.label}</Badge>{item.status === "archived" ? <Badge variant="secondary"><Archive className="size-3" />Archived</Badge> : null}</span>}
              key={item.id}
              meta={[item.positioning || item.outcomes || "Add positioning and customer outcomes"]}
              title={item.name}
            />
          ))}</ListRows>
        )}
      </ListCard>

      <Dialog onOpenChange={(next) => !saving && setOpen(next)} open={open}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : "Add to Catalog"}</DialogTitle><DialogDescription>Capture the commercial context research, chat, and outreach should use.</DialogDescription></DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div className="grid gap-2"><Label htmlFor="catalog-name">Name</Label><Input id="catalog-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="AI implementation service" /></div>
              <div className="grid gap-2"><Label>Type</Label><Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind: kind as CatalogItemKind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{kinds.map((kind) => <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            {([
              ["summary", "What is sold", "Describe the product, service, or package."],
              ["positioning", "Positioning", "How should this be framed for the market?"],
              ["outcomes", "Customer outcomes", "What changes for the customer?"],
              ["differentiators", "Differentiators", "Why choose this instead of the alternatives?"],
              ["proof", "Proof", "Evidence, credentials, customers, metrics, and case studies."],
              ["researchGuidance", "Research guidance", "What should research look for when this Catalog item is active?"],
              ["voice", "Voice override", "Leave empty to inherit Identity's default voice."],
            ] as const).map(([field, label, placeholder]) => (
              <div className="grid gap-2" key={field}><Label htmlFor={`catalog-${field}`}>{label}</Label><Textarea id={`catalog-${field}`} placeholder={placeholder} rows={field === "summary" ? 3 : 2} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /></div>
            ))}
            {editing ? <div className="grid gap-2"><Label>Status</Label><Select value={form.status} onValueChange={(status) => setForm({ ...form, status: status as Form["status"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></div> : null}
          </div>
          <DialogFooter><Button disabled={saving} onClick={() => setOpen(false)} variant="outline">Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{editing ? "Save changes" : "Add to Catalog"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(next) => {
          if (!next && !deleting) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Catalog item?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} will be permanently removed. Items assigned to prospects must be archived instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={deleting} onClick={() => setDeleteTarget(null)} variant="outline">Cancel</Button>
            <Button disabled={deleting} onClick={() => void remove()} variant="destructive">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
