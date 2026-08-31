"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Braces, CheckCircle2, Eye, History, Loader2, RefreshCw, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_OUTREACH_PROMPT_CONTENT,
  renderOutreachPromptTemplate,
  validateOutreachPromptContent,
  type OutreachPromptContent,
  type OutreachPromptWorkspace,
} from "@/products/outreach/domain/outreach-prompts";
import type { OutreachMedium } from "@/products/outreach/domain/types";


// Stored prompt versions may predate newer mediums; merge over the defaults
// so every medium always has an editable, saveable template.
function withDefaultTemplates(content: OutreachPromptContent): OutreachPromptContent {
  return {
    ...content,
    mediumTemplates: {
      ...DEFAULT_OUTREACH_PROMPT_CONTENT.mediumTemplates,
      ...content.mediumTemplates,
    },
  };
}

const MEDIA: Array<{ id: OutreachMedium; label: string }> = [
  { id: "email", label: "Email" },
  { id: "inmail", label: "Personalized InMail" },
  { id: "inmail_traditional", label: "Traditional InMail" },
  { id: "content_comment", label: "Content comment" },
  { id: "connection_note", label: "Connection note" },
];

type ApiPayload = { workspace: OutreachPromptWorkspace; canEdit: boolean };

export function OutreachPromptSettings() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [content, setContent] = useState<OutreachPromptContent | null>(null);
  const [medium, setMedium] = useState<OutreachMedium>("email");
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [firstName, setFirstName] = useState("Ada");
  const [prospectContext, setProspectContext] = useState('{"role":"COO","company":"Analytical Engines","pain":"Manual revenue operations"}');
  const [resonanceContext, setResonanceContext] = useState("Strong interest in shortening the sales cycle.");
  const [targetContent, setTargetContent] = useState("A post about scaling operations without adding headcount.");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await apiGet<ApiPayload>("/outreach/settings/prompts");
      setPayload(next);
      setContent(withDefaultTemplates(next.workspace.draft?.content ?? next.workspace.active.content));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not load outreach prompts. Try again.";
      setLoadError(message);
      if (!(error instanceof ApiError)) console.error("Failed to load outreach prompts:", error);
      toast.error(message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    function restoreMedium() {
      const requested = new URLSearchParams(window.location.search).get("medium");
      const known = MEDIA.find((item) => item.id === requested)?.id;
      setMedium(known ?? "email");
    }
    restoreMedium();
    window.addEventListener("popstate", restoreMedium);
    return () => window.removeEventListener("popstate", restoreMedium);
  }, []);

  const errors = useMemo(() => content ? validateOutreachPromptContent(content) : [], [content]);
  const preview = useMemo(() => content ? renderOutreachPromptTemplate(content.mediumTemplates[medium], {
    first_name: firstName,
    prospect_context: prospectContext,
    resonance_context: resonanceContext,
    target_content: targetContent,
  }) : "", [content, firstName, medium, prospectContext, resonanceContext, targetContent]);
  const rawSavedContent = payload?.workspace.draft?.content ?? payload?.workspace.active.content;
  const savedContent = rawSavedContent ? withDefaultTemplates(rawSavedContent) : undefined;
  const isDirty = Boolean(content && savedContent && JSON.stringify(content) !== JSON.stringify(savedContent));

  function updateTemplate(value: string) {
    setContent((current) => current ? {
      ...current,
      mediumTemplates: { ...current.mediumTemplates, [medium]: value },
    } : current);
  }

  function changeMedium(next: OutreachMedium) {
    setMedium(next);
    const url = new URL(window.location.href);
    if (next === "email") url.searchParams.delete("medium");
    else url.searchParams.set("medium", next);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function persist(method: "PUT" | "POST") {
    if (!content || !payload?.canEdit) return;
    const draftContentHash = payload.workspace.draft?.contentHash;
    if (method === "POST" && !draftContentHash) return;
    setBusy(method === "PUT" ? "save" : "publish");
    setActionError(null);
    try {
      const { data: result } = await apiMutate<ApiPayload>(
        method,
        "/outreach/settings/prompts",
        method === "PUT" ? {
          ...content,
          expectedActiveVersion: payload.workspace.active.version,
          expectedDraftContentHash: payload.workspace.draft?.contentHash ?? null,
        } : {
          expectedActiveVersion: payload.workspace.active.version,
          expectedDraftContentHash: draftContentHash,
        },
      );
      setPayload(result);
      setContent(withDefaultTemplates(result.workspace.draft?.content ?? result.workspace.active.content));
      setConfirmPublish(false);
      toast.success(method === "PUT" ? "Prompt draft saved" : `Prompt version ${result.workspace.active.version} published`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not update outreach prompts. Try again.";
      setActionError(message);
      if (!(error instanceof ApiError)) console.error("Failed to update outreach prompts:", error);
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await apiGet<ApiPayload>("/outreach/settings/prompts");
          setPayload(latest);
          if (method === "POST") {
            setContent(withDefaultTemplates(latest.workspace.draft?.content ?? latest.workspace.active.content));
            setConfirmPublish(false);
          }
        } catch {
          // Keep the current content and known version when conflict recovery cannot refresh.
        }
      }
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  if (!payload || !content) {
    if (loadError) {
      return <Card><CardContent className="grid justify-items-center gap-4 px-6 py-16 text-center"><AlertCircle className="size-9 text-destructive" /><div><p className="font-medium">Outreach prompts could not be loaded</p><p className="mt-1 text-sm text-muted-foreground">{loadError}</p></div><Button onClick={() => void load()} variant="outline"><RefreshCw className="size-4" />Try again</Button></CardContent></Card>;
    }
    return <div className="space-y-6"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  }

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        actions={<div className="flex flex-wrap gap-2">
          <Button disabled={!payload.canEdit || !isDirty || errors.length > 0 || busy !== null} onClick={() => void persist("PUT")} variant="outline">
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save draft
          </Button>
          <Button disabled={!payload.canEdit || !payload.workspace.draft || isDirty || busy !== null} onClick={() => setConfirmPublish(true)}>
            {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}Publish draft
          </Button>
        </div>}
        description="Control the workspace instructions and channel templates used whenever Taicho generates an outreach message."
        title="Outreach prompts"
      />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/15 px-4 py-3">
        <Badge><CheckCircle2 className="size-3" />Active v{payload.workspace.active.version}</Badge>
        {payload.workspace.draft ? <Badge variant="outline">Draft based on v{payload.workspace.draft.basedOnVersion}</Badge> : null}
        <span className="text-xs text-muted-foreground">Hash {payload.workspace.active.contentHash.slice(0, 12)} · Every generated draft records this version.</span>
      </div>

      {actionError ? <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{actionError}</p> : null}

      {!payload.canEdit ? (
        <div className="rounded-xl border border-chart-1/30 bg-chart-1/5 px-4 py-3 text-sm text-muted-foreground">
          You can inspect the active prompt; an Outreach manager or workspace administrator can edit and publish it.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Braces className="size-4" />Workspace instructions</CardTitle>
              <CardDescription>These rules control strategy and style inside Taicho’s immutable truthfulness and prompt-injection safety envelope.</CardDescription>
            </CardHeader>
            <CardContent>
              <Label className="sr-only" htmlFor="outreach-system-instructions">System instructions</Label>
              <Textarea aria-invalid={errors.includes("System instructions are required.")} className="min-h-56 font-mono text-xs leading-6" disabled={!payload.canEdit} id="outreach-system-instructions" onChange={(event) => setContent({ ...content, systemInstructions: event.target.value })} value={content.systemInstructions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Channel templates</CardTitle>
              <CardDescription>Choose a channel, edit its task prompt, and insert only the documented variables shown below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Outreach channels">
                {MEDIA.map((item) => <Button aria-selected={medium === item.id} key={item.id} onClick={() => changeMedium(item.id)} role="tab" size="sm" variant={medium === item.id ? "default" : "outline"}>{item.label}</Button>)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {payload.workspace.allowedVariables.map((variable) => <Badge key={variable} variant="outline">{`{{${variable}}}`}</Badge>)}
              </div>
              <Label htmlFor="outreach-medium-template">{MEDIA.find((item) => item.id === medium)?.label} template</Label>
              <Textarea aria-invalid={errors.some((error) => error.startsWith(`${medium} `))} className="min-h-80 font-mono text-xs leading-6" disabled={!payload.canEdit} id="outreach-medium-template" onChange={(event) => updateTemplate(event.target.value)} value={content.mediumTemplates[medium]} />
              {errors.length > 0 ? <ul className="space-y-1 text-xs text-destructive" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Eye className="size-4" />Compiled preview</CardTitle>
              <CardDescription>This is the exact channel task after Taicho substitutes the sample inputs below; no model call or credits are used.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2"><Label htmlFor="prompt-first-name">First name</Label><Input id="prompt-first-name" onChange={(event) => setFirstName(event.target.value)} value={firstName} /></div>
              <div className="grid gap-2"><Label htmlFor="prompt-prospect-context">Prospect context</Label><Textarea className="min-h-24 font-mono text-xs" id="prompt-prospect-context" onChange={(event) => setProspectContext(event.target.value)} value={prospectContext} /></div>
              <div className="grid gap-2"><Label htmlFor="prompt-resonance-context">Resonance context</Label><Textarea id="prompt-resonance-context" onChange={(event) => setResonanceContext(event.target.value)} value={resonanceContext} /></div>
              {medium === "content_comment" ? <div className="grid gap-2"><Label htmlFor="prompt-target-content">Target content</Label><Textarea id="prompt-target-content" onChange={(event) => setTargetContent(event.target.value)} value={targetContent} /></div> : null}
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/25 p-4 text-xs leading-6">{preview}</pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" />Published versions</CardTitle><CardDescription>Published prompt versions are immutable and remain attributable to generated messages.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {payload.workspace.versions.map((version) => <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" key={version.id}><div><p className="text-sm font-medium">Version {version.version}</p><p className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()} · {version.createdBy === "system-default" ? "Taicho default" : "Workspace member"}</p></div><code className="text-[10px] text-muted-foreground">{version.contentHash.slice(0, 10)}</code></div>)}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog onOpenChange={(open) => busy === null && setConfirmPublish(open)} open={confirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish prompt version {payload.workspace.active.version + 1}?</DialogTitle>
            <DialogDescription>
              This promotes the saved draft based on version {payload.workspace.draft?.basedOnVersion} to the active prompt used by every new outreach generation. Published versions are immutable and remain in history.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
            <p className="font-medium">Active v{payload.workspace.active.version} → v{payload.workspace.active.version + 1}</p>
            <p className="mt-1 text-xs text-muted-foreground">Draft hash {payload.workspace.draft?.contentHash.slice(0, 12)}</p>
          </div>
          <DialogFooter>
            <Button disabled={busy !== null} onClick={() => setConfirmPublish(false)} variant="outline">Keep as draft</Button>
            <Button disabled={busy !== null} onClick={() => void persist("POST")}>
              {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Publish version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
