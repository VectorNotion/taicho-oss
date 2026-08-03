"use client";

import * as React from "react";
import { useState, useEffect } from "react";
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
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { ListSurface } from "@/components/ListSurface";
import { StatRow } from "@/components/StatRow";
import { ReasoningTicker, StreamSection } from "@/components/genui";
import { useActionStream } from "@/hooks/use-action-stream";
import type {
  ContentIdea,
  ContentDraft,
  ContentType,
} from "@/products/content-generator/domain/content";

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
  idea: { label: "Angle", variant: "secondary" as const },
  refined: { label: "Content Base", variant: "default" as const },
  draft: { label: "Post", variant: "secondary" as const },
  ready: { label: "Ready", variant: "default" as const },
  published: { label: "Published", variant: "default" as const },
};

const performanceConfig = {
  high: { label: "High performance", variant: "default" as const },
  medium: { label: "Medium performance", variant: "secondary" as const },
  low: { label: "Low performance", variant: "outline" as const },
};

export default function ContentPage() {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [counts, setCounts] = useState({
    totalIdeas: 0,
    totalDrafts: 0,
    byIdeaStatus: {} as Record<string, number>,
    byDraftStatus: {} as Record<string, number>,
    byType: {} as Record<string, number>,
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const ideasStream = useActionStream<{
    ideas?: Array<{ title?: string; description?: string; priority?: string }>;
  }, { ideasCreated: number }>({ api: "/api/content/generate-ideas/stream" });
  const generating = ideasStream.isStreaming;

  const fetchData = async (signal?: AbortSignal) => {
    try {
      const [ideasRes, draftsRes, countsRes] = await Promise.all([
        fetch("/api/content/ideas", { signal }),
        fetch("/api/content/drafts", { signal }),
        fetch("/api/content/counts", { signal }),
      ]);

      if (signal?.aborted) return;
      if (ideasRes.ok) {
        setIdeas(await ideasRes.json());
      }
      if (draftsRes.ok) {
        setDrafts(await draftsRes.json());
      }
      if (countsRes.ok) {
        setCounts(await countsRes.json());
      }
      if (!ideasRes.ok || !draftsRes.ok || !countsRes.ok) {
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

  const handleGenerateIdeas = () => ideasStream.start({ count: 5 });
  useEffect(() => { if (ideasStream.final) void fetchData(); }, [ideasStream.final]);
  useEffect(() => { if (ideasStream.error) toast.error(ideasStream.error); }, [ideasStream.error]);

  const publishedDrafts = drafts.filter((d) => d.status === "published");
  const activeDrafts = drafts.filter((d) => d.status !== "published");
  const normalizedSearch = searchQuery.trim().toLowerCase();
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
      label: "Content Bases",
      value: counts.totalIdeas.toLocaleString(),
      description: `${(counts.byIdeaStatus?.refined || 0).toLocaleString()} built from angles`,
    },
    {
      label: "Posts",
      value: counts.totalDrafts.toLocaleString(),
      description: `${(counts.byDraftStatus?.draft || 0).toLocaleString()} created`,
    },
    {
      label: "Ready",
      value: (counts.byDraftStatus?.ready || 0).toLocaleString(),
      description: "Waiting for publishing",
    },
    {
      featured: true,
      label: "Published",
      value: (counts.byDraftStatus?.published || 0).toLocaleString(),
      description: "Completed content",
    },
  ];

  const generateButton = (
    <Button onClick={handleGenerateIdeas} disabled={generating}>
      {generating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      Generate angles
    </Button>
  );

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Content"
        description="Content Bases and the Posts created from them"
        actions={generateButton}
      />
      <div className="space-y-8">
        {ideasStream.isStreaming && (
          <div className="space-y-4" aria-live="polite" data-testid="ideas-stream">
            <ReasoningTicker text={ideasStream.reasoning} active />
            <StreamSection title="Generating angles" state="streaming">
              <div className="grid gap-3">
                {(ideasStream.partial?.ideas ?? []).filter((idea) => idea?.title).map((idea, index) => (
                  <div key={index} className="animate-in fade-in slide-in-from-bottom-2 rounded-lg border bg-card p-4 duration-300">
                    <div className="font-medium">{idea.title}</div>
                    {idea.description && <div className="mt-1 text-sm text-muted-foreground">{idea.description}</div>}
                  </div>
                ))}
              </div>
            </StreamSection>
          </div>
        )}
        <StatRow isLoading={loading} stats={stats} />

        {/* Tabs */}
        <Tabs
          className="space-y-4"
          defaultValue="ideas"
          onValueChange={() => setSearchQuery("")}
        >
          <TabsList>
            <TabsTrigger value="ideas">Content Bases ({ideas.length})</TabsTrigger>
            <TabsTrigger value="drafts">Posts ({activeDrafts.length})</TabsTrigger>
            <TabsTrigger value="published">Published ({publishedDrafts.length})</TabsTrigger>
          </TabsList>

          {/* Ideas Tab */}
          <TabsContent value="ideas" className="space-y-4">
            <ListSurface
              count={filteredIdeas.length}
              description="Angles and the Content Bases built from them."
              emptyState={
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <Sparkles className="mb-4 h-8 w-8 text-muted-foreground" />
                  <p className="mb-4 text-sm text-muted-foreground">
                    {searchQuery
                      ? `No Content Bases match “${searchQuery}”.`
                      : "Generate an angle, then build it into a Content Base."}
                  </p>
                  {searchQuery ? (
                    <Button onClick={() => setSearchQuery("")} variant="outline">
                      Clear search
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={handleGenerateIdeas} disabled={generating}>
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      Generate angles
                    </Button>
                  )}
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
