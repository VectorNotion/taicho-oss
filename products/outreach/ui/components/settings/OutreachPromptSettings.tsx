"use client";

import { useEffect, useMemo, useState } from "react";
import { Braces, CheckCircle2, Eye, History, Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  renderOutreachPromptTemplate,
  validateOutreachPromptContent,
  type OutreachPromptContent,
  type OutreachPromptWorkspace,
} from "@/products/outreach/domain/outreach-prompts";
import type { OutreachMedium } from "@/products/outreach/domain/types";

const MEDIA: Array<{ id: OutreachMedium; label: string }> = [
  { id: "email", label: "Email" },
  { id: "inmail", label: "Personalized InMail" },
  { id: "inmail_traditional", label: "Traditional InMail" },
  { id: "content_comment", label: "Content comment" },
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

  useEffect(() => {
    void apiGet<ApiPayload>("/outreach/settings/prompts")
      .then((next) => {
        setPayload(next);
        setContent(next.workspace.draft?.content ?? next.workspace.active.content);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load outreach prompts."));
  }, []);

  const errors = useMemo(() => content ? validateOutreachPromptContent(content) : [], [content]);
  const preview = useMemo(() => content ? renderOutreachPromptTemplate(content.mediumTemplates[medium], {
    first_name: firstName,
    prospect_context: prospectContext,
    resonance_context: resonanceContext,
    target_content: targetContent,
  }) : "", [content, firstName, medium, prospectContext, resonanceContext, targetContent]);
  const savedContent = payload?.workspace.draft?.content ?? payload?.workspace.active.content;
  const isDirty = Boolean(content && savedContent && JSON.stringify(content) !== JSON.stringify(savedContent));

  function updateTemplate(value: string) {
    setContent((current) => current ? {
      ...current,
      mediumTemplates: { ...current.mediumTemplates, [medium]: value },
    } : current);
  }

  async function persist(method: "PUT" | "POST") {
    if (!content || !payload?.canEdit) return;
    setBusy(method === "PUT" ? "save" : "publish");
    try {
      const { data: result } = await apiMutate<ApiPayload>(
        method,
        "/outreach/settings/prompts",
        method === "PUT" ? content : {},
      );
      setPayload(result);
      setContent(result.workspace.draft?.content ?? result.workspace.active.content);
      toast.success(method === "PUT" ? "Prompt draft saved" : `Prompt version ${result.workspace.active.version} published`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update outreach prompts.");
    } finally {
      setBusy(null);
    }
  }

  if (!payload || !content) {
    return <div className="space-y-6"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  }

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        actions={<div className="flex flex-wrap gap-2">
          <Button disabled={!payload.canEdit || !isDirty || errors.length > 0 || busy !== null} onClick={() => void persist("PUT")} variant="outline">
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save draft
          </Button>
          <Button disabled={!payload.canEdit || !payload.workspace.draft || isDirty || busy !== null} onClick={() => void persist("POST")}>
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
              <Textarea className="min-h-56 font-mono text-xs leading-6" disabled={!payload.canEdit} onChange={(event) => setContent({ ...content, systemInstructions: event.target.value })} value={content.systemInstructions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Channel templates</CardTitle>
              <CardDescription>Choose a channel, edit its task prompt, and insert only the documented variables shown below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Outreach channels">
                {MEDIA.map((item) => <Button aria-selected={medium === item.id} key={item.id} onClick={() => setMedium(item.id)} role="tab" size="sm" variant={medium === item.id ? "default" : "outline"}>{item.label}</Button>)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {payload.workspace.allowedVariables.map((variable) => <Badge key={variable} variant="outline">{`{{${variable}}}`}</Badge>)}
              </div>
              <Textarea className="min-h-80 font-mono text-xs leading-6" disabled={!payload.canEdit} onChange={(event) => updateTemplate(event.target.value)} value={content.mediumTemplates[medium]} />
              {errors.length > 0 ? <ul className="space-y-1 text-xs text-destructive">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
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
    </div>
  );
}
