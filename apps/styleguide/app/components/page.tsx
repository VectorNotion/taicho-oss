"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DemoFrame, Section, Spec } from "../../components/section";

const BADGE_MAPPING = [
  { variant: "default" as const, meaning: "positive / active", states: ["active", "validated", "sent", "published", "subscribed"] },
  { variant: "secondary" as const, meaning: "neutral / in progress", states: ["draft", "queued", "scheduled", "paused"] },
  { variant: "outline" as const, meaning: "structural / meta", states: ["sequence", "open-ended queue", "Webhook", "generation 2"] },
  { variant: "destructive" as const, meaning: "failure / terminal", states: ["failed", "rejected", "retired", "suppressed"] },
];

export default function ComponentsPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="w-full min-w-0 space-y-12">
      <PageHeader
        title="Components"
        description="The vocabulary. Every control comes from packages/ui — raw HTML equivalents are defects."
      />

      <Section
        title="Buttons"
        description="One filled button per view — the primary action. Outline for secondary, ghost for row actions, destructive for the irreversible."
      >
        <DemoFrame>
          <div className="flex flex-wrap items-center gap-3">
            <Button><Plus className="h-4 w-4" /> Create funnel</Button>
            <Button variant="outline">Add prospect</Button>
            <Button variant="secondary">Preview</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive"><Trash2 className="h-4 w-4" /> Delete funnel</Button>
            <Button disabled><Loader2 className="h-4 w-4 animate-spin" /> Saving…</Button>
            <Button aria-label="Edit" size="icon" variant="ghost"><Pencil className="h-4 w-4" /></Button>
          </div>
        </DemoFrame>
        <Spec>verb + object labels · pending = disabled + Loader2 · icon-only needs aria-label</Spec>
      </Section>

      <Section title="Badge status mapping" description="Same state, same variant, on every page — a status never wears two colors.">
        <Card>
          <CardContent className="divide-y p-0">
            {BADGE_MAPPING.map((row) => (
              <div className="flex flex-col gap-2 px-6 py-4 md:flex-row md:items-center md:justify-between" key={row.variant}>
                <div>
                  <p className="text-sm font-medium">{row.meaning}</p>
                  <Spec>variant=&quot;{row.variant}&quot;</Spec>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {row.states.map((s) => <Badge key={s} variant={row.variant}>{s}</Badge>)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Forms" description="Label above control, hints below in meta type, field errors inline in destructive — toasts only for non-field failures.">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Create funnel</CardTitle>
            <CardDescription>Steps are added on the funnel page after creation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sg-name">Name</Label>
              <Input id="sg-name" placeholder="Onboarding" />
              <p className="text-xs text-muted-foreground">Shown in the sidebar and on the funnels list.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sg-type">Type</Label>
              <Select defaultValue="sequence">
                <SelectTrigger id="sg-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequence">Sequence</SelectItem>
                  <SelectItem value="queue">Open-ended queue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sg-desc">Description</Label>
              <Textarea id="sg-desc" placeholder="What this funnel is for" rows={2} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sg-email">Sender email</Label>
              <Input aria-invalid defaultValue="not-an-email" id="sg-email" />
              <p className="text-xs text-destructive">Enter a valid email address.</p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox defaultChecked id="sg-wake" />
              <Label htmlFor="sg-wake">Wake parked enrollments when a step is appended</Label>
            </div>
            <div className="flex justify-end">
              <Button>Create funnel</Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Dialogs" description="Create and edit flows live in dialogs. Destructive actions always confirm, stating exactly what will be lost.">
        <DemoFrame>
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline"><Plus className="h-4 w-4" /> New channel</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add webhook</DialogTitle>
                  <DialogDescription>Send the full draft as signed JSON to an endpoint you control.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="sg-wh-name">Name</Label>
                    <Input id="sg-wh-name" placeholder="Internal pipeline" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => toast.success("Webhook channel added")}>Add webhook</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button onClick={() => setConfirmOpen(true)} variant="destructive"><Trash2 className="h-4 w-4" /> Delete note</Button>
            <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete note</DialogTitle>
                  <DialogDescription>The note and its content will be permanently removed.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button onClick={() => setConfirmOpen(false)} variant="outline">Cancel</Button>
                  <Button
                    onClick={() => {
                      setConfirmOpen(false);
                      toast.success("Note deleted");
                    }}
                    variant="destructive"
                  >
                    Delete note
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </DemoFrame>
      </Section>

      <Section title="Toasts" description="Every mutation confirms; every failure says what happened and what to do next. No alert(), no inline banners.">
        <DemoFrame>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => toast.success("Funnel created")} variant="outline">Success toast</Button>
            <Button onClick={() => toast.error("Could not load channels. Refresh to try again.")} variant="outline">Error toast</Button>
          </div>
        </DemoFrame>
        <Spec>✓ “Funnel created” · ✗ “Success!” — no exclamation marks, no vague triumph</Spec>
      </Section>

      <Section title="Skeletons" description="Page-level loading mirrors the final layout. Spinners live only inside buttons.">
        <DemoFrame>
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div className="space-y-2" key={i}>
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ))}
          </div>
        </DemoFrame>
      </Section>
    </div>
  );
}
