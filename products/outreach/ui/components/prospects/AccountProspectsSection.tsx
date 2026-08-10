"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Plus, Search, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDimensionResearch } from "../research/useDimensionResearch";
import { DimensionResearchSurface } from "../research/DimensionResearchSurface";

export interface AccountProspectRow {
  id: string;
  name: string;
  title?: string;
  status: string;
  personaScore: number | null;
  qualificationStatus: string | null;
}

interface AccountProspectsSectionProps {
  accountId: string;
  accountName: string;
  prospects: AccountProspectRow[];
  onRefresh: () => void;
}

const QUALIFICATION_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  QUALIFIED: { label: "Qualified", variant: "default" },
  CONTACT_DISCOVERY_REQUIRED: { label: "Find another contact", variant: "outline" },
  REVIEW: { label: "Needs review", variant: "secondary" },
  HARD_EXCLUDED: { label: "Hard excluded", variant: "destructive" },
  UNQUALIFIED: { label: "Unqualified", variant: "secondary" },
};

function statusBadge(row: AccountProspectRow) {
  if (row.qualificationStatus && QUALIFICATION_BADGE[row.qualificationStatus]) {
    const config = QUALIFICATION_BADGE[row.qualificationStatus];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  }
  return <Badge variant="secondary">Not qualified</Badge>;
}

const EMPTY_FORM = { name: "", title: "", email: "", linkedinUrl: "" };

/**
 * Runs one prospect dimension-research stream on mount (remounted per row via
 * `key`), rendering the live surface. Reports completion up so the account can
 * re-fetch and reflect the new persona score / status.
 */
function ProspectResearchSurface({
  prospectId,
  prospectName,
  onComplete,
}: {
  prospectId: string;
  prospectName: string;
  onComplete: () => void;
}) {
  const { start, final, error, isStreaming, dimensions } = useDimensionResearch(
    `/api/outreach/prospects/${prospectId}/research/stream`,
  );
  const completed = useRef(false);

  useEffect(() => {
    start();
    // Runs once per mount; the row remounts this component by key to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (final && !completed.current) {
      completed.current = true;
      toast.success(`Research complete for ${prospectName}`);
      onComplete();
    }
  }, [final, prospectName, onComplete]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <Card className={isStreaming ? "border-primary/20 shadow-sm" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Researching {prospectName}</CardTitle>
      </CardHeader>
      <CardContent>
        <DimensionResearchSurface
          entityName={prospectName}
          dimensions={dimensions}
          isStreaming={isStreaming}
        />
      </CardContent>
    </Card>
  );
}

export function AccountProspectsSection({
  accountName,
  prospects,
  onRefresh,
}: AccountProspectsSectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [activeResearch, setActiveResearch] = useState<{ id: string; name: string } | null>(null);

  async function addProspect() {
    const name = form.name.trim();
    if (!name) {
      toast.error("A name is required.");
      return;
    }
    setAdding(true);
    try {
      const response = await fetch("/api/outreach/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          title: form.title.trim() || undefined,
          email: form.email.trim() || undefined,
          linkedinUrl: form.linkedinUrl.trim() || undefined,
          company: accountName,
          source: "manual",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error ?? "Prospect could not be added.");
      }
      toast.success(`${name} added to ${accountName}`);
      setForm(EMPTY_FORM);
      setAddOpen(false);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Prospect could not be added.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="text-sm font-medium">Prospects ({prospects.length})</h2>
              <p className="text-sm text-muted-foreground">
                People found at this account. Add more, then research them.
              </p>
            </div>
            <Button onClick={() => setAddOpen(true)} size="sm">
              <Plus className="size-4" /> Add prospect
            </Button>
          </div>

          {prospects.length > 0 ? (
            <div className="overflow-x-auto">
              <Table containerLabel="Prospects at this account">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Persona</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prospects.map((prospect) => (
                    <TableRow key={prospect.id}>
                      <TableCell className="font-medium">
                        <Link
                          className="inline-flex items-center gap-2 transition-colors hover:text-primary"
                          href={`/outreach/prospects/${prospect.id}`}
                        >
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                            <User className="size-3.5" />
                          </span>
                          {prospect.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {prospect.title || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {prospect.personaScore == null ? "—" : Math.round(prospect.personaScore)}
                      </TableCell>
                      <TableCell>{statusBadge(prospect)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            disabled={activeResearch?.id === prospect.id}
                            onClick={() => setActiveResearch({ id: prospect.id, name: prospect.name })}
                            size="sm"
                            variant="secondary"
                          >
                            <Search className="size-4" /> Research
                          </Button>
                          <Button asChild size="icon-sm" variant="ghost">
                            <Link aria-label={`Open ${prospect.name}`} href={`/outreach/prospects/${prospect.id}`}>
                              <ArrowRight className="size-4" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid justify-items-center gap-3 px-6 py-12 text-center">
              <User className="size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">No prospects at this account yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add the people you want to research and qualify here.
                </p>
              </div>
              <Button className="mt-2" onClick={() => setAddOpen(true)} variant="outline">
                <Plus className="size-4" /> Add prospect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {activeResearch ? (
        <ProspectResearchSurface
          key={activeResearch.id}
          onComplete={onRefresh}
          prospectId={activeResearch.id}
          prospectName={activeResearch.name}
        />
      ) : null}

      <Dialog onOpenChange={(open) => { if (!adding) setAddOpen(open); }} open={addOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add prospect</DialogTitle>
            <DialogDescription>
              This person will be added to {accountName} and can then be researched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground" htmlFor="prospect-name">
                Name
              </Label>
              <Input
                id="prospect-name"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Jane Smith"
                value={form.name}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground" htmlFor="prospect-title">
                  Title
                </Label>
                <Input
                  id="prospect-title"
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="VP of Operations"
                  value={form.title}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground" htmlFor="prospect-email">
                  Email
                </Label>
                <Input
                  id="prospect-email"
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  placeholder="jane@example.com"
                  value={form.email}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground" htmlFor="prospect-linkedin">
                LinkedIn URL
              </Label>
              <Input
                id="prospect-linkedin"
                onChange={(event) => setForm({ ...form, linkedinUrl: event.target.value })}
                placeholder="https://linkedin.com/in/…"
                value={form.linkedinUrl}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={adding} onClick={() => setAddOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={adding} onClick={() => void addProspect()}>
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add prospect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
