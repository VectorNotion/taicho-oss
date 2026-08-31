"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Video,
  FileText,
  Twitter,
  Linkedin,
  AtSign,
  MessageSquareText,
  Megaphone,
  AudioWaveform,
  Sparkles,
  PenLine,
  Check,
  ArrowRight,
  ExternalLink,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";

import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import { StatRow } from "@/components/StatRow";
import { ReasoningTicker, StreamSection } from "@/components/genui";
import { useCapabilityStream } from "@content-automation/ui/hooks/use-capability-stream";
import type {
  ContentIdea,
  ContentDraft,
  ContentPriority,
  ContentType,
} from "@/products/content-generator/domain/content";
import type {
  ContentInsight,
  ContentInsightFeed,
  ContentInsightState,
} from "@/products/content-generator/domain/content-insight";

const typeConfig: Record<ContentType, { icon: React.ElementType; label: string }> = {
  video_script: { icon: Video, label: "YouTube" },
  blog_post: { icon: FileText, label: "Blog" },
  x_post: { icon: AtSign, label: "X post" },
  tweet_thread: { icon: Twitter, label: "X thread" },
  linkedin_post: { icon: Linkedin, label: "LinkedIn" },
  social_post: { icon: MessageSquareText, label: "Social" },
  ad_campaign: { icon: Megaphone, label: "Ad campaign" },
};

const priorityConfig = {
  low: { label: "Low", variant: "outline" as const },
  medium: { label: "Medium", variant: "outline" as const },
  high: { label: "High", variant: "outline" as const },
};

const statusConfig = {
  idea: { label: "Idea", variant: "secondary" as const },
  refined: { label: "Content Base", variant: "default" as const },
  draft: { label: "Post", variant: "secondary" as const },
  ready: { label: "Ready", variant: "default" as const },
  published: { label: "Published", variant: "default" as const },
};

const insightStateConfig: Record<ContentInsightState, {
  label: string;
  variant: "default" | "secondary" | "outline";
}> = {
  content_gap: { label: "Content needed", variant: "default" },
  solution_gap: { label: "Solution gap", variant: "secondary" },
  account_ineligible: { label: "Account ineligible", variant: "outline" },
  covered: { label: "Covered", variant: "outline" },
};

const performanceConfig = {
  high: { label: "High performance", variant: "default" as const },
  medium: { label: "Medium performance", variant: "secondary" as const },
  low: { label: "Low performance", variant: "outline" as const },
};

type ContentTab = "insights" | "ideas" | "drafts" | "published";

function streamErrorMessage(error: string, action: string): string {
  return /failed to fetch|networkerror/i.test(error)
    ? `${action} was interrupted before completion. Check your connection and try again.`
    : error;
}

export default function ContentPage() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [insightFeed, setInsightFeed] = useState<ContentInsightFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingInsightId, setCreatingInsightId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [insightState, setInsightState] = useState<ContentInsightState | "all">("content_gap");
  const [activeTab, setActiveTab] = useState<ContentTab>("insights");
  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const [newIdeaTitle, setNewIdeaTitle] = useState("");
  const [newIdeaNotes, setNewIdeaNotes] = useState("");
  const [newIdeaRationale, setNewIdeaRationale] = useState("");
  const [newIdeaPriority, setNewIdeaPriority] = useState<ContentPriority>("medium");
  const [creatingIdea, setCreatingIdea] = useState(false);
  const ideasStream = useCapabilityStream<{
    ideas?: Array<{ title?: string; description?: string; priority?: ContentPriority }>;
  }, { ideasCreated: number }>({ api: "/content/ideas/generate" });

  const fetchData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [insightsResult, ideasResult, draftsResult] = await Promise.allSettled([
        apiGet<{ feed: ContentInsightFeed }>("/content/insights"),
        apiGet<{ items: ContentIdea[] }>("/content/ideas", { limit: 100 }),
        apiGet<{ items: ContentDraft[] }>("/content/drafts", { limit: 100 }),
      ]);

      if (signal?.aborted) return;
      if (insightsResult.status === "fulfilled") {
        setInsightFeed(insightsResult.value.feed);
      }
      if (ideasResult.status === "fulfilled") {
        setIdeas(ideasResult.value.items);
      }
      if (draftsResult.status === "fulfilled") {
        setDrafts(draftsResult.value.items);
      }
      if ([insightsResult, ideasResult, draftsResult].some((result) => result.status === "rejected")) {
        toast.error("Could not load some content. Refresh to try again.");
      }
    } catch {
      if (signal?.aborted) return;
      toast.error("Could not load content. Refresh to try again.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchData(controller.signal);
    return () => controller.abort();
  }, []);

  const createIdeaFromInsight = async (insight: ContentInsight) => {
    setCreatingInsightId(insight.id);
    try {
      const { data } = await apiMutate<{ idea: ContentIdea }>(
        "POST",
        `/content/insights/${encodeURIComponent(insight.id)}/idea`,
      );
      const idea = data.idea;
      setIdeas((current) => [idea, ...current.filter((item) => item.id !== idea.id)]);
      toast.success("Content idea created from the calculated gap.");
      router.push(`/content/${idea.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a content idea.");
    } finally {
      setCreatingInsightId(null);
    }
  };

  const resetNewIdea = () => {
    setNewIdeaTitle("");
    setNewIdeaNotes("");
    setNewIdeaRationale("");
    setNewIdeaPriority("medium");
  };

  const createManualIdea = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newIdeaTitle.trim();
    const description = newIdeaNotes.trim();
    if (!title || !description) return;

    setCreatingIdea(true);
    try {
      const { data } = await apiMutate<{ idea: ContentIdea }>("POST", "/content/ideas", {
        title,
        description,
        rationale: newIdeaRationale.trim() || description,
        priority: newIdeaPriority,
        sourceTopicIds: [],
        sourceResearchIds: [],
      });
      const idea = data.idea;
      setIdeas((current) => [idea, ...current.filter((item) => item.id !== idea.id)]);
      setNewIdeaOpen(false);
      resetNewIdea();
      toast.success("Idea captured. Build it into a Content Base when you are ready.");
      router.push(`/content/${idea.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the idea.");
    } finally {
      setCreatingIdea(false);
    }
  };

  useEffect(() => {
    if (!ideasStream.final) return;
    const count = ideasStream.final.ideasCreated;
    if (count > 0) {
      toast.success(`Generated ${count} ${count === 1 ? "idea" : "ideas"}`);
    } else {
      toast.message("No ideas were generated. Add Projects, Research, or Topics and try again.");
    }
    setActiveTab("ideas");
    void fetchData();
  }, [ideasStream.final]);

  useEffect(() => {
    if (ideasStream.error) toast.error(streamErrorMessage(ideasStream.error, "Idea generation"));
  }, [ideasStream.error]);

  const publishedDrafts = drafts.filter((d) => d.status === "published");
  const activeDrafts = drafts.filter((d) => d.status !== "published");
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const insights = insightFeed?.insights ?? [];
  const filteredInsights = insights.filter((insight) =>
    (insightState === "all" || insight.state === insightState)
    && [
      insight.title,
      insight.providerLabel,
      insight.context?.label ?? "",
      insight.supportingMatch?.label ?? "",
      insight.reason,
    ].join(" ").toLowerCase().includes(normalizedSearch));
  const filteredIdeas = ideas.filter((idea) => [
    idea.title,
    idea.description,
    idea.priority,
    idea.status,
    ...(idea.sourceTopics ?? []).map((topic) => topic.name),
  ].join(" ").toLowerCase().includes(normalizedSearch));
  const filteredActiveDrafts = activeDrafts.filter((draft) => [
    draft.title,
    draft.type,
    draft.status,
  ].join(" ").toLowerCase().includes(normalizedSearch));
  const filteredPublishedDrafts = publishedDrafts.filter((draft) => [
    draft.title,
    draft.type,
    draft.performanceLevel ?? "",
    draft.performanceInsights ?? "",
  ].join(" ").toLowerCase().includes(normalizedSearch));

  const stats = [
    {
      featured: true,
      label: "Content gaps",
      value: (insightFeed?.summary.contentGaps ?? 0).toLocaleString(),
      description: "Eligible demand with solution coverage but insufficient published content",
    },
    {
      label: "Accounts blocked",
      value: (insightFeed?.summary.blockedContexts ?? 0).toLocaleString(),
      description: "Distinct accounts currently held back by a content gap",
    },
    {
      label: "Solution gaps",
      value: (insightFeed?.summary.solutionGaps ?? 0).toLocaleString(),
      description: "Opportunities requiring catalogue or product coverage first",
    },
    {
      label: "Touch ready",
      value: (insightFeed?.summary.covered ?? 0).toLocaleString(),
      description: "Eligible opportunities with both solution and content coverage",
    },
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Content"
        description="Capture ideas, build grounded Content Bases, and turn them into Posts"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Dialog
              open={newIdeaOpen}
              onOpenChange={(open) => {
                setNewIdeaOpen(open);
                if (!open && !creatingIdea) resetNewIdea();
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4" />
                  New idea
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card">
                <DialogHeader>
                  <DialogTitle>Capture a rough idea</DialogTitle>
                  <DialogDescription>
                    Save the angle now. You can refine it into an evidence-backed Content Base next.
                  </DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={createManualIdea}>
                  <div className="grid gap-2">
                    <Label htmlFor="idea-title">Working title</Label>
                    <Input
                      autoFocus
                      id="idea-title"
                      maxLength={500}
                      onChange={(event) => setNewIdeaTitle(event.target.value)}
                      placeholder="The angle you want to explore"
                      required
                      value={newIdeaTitle}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="idea-notes">Rough notes</Label>
                    <Textarea
                      id="idea-notes"
                      maxLength={20_000}
                      onChange={(event) => setNewIdeaNotes(event.target.value)}
                      placeholder="Fragments, claims, examples, questions, or anything worth assimilating…"
                      required
                      rows={5}
                      value={newIdeaNotes}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="idea-rationale">
                      Why it matters <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea
                      id="idea-rationale"
                      maxLength={20_000}
                      onChange={(event) => setNewIdeaRationale(event.target.value)}
                      placeholder="Who needs this and why now?"
                      rows={3}
                      value={newIdeaRationale}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="idea-priority">Priority</Label>
                    <Select
                      onValueChange={(value) => setNewIdeaPriority(value as ContentPriority)}
                      value={newIdeaPriority}
                    >
                      <SelectTrigger className="w-full" id="idea-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={creatingIdea}
                      onClick={() => {
                        setNewIdeaOpen(false);
                        resetNewIdea();
                      }}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={creatingIdea || !newIdeaTitle.trim() || !newIdeaNotes.trim()}
                      type="submit"
                    >
                      {creatingIdea ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Capture idea
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Button
              disabled={ideasStream.isStreaming}
              onClick={() => ideasStream.start({ count: 5 })}
            >
              {ideasStream.isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate ideas
            </Button>
            <Button disabled={loading} onClick={() => void fetchData()} variant="outline">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
          </div>
        )}
      />
      <div className="space-y-8">
        {ideasStream.isStreaming ? (
          <div aria-live="polite" className="space-y-4" data-testid="ideas-stream">
            <ReasoningTicker active text={ideasStream.reasoning} />
            <StreamSection state="streaming" title="Assimilating Projects, Research, and Topics">
              <div className="grid gap-3">
                {(ideasStream.partial?.ideas ?? [])
                  .filter((idea) => idea?.title)
                  .map((idea, index) => (
                    <div
                      className="animate-in fade-in slide-in-from-bottom-2 rounded-lg border bg-card p-4 duration-300"
                      key={`${idea.title}-${index}`}
                    >
                      <div className="font-medium">{idea.title}</div>
                      {idea.description ? (
                        <div className="mt-1 text-sm text-muted-foreground">{idea.description}</div>
                      ) : null}
                    </div>
                  ))}
              </div>
            </StreamSection>
          </div>
        ) : null}
        <StatRow isLoading={loading} stats={stats} />

        <Tabs
          className="space-y-4"
          onValueChange={(value) => {
            setActiveTab(value as ContentTab);
            setSearchQuery("");
          }}
          value={activeTab}
        >
          <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
            <TabsTrigger value="insights">Insights ({insights.length})</TabsTrigger>
            <TabsTrigger value="ideas">Ideas &amp; Bases ({ideas.length})</TabsTrigger>
            <TabsTrigger value="drafts">Posts ({activeDrafts.length})</TabsTrigger>
            <TabsTrigger value="published">Published ({publishedDrafts.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4">
            <ListSurface
              count={filteredInsights.length}
              description="Calculated demand from product modules. Outreach is the first provider; gaps are recalculated from current coverage."
              emptyState={(
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <Lightbulb className="mb-4 h-8 w-8 text-muted-foreground" />
                  <p className="max-w-xl text-sm text-muted-foreground">
                    {searchQuery
                      ? `No insights match “${searchQuery}”.`
                      : insightState === "content_gap"
                        ? "No actionable content gaps right now. Research accounts in Outreach to create opportunity demand."
                        : "No calculated insights in this state."}
                  </p>
                  {searchQuery ? (
                    <Button className="mt-4" onClick={() => setSearchQuery("")} variant="outline">
                      Clear search
                    </Button>
                  ) : null}
                </div>
              )}
              filters={(
                <FilterSelect
                  label="State"
                  onValueChange={(value) => setInsightState(value as ContentInsightState | "all")}
                  options={[
                    { value: "content_gap", label: "Content needed" },
                    { value: "solution_gap", label: "Solution gaps" },
                    { value: "account_ineligible", label: "Ineligible accounts" },
                    { value: "covered", label: "Covered" },
                    { value: "all", label: "All insights" },
                  ]}
                  value={insightState}
                />
              )}
              isLoading={loading}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search insights…"
              searchValue={searchQuery}
              title="Demand insights"
            >
              {!loading && filteredInsights.length > 0 ? (
                <ListRows>
                  {filteredInsights.map((insight: ContentInsight) => {
                    const state = insightStateConfig[insight.state];
                    return (
                      <ListRow
                        actions={insight.state === "content_gap" ? [{
                          disabled: creatingInsightId != null,
                          icon: PenLine,
                          label: creatingInsightId === insight.id
                            ? "Creating content idea"
                            : "Create content idea",
                          onSelect: () => void createIdeaFromInsight(insight),
                        }] : []}
                        badge={<Badge variant={state.variant}>{state.label}</Badge>}
                        detail={<p className="text-xs leading-5 text-muted-foreground">{insight.reason}</p>}
                        key={insight.id}
                        meta={[
                          insight.providerLabel,
                          insight.context?.label ?? "Workspace demand",
                          insight.supportingMatch
                            ? `${insight.supportingMatch.label} ${insight.supportingMatch.score}%`
                            : "No catalogue match",
                          `Content ${insight.currentContentScore}% / ${insight.contentThreshold}% required`,
                          insight.context?.fitScore != null ? `ICP ${Math.round(insight.context.fitScore)}%` : "ICP unscored",
                          insight.context?.timingScore != null ? `Timing ${Math.round(insight.context.timingScore)}%` : "No timing",
                        ]}
                        title={insight.title}
                      />
                    );
                  })}
                </ListRows>
              ) : null}
            </ListSurface>
            {insightFeed?.calculationStatus !== "ready" ? (
              <p className="text-xs text-muted-foreground">
                {insightFeed?.unavailableReasons.join(" ") || "Some insight providers are unavailable."}
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="ideas" className="space-y-4">
            <ListSurface
              count={filteredIdeas.length}
              description="Capture a rough Idea, then refine it into a grounded Content Base."
              emptyState={
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <Sparkles className="mb-4 h-8 w-8 text-muted-foreground" />
                  <p className="mb-4 text-sm text-muted-foreground">
                    {searchQuery
                      ? `No Ideas or Content Bases match “${searchQuery}”.`
                      : "Capture a rough idea or generate ideas from your Projects, Research, and Topics."}
                  </p>
                  {searchQuery ? (
                    <Button onClick={() => setSearchQuery("")} variant="outline">
                      Clear search
                    </Button>
                  ) : null}
                </div>
              }
              isLoading={loading}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search Ideas and Content Bases…"
              searchValue={searchQuery}
              title="Ideas & Content Bases"
            >
              {!loading && filteredIdeas.length > 0 ? (
                <ListRows>
                  {filteredIdeas.map((idea) => (
                    <ListRow
                      actions={[{
                        href: `/content/${idea.id}`,
                        icon: ArrowRight,
                        label: `Open ${idea.title}`,
                      }]}
                      badge={
                        <Badge variant={statusConfig[idea.status].variant}>
                          {statusConfig[idea.status].label}
                        </Badge>
                      }
                      href={`/content/${idea.id}`}
                      key={idea.id}
                      meta={[
                        idea.description,
                        (idea.sourceTopics ?? []).length > 0
                          ? `${(idea.sourceTopics ?? []).map((topic) => topic.name).join(", ")}`
                          : "No source topics",
                        `${priorityConfig[idea.priority].label} priority`,
                        <span key="created" title={new Date(idea.createdAt).toLocaleString()}>
                          {formatDistanceToNow(new Date(idea.createdAt), { addSuffix: true })}
                        </span>,
                      ]}
                      title={idea.title}
                    />
                  ))}
                </ListRows>
              ) : null}
            </ListSurface>
          </TabsContent>

          {/* Posts Tab */}
          <TabsContent value="drafts" className="space-y-4">
            <ListSurface
              count={filteredActiveDrafts.length}
              description="Channel-ready Posts generated from your Content Bases."
              emptyState={
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <PenLine className="mb-4 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery
                      ? `No Posts match “${searchQuery}”.`
                      : "Generate a Post from a Content Base to see it here."}
                  </p>
                  {searchQuery && (
                    <Button className="mt-4" onClick={() => setSearchQuery("")} variant="outline">
                      Clear search
                    </Button>
                  )}
                </div>
              }
              isLoading={loading}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search Posts…"
              searchValue={searchQuery}
              title="Posts"
            >
              {!loading && filteredActiveDrafts.length > 0 ? (
                <ListRows>
                  {filteredActiveDrafts.map((draft) => {
                    const config = typeConfig[draft.type];
                    return (
                      <ListRow
                        actions={[
                          {
                            href: `/resonance?post=${draft.id}`,
                            icon: AudioWaveform,
                            label: `Compare ${draft.title} in Resonance`,
                          },
                          {
                            href: `/content/${draft.ideaId}/posts/${draft.id}`,
                            icon: ArrowRight,
                            label: `Open ${draft.title}`,
                          },
                        ]}
                        badge={
                          <Badge variant={statusConfig[draft.status].variant}>
                            {statusConfig[draft.status].label}
                          </Badge>
                        }
                        href={`/content/${draft.ideaId}/posts/${draft.id}`}
                        key={draft.id}
                        meta={[
                          config.label,
                          <span key="created" title={new Date(draft.createdAt).toLocaleString()}>
                            {formatDistanceToNow(new Date(draft.createdAt), { addSuffix: true })}
                          </span>,
                        ]}
                        title={draft.title}
                      />
                    );
                  })}
                </ListRows>
              ) : null}
            </ListSurface>
          </TabsContent>

          {/* Published Tab */}
          <TabsContent value="published" className="space-y-4">
            <ListSurface
              count={filteredPublishedDrafts.length}
              description="Published content with performance context."
              emptyState={
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <Check className="mb-4 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery
                      ? `No published content matches “${searchQuery}”.`
                      : "Published content appears here with performance notes."}
                  </p>
                  {searchQuery && (
                    <Button className="mt-4" onClick={() => setSearchQuery("")} variant="outline">
                      Clear search
                    </Button>
                  )}
                </div>
              }
              isLoading={loading}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search published content…"
              searchValue={searchQuery}
              title="Published"
            >
              {!loading && filteredPublishedDrafts.length > 0 ? (
                <ListRows>
                  {filteredPublishedDrafts.map((draft) => {
                    const config = typeConfig[draft.type];
                    const performance = draft.performanceLevel
                      ? performanceConfig[draft.performanceLevel].label
                      : "No performance data";
                    return (
                      <ListRow
                        actions={[
                          ...(draft.publishedUrl ? [{
                            external: true,
                            href: draft.publishedUrl,
                            icon: ExternalLink,
                            label: "Open published content",
                          }] : []),
                          {
                            href: `/content/${draft.ideaId}/posts/${draft.id}`,
                            icon: ArrowRight,
                            label: `Open ${draft.title}`,
                          },
                        ]}
                        badge={<Badge variant="default">Published</Badge>}
                        href={`/content/${draft.ideaId}/posts/${draft.id}`}
                        key={draft.id}
                        meta={[
                          ...(draft.performanceInsights ? [draft.performanceInsights] : []),
                          config.label,
                          performance,
                          draft.publishedAt ? (
                            <span key="published" title={new Date(draft.publishedAt).toLocaleString()}>
                              {formatDistanceToNow(new Date(draft.publishedAt), { addSuffix: true })}
                            </span>
                          ) : "Publication date unavailable",
                        ]}
                        title={draft.title}
                      />
                    );
                  })}
                </ListRows>
              ) : null}
            </ListSurface>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
