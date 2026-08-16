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
  RefreshCw,
} from "lucide-react";

import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import { StatRow } from "@/components/StatRow";
import type {
  ContentIdea,
  ContentDraft,
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

export default function ContentPage() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [insightFeed, setInsightFeed] = useState<ContentInsightFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingInsightId, setCreatingInsightId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [insightState, setInsightState] = useState<ContentInsightState | "all">("content_gap");

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
        description="Demand insights, Content Bases, and the Posts created from them"
        actions={(
          <Button disabled={loading} onClick={() => void fetchData()} variant="outline">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh insights
          </Button>
        )}
      />
      <div className="space-y-8">
        <StatRow isLoading={loading} stats={stats} />

        {/* Tabs */}
        <Tabs
          className="space-y-4"
          defaultValue="insights"
          onValueChange={() => setSearchQuery("")}
        >
          <TabsList>
            <TabsTrigger value="insights">Insights ({insights.length})</TabsTrigger>
            <TabsTrigger value="ideas">Content Bases ({ideas.length})</TabsTrigger>
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

          {/* Ideas Tab */}
          <TabsContent value="ideas" className="space-y-4">
            <ListSurface
              count={filteredIdeas.length}
              description="Ideas and the Content Bases built from them."
              emptyState={
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <Sparkles className="mb-4 h-8 w-8 text-muted-foreground" />
                  <p className="mb-4 text-sm text-muted-foreground">
                    {searchQuery
                      ? `No Content Bases match “${searchQuery}”.`
                      : "Content ideas and refined Content Bases appear here."}
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
              searchPlaceholder="Search Content Bases…"
              searchValue={searchQuery}
              title="Content Bases"
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
