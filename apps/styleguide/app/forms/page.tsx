"use client";

import { useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DemoFrame, Section, Spec } from "../../components/section";

/* Agents emit markdown — this is the format that flows in and out of the editor. */
const INITIAL_BODY = `Most creators publish, wait a week, and guess why a post worked. We inverted it: every hook is scored against a **synthetic audience** before it ships.

The scorer reads next-token probabilities at a single Yes/No position instead of generating text:

- a thousand audience reads for $0.008
- paired design — score differences come from the creative, not audience noise
- results in minutes, not a week of engagement data`;

export default function FormsPage() {
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dek, setDek] = useState("Why we stopped generating synthetic audience text and started reading a single token's probability instead.");
  const [body, setBody] = useState(INITIAL_BODY);
  const [status, setStatus] = useState("draft");
  const [destination, setDestination] = useState("blog");
  const [topic, setTopic] = useState("synthetic-audiences");
  const [tags, setTags] = useState("resonance, evals");
  const [schedule, setSchedule] = useState("");

  const save = () => {
    if (!title.trim()) {
      setTitleError("Give the post a title before saving.");
      toast.error("Could not save — the title is missing.");
      return;
    }
    setTitleError(null);
    toast.success("Draft saved");
  };

  return (
    <div className="w-full min-w-0 space-y-12">
      <PageHeader
        title="Forms"
        description="The full-page form: a work column for the thing being authored — rich text included — and a meta rail for everything about it. Fields follow §5; the primary action lives in the page header."
      />

      <Section
        title="Full-page form"
        description="When a form outgrows a dialog (rich text, several sections), it becomes a page: detail-page top, work column + 320px meta rail. Try saving without a title to see the validation contract."
      >
        <DemoFrame>
          <span className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" /> All drafts
          </span>
          <PageHeader
            title="New blog post"
            actions={
              <div className="flex items-center gap-2">
                <Button variant="ghost">Discard</Button>
                <Button onClick={save}><Save className="h-4 w-4" /> Save draft</Button>
              </div>
            }
          />

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Work column — the thing being authored */}
            <div className="space-y-6">
              <Card>
                <CardContent className="space-y-5 p-6">
                  <div className="grid gap-2">
                    <Label htmlFor="post-title">Title</Label>
                    <Input
                      aria-invalid={!!titleError}
                      id="post-title"
                      onChange={(event) => {
                        setTitle(event.target.value);
                        if (titleError && event.target.value.trim()) setTitleError(null);
                      }}
                      placeholder="Scoring creative variants with activation-steered logprob readouts"
                      value={title}
                    />
                    {titleError && <p className="text-xs text-destructive">{titleError}</p>}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-dek">Dek</Label>
                    <Textarea id="post-dek" onChange={(event) => setDek(event.target.value)} rows={2} value={dek} />
                    <p className="text-xs text-muted-foreground">One sentence under the title — carries the why, shows in previews.</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-body">Body</Label>
                    <RichTextEditor content={body} format="markdown" minHeight="280px" onChange={setBody} placeholder="Write the post…" />
                    <p className="text-xs text-muted-foreground">
                      Formatted content is always RichTextEditor — never a bare textarea. format=&quot;markdown&quot;: agent drafts flow in as markdown, edits flow out as markdown.
                    </p>
                  </div>
                  <details className="rounded-md border bg-background/60">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">Emitted markdown (live)</summary>
                    <pre className="overflow-x-auto border-t px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">{body}</pre>
                  </details>
                </CardContent>
              </Card>
            </div>

            {/* Meta rail — everything about the thing */}
            <div className="space-y-6">
              <Card className="gap-0 py-0">
                <CardHeader className="border-b p-5">
                  <CardTitle className="text-sm">Publish</CardTitle>
                  <CardDescription>Where and when this goes out.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  <div className="grid gap-2">
                    <Label htmlFor="post-status">Status</Label>
                    <Select onValueChange={setStatus} value={status}>
                      <SelectTrigger className="w-full" id="post-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="ready">Ready</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-destination">Destination</Label>
                    <Select onValueChange={setDestination} value={destination}>
                      <SelectTrigger className="w-full" id="post-destination"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blog">Blog (CMS)</SelectItem>
                        <SelectItem value="linkedin">LinkedIn article</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-schedule">Schedule</Label>
                    <Input id="post-schedule" onChange={(event) => setSchedule(event.target.value)} placeholder="2026-08-02 09:00" value={schedule} />
                    <p className="text-xs text-muted-foreground">Leave empty to publish manually. Absolute dates for schedules.</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardHeader className="border-b p-5">
                  <CardTitle className="text-sm">Organize</CardTitle>
                  <CardDescription>How the graph files this.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  <div className="grid gap-2">
                    <Label htmlFor="post-topic">Topic</Label>
                    <Select onValueChange={setTopic} value={topic}>
                      <SelectTrigger className="w-full" id="post-topic"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="synthetic-audiences">Synthetic audiences</SelectItem>
                        <SelectItem value="agent-memory">Agent memory</SelectItem>
                        <SelectItem value="graph-rag">Graph RAG</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-tags">Tags</Label>
                    <Input id="post-tags" onChange={(event) => setTags(event.target.value)} value={tags} />
                    <p className="text-xs text-muted-foreground">Comma-separated; becomes graph edges on save.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </DemoFrame>
        <Spec>
          Full-page form anatomy: detail-page top, then work column (title, dek, RichTextEditor body) + 320px meta rail (Publish, Organize cards).
          One filled button per view — Save in the header actions, Discard ghost beside it. Validation: inline destructive under the field + toast.error
          for the submit failure; success is toast.success. Rail cards use the content-section recipe at text-sm.
        </Spec>
      </Section>
    </div>
  );
}
