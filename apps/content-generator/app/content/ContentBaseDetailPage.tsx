"use client";

import * as React from "react";
import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Video,
  Image as ImageIcon,
  FileText,
  Twitter,
  Linkedin,
  AtSign,
  MessageSquareText,
  Megaphone,
  AudioWaveform,
  RefreshCw,
  PenLine,
  ArrowLeft,
  ArrowRight,
  FileQuestion,
  Loader2,
  Trash2,
  Copy,
  Check,
} from "lucide-react";

import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { ReasoningTicker, StreamList, StreamSection, StreamingText } from "@/components/genui";
import { useCapabilityStream } from "@content-automation/ui/hooks/use-capability-stream";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_CONFIG,
  type ContentIdea,
  type ContentDraft,
  type ContentType,
} from "@/products/content-generator/domain/content";
import { resonanceProfileFor } from "@/products/content-generator/domain/resonance-experiment";
import { VisualBriefDialog } from "@/products/content-generator/ui/components/VisualBriefDialog";
import { MediaGenerationCard } from "@/products/content-generator/ui/components/MediaGenerationCard";
import { MediaPreview } from "@/products/content-generator/ui/components/MediaPreview";
import { CopyablePrompt } from "@/products/content-generator/ui/components/CopyablePrompt";
import type { BaseMediaOverview, CreativeRunView, MediaKind, VisualBrief } from "@/products/content-generator/ui/components/media-types";

function VISUAL_LABEL(value: string): string {
  return value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

const priorityConfig = {
  low: { label: "Low", variant: "outline" as const },
  medium: { label: "Medium", variant: "outline" as const },
  high: { label: "High", variant: "outline" as const },
};

const statusConfig = {
  idea: { label: "Angle", variant: "secondary" as const },
  refined: { label: "Content Base", variant: "default" as const },
  draft: { label: "Post", variant: "secondary" as const },
};

const draftStatusConfig = {
  draft: { label: "Post", variant: "secondary" as const },
  ready: { label: "Ready", variant: "default" as const },
  published: { label: "Published", variant: "default" as const },
};

const typeConfig: Record<ContentType, { icon: React.ElementType; label: string }> = {
  video_script: { icon: Video, label: "YouTube" },
  blog_post: { icon: FileText, label: "Blog" },
  x_post: { icon: AtSign, label: "X post" },
  tweet_thread: { icon: Twitter, label: "X thread" },
  linkedin_post: { icon: Linkedin, label: "LinkedIn" },
  social_post: { icon: MessageSquareText, label: "Social" },
  ad_campaign: { icon: Megaphone, label: "Ad campaign" },
};

function streamErrorMessage(error: string, action: string): string {
  return /failed to fetch|networkerror/i.test(error)
    ? `${action} was interrupted before completion. Check your connection and try again.`
    : error;
}

export default function ContentBaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [idea, setIdea] = useState<ContentIdea | null>(null);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState<BaseMediaOverview | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefKind, setBriefKind] = useState<MediaKind>("image");
  const [briefParentAssetId, setBriefParentAssetId] = useState<string | null>(null);
  const [startingMedia, setStartingMedia] = useState(false);
  const [pendingMediaBrief, setPendingMediaBrief] = useState<VisualBrief | null>(null);
  const [assetActionId, setAssetActionId] = useState<string | null>(null);
  const [selectedMediaForPost, setSelectedMediaForPost] = useState<string[]>([]);
  const [selectedPostType, setSelectedPostType] = useState<ContentType>("linkedin_post");
  const lastGroundingCount = React.useRef(0);
  const refineStream = useCapabilityStream<{
    outline?: string[]; key_points?: string[]; keyPoints?: string[];
  }, { refined: true; mode?: "live" | "local" }>({ api: `/content/ideas/${id}/refine` });
  const draftStream = useCapabilityStream<{
    title?: string; introduction?: string; sections?: string[]; conclusion?: string;
    tweets?: string[]; hook?: string; body?: string; main_sections?: string[];
    post?: string; headline?: string; primary_text?: string; description?: string; call_to_action?: string;
  }, { draftId: string }>({ api: `/content/ideas/${id}/draft` });
  const refining = refineStream.isStreaming;
  const generatingDraft = draftStream.isStreaming;
  const generatingContent = generatingDraft || startingMedia;

  const fetchIdea = React.useCallback(async (cancelled: () => boolean = () => false) => {
    try {
      const data = await apiGet<{ idea: ContentIdea }>(`/content/ideas/${id}`);
      if (cancelled()) return;
      setIdea(data.idea);
    } catch (error) {
      if (cancelled()) return;
      console.error("Error fetching Content Base:", error);
      toast.error("Could not load the Content Base. Refresh to try again.");
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }, [id]);

  const fetchDrafts = React.useCallback(async (cancelled: () => boolean = () => false) => {
    try {
      const data = await apiGet<{ items: ContentDraft[] }>(`/content/drafts`, { ideaId: id, limit: 100 });
      if (cancelled()) return;
      setDrafts(data.items);
    } catch (error) {
      if (cancelled()) return;
      console.error("Error fetching drafts:", error);
    }
  }, [id]);

  const fetchMedia = React.useCallback(async (silent = false, cancelled: () => boolean = () => false) => {
    try {
      const data = await apiGet<BaseMediaOverview>(`/content/ideas/${id}/media`);
      if (!cancelled()) setMedia(data);
    } catch (error) {
      if (!cancelled() && !silent) toast.error(error instanceof Error ? error.message : "Could not load Content Base media.");
    } finally {
      if (!cancelled()) setMediaLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    const cancelled = () => !active;
    void fetchIdea(cancelled);
    void fetchDrafts(cancelled);
    void fetchMedia(false, cancelled);
    return () => { active = false; };
  }, [fetchDrafts, fetchIdea, fetchMedia]);

  const handleRefine = () => refineStream.start();
  const handleGenerateDraft = () => {
    if (selectedMediaForPost.length === 0) {
      toast.error("Select at least one image to ground the Post.");
      return;
    }
    lastGroundingCount.current = selectedMediaForPost.length;
    draftStream.start({
      contentType: selectedPostType,
      mediaAssetIds: selectedMediaForPost,
    });
  };
  const togglePostGroundingImage = (assetId: string) => {
    setSelectedMediaForPost((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      if (current.length >= 4) {
        toast.error("Select no more than four images for one Post.");
        return current;
      }
      return [...current, assetId];
    });
  };
  const handleGenerateMedia = (kind: MediaKind, parentAssetId?: string) => {
    setBriefKind(kind);
    setBriefParentAssetId(parentAssetId ?? null);
    setBriefOpen(true);
  };
  const submitVisualBrief = async (brief: VisualBrief, retryParentAssetId?: string | null) => {
    const parentAssetId = retryParentAssetId === undefined ? briefParentAssetId : retryParentAssetId;
    setBriefOpen(false);
    setPendingMediaBrief(brief);
    setStartingMedia(true);
    try {
      const { data } = await apiMutate<{ run: CreativeRunView }>("POST", `/content/ideas/${id}/media`, {
        brief,
        ...(parentAssetId ? { parentAssetId } : {}),
      });
      setMedia((current) => current ? {
        ...current,
        runs: [data.run, ...current.runs.filter((run) => run.id !== data.run.id)],
      } : current);
      setPendingMediaBrief(null);
      toast.success(brief.kind === "image" ? "Image generation started" : "Video generation started");
      await fetchMedia(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Media generation could not start.");
      await fetchMedia(true);
    } finally {
      setPendingMediaBrief(null);
      setStartingMedia(false);
    }
  };

  const attachAssetToPost = async (assetId: string, postId: string) => {
    if (postId === "none") return;
    setAssetActionId(assetId);
    try {
      await apiMutate("POST", `/content/drafts/${postId}/media-links`, { assetId });
      toast.success("Media attached to the Post");
      await fetchMedia(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not attach media."); }
    finally { setAssetActionId(null); }
  };

  const removeAsset = async (assetId: string) => {
    const postIds = [...new Set((media?.usage ?? []).filter((usage) => usage.assetId === assetId).map((usage) => usage.postId))];
    const postNames = postIds.map((postId) => drafts.find((draft) => draft.id === postId)?.title ?? "Untitled Post");
    const disclosure = postNames.length
      ? `This media is used by ${postNames.length} Post${postNames.length === 1 ? "" : "s"}:\n\n${postNames.join("\n")}\n\nDeleting it removes those usage links but keeps every Post.`
      : "Delete this media from the Content Base? Posts are not deleted.";
    if (!window.confirm(disclosure)) return;
    setAssetActionId(assetId);
    try {
      await apiMutate("DELETE", `/content/ideas/${id}/media/${assetId}`, { confirm: true });
      toast.success("Media deleted from the Content Base");
      setSelectedMediaForPost((current) => current.filter((selectedId) => selectedId !== assetId));
      await fetchMedia(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete media."); }
    finally { setAssetActionId(null); }
  };

  useEffect(() => {
    if (!refineStream.final) return;
    void fetchIdea();
    if (refineStream.final.mode === "local") {
      toast.success("Content Base built locally from your Idea.");
    }
  }, [fetchIdea, refineStream.final]);
  useEffect(() => {
    if (!draftStream.final) return;
    void fetchDrafts();
    void fetchMedia(true);
    setSelectedMediaForPost([]);
    toast.success(`Post generated with ${lastGroundingCount.current} selected image${lastGroundingCount.current === 1 ? "" : "s"}`);
    router.push(`/content/${id}/posts/${draftStream.final.draftId}`);
  }, [draftStream.final, fetchDrafts, fetchMedia, id, router]);
  useEffect(() => {
    if (refineStream.error) toast.error(streamErrorMessage(refineStream.error, "Content Base generation"));
  }, [refineStream.error]);
  useEffect(() => {
    if (draftStream.error) toast.error(streamErrorMessage(draftStream.error, "Post generation"));
  }, [draftStream.error]);

  const visibleMediaRuns = media?.runs.filter((run) => ["preparing", "queued", "submitted", "processing", "failed", "cancelled"].includes(run.status)) ?? [];
  const activeMediaRuns = visibleMediaRuns.filter((run) => ["preparing", "queued", "submitted", "processing"].includes(run.status));
  const hasActiveMedia = activeMediaRuns.length > 0;
  useEffect(() => {
    if (!hasActiveMedia) return;
    const interval = window.setInterval(() => void fetchMedia(true), 5_000);
    return () => window.clearInterval(interval);
  }, [fetchMedia, hasActiveMedia]);

  const backLink = (
    <Link
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      href="/content"
    >
      <ArrowLeft className="size-4" /> All content
    </Link>
  );

  if (loading) {
    return (
      <div className="w-full min-w-0">
        {backLink}
        <div className="mb-8">
          <Skeleton className="h-9 w-full max-w-sm" />
        </div>
        <div className="space-y-8">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-24" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!idea) {
    return (
      <div className="w-full min-w-0">
        {backLink}
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileQuestion className="mb-4 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This Content Base doesn&apos;t exist or was removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`w-full min-w-0 ${selectedMediaForPost.length ? "pb-28" : ""}`}>
      {backLink}
      <PageHeader
        title={idea.title}
        description={idea.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {idea.status === "idea" && (
              <Button onClick={handleRefine} disabled={refining}>
                {refining ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Build Content Base
              </Button>
            )}
            {idea.status === "refined" && (
              <Button
                disabled={generatingContent}
                onClick={() => document.getElementById("create-media-grounded-post")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <PenLine className="h-4 w-4" />
                Generate Post
              </Button>
            )}
            {idea.status === "refined" && (
              <Button
                disabled={generatingContent}
                onClick={() => handleGenerateMedia("image")}
                variant="outline"
              >
                {startingMedia && briefKind === "image" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                Generate image
              </Button>
            )}
            {idea.status === "refined" && (
              <Button
                disabled={generatingContent}
                onClick={() => handleGenerateMedia("video")}
                variant="outline"
              >
                {startingMedia && briefKind === "video" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Video className="h-4 w-4" />
                )}
                Generate video
              </Button>
            )}
          </div>
        }
      />

      <VisualBriefDialog
        initialKind={briefKind}
        onOpenChange={setBriefOpen}
        onSubmit={submitVisualBrief}
        open={briefOpen}
        submitLabel={briefParentAssetId ? "Generate variation" : "Generate media"}
        submitting={startingMedia}
        title={briefParentAssetId ? "Create a media variation" : "Visual Brief"}
      />

      {idea.status === "refined" ? (
        <Card className="mb-8" id="create-media-grounded-post">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PenLine className="size-5" />Create a media-grounded Post</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select the images first. Their pixels, Visual Briefs, and complete generation prompts will ground the Post, and the relationship will be saved with it.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(media?.assets ?? []).some((asset) => asset.mediaKind === "image") ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(media?.assets ?? []).filter((asset) => asset.mediaKind === "image").map((asset) => {
                  const selected = selectedMediaForPost.includes(asset.id);
                  return (
                    <button
                      aria-label={`${selected ? "Remove" : "Select"} ${asset.description} ${selected ? "from" : "for"} Post grounding`}
                      aria-pressed={selected}
                      className={`group overflow-hidden rounded-xl border text-left transition ${selected ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/60"}`}
                      disabled={generatingContent}
                      key={asset.id}
                      onClick={() => togglePostGroundingImage(asset.id)}
                      type="button"
                    >
                      <div className="relative aspect-video bg-muted/20">
                        <MediaPreview asset={asset} />
                        {selected ? <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-4" /></span> : null}
                      </div>
                      <div className="space-y-1 p-3">
                        <p className="truncate text-sm font-medium">{VISUAL_LABEL(asset.visualType)}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{asset.description}</p>
                        <p className={`text-xs font-medium ${selected ? "text-primary" : "text-muted-foreground"}`}>{selected ? "Grounding next Post" : "Select for Post"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <ImageIcon className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Generate an image before creating a Post</p>
                <p className="mt-1 text-xs text-muted-foreground">Posts now require at least one Base image as explicit grounding.</p>
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-xl bg-muted/25 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium">{selectedMediaForPost.length ? `${selectedMediaForPost.length} image${selectedMediaForPost.length === 1 ? "" : "s"} selected` : "Select at least one image"}</p>
                <p className="text-xs text-muted-foreground">Up to four images can jointly ground one Post. Generate as many Posts as you need from this Content Base.</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <Select
                  disabled={generatingContent}
                  onValueChange={(value) => setSelectedPostType(value as ContentType)}
                  value={selectedPostType}
                >
                  <SelectTrigger aria-label="Post format" className="w-full sm:w-[260px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-w-sm">
                    {CONTENT_TYPES.map((type) => {
                      const config = CONTENT_TYPE_CONFIG[type];
                      const profile = resonanceProfileFor(type);
                      const Icon = typeConfig[type].icon;
                      return (
                        <SelectItem className="py-2" key={type} textValue={config.label} value={type}>
                          <div className="flex min-w-0 items-start gap-2">
                            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0"><p>{config.label}</p><p className="text-xs text-muted-foreground">Resonance: {profile.frames.map((frame) => profile.frameLabels[frame] ?? frame).join(" · ")}</p></div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  className="shrink-0"
                  disabled={generatingContent || selectedMediaForPost.length === 0}
                  onClick={handleGenerateDraft}
                >
                  {generatingDraft ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
                  {generatingDraft ? "Generating Post…" : "Generate Post"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {idea.status === "refined" ? (
        <div className="mb-8" id="content-base-posts">
          <ListCard
            title={`Posts (${drafts.length})`}
            description="Every Post created from this Content Base stays here. Select new grounding images above whenever you want to generate another one."
          >
            {drafts.length ? (
              <ListRows>
                {drafts.map((draft) => {
                  const config = typeConfig[draft.type];
                  const Icon = config.icon;
                  const status = draftStatusConfig[draft.status];
                  const draftImages = media?.usage.filter((usage) => usage.postId === draft.id && usage.asset.mimeType.startsWith("image/")) ?? [];
                  const thumbnail = draftImages[0]?.asset;
                  return (
                    <ListRow
                      actions={[
                        {
                          href: `/resonance?post=${draft.id}`,
                          icon: AudioWaveform,
                          label: `Compare ${draft.title} in Resonance`,
                        },
                        {
                          href: `/content/${idea.id}/posts/${draft.id}`,
                          icon: ArrowRight,
                          label: `Open ${draft.title}`,
                        },
                      ]}
                      badge={<Badge variant={status.variant}>{status.label}</Badge>}
                      href={`/content/${idea.id}/posts/${draft.id}`}
                      key={draft.id}
                      leading={
                        thumbnail ? (
                          <span className="block size-9 overflow-hidden rounded-xl"><MediaPreview asset={thumbnail} /></span>
                        ) : (
                          <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span>
                        )
                      }
                      meta={[config.label, `${draftImages.length} linked image${draftImages.length === 1 ? "" : "s"}`]}
                      title={draft.title}
                    />
                  );
                })}
              </ListRows>
            ) : (
              <div className="px-6 py-7 text-sm text-muted-foreground">
                No Posts yet. Select at least one image above, choose a format, and click Generate Post.
              </div>
            )}
          </ListCard>
        </div>
      ) : null}

      <div className="space-y-8">
        {(refineStream.isStreaming || refineStream.partial) && idea.status !== "refined" && (
          <div className="space-y-4">
            <ReasoningTicker text={refineStream.reasoning} active={refineStream.isStreaming} />
            <div className="grid gap-4 md:grid-cols-2">
              <StreamSection title="Outline" state={refineStream.isStreaming ? "streaming" : "done"}>
                <StreamList items={(refineStream.partial?.outline ?? []).filter(Boolean)} />
              </StreamSection>
              <StreamSection title="Key points" state={refineStream.isStreaming ? "streaming" : "done"}>
                <StreamList items={(refineStream.partial?.key_points ?? refineStream.partial?.keyPoints ?? []).filter(Boolean)} />
              </StreamSection>
            </div>
          </div>
        )}

        {(draftStream.isStreaming || (draftStream.partial && !draftStream.final)) && (
          <div className="space-y-4">
            <ReasoningTicker text={draftStream.reasoning} active={draftStream.isStreaming} />
            <StreamSection title="Post" state={draftStream.isStreaming ? "streaming" : "done"}>
              <StreamingText done={!draftStream.isStreaming} text={[
                draftStream.partial?.title && `# ${draftStream.partial.title}`,
                draftStream.partial?.hook,
                draftStream.partial?.post,
                draftStream.partial?.headline,
                draftStream.partial?.primary_text,
                draftStream.partial?.description,
                draftStream.partial?.introduction,
                ...(draftStream.partial?.sections ?? []),
                ...(draftStream.partial?.main_sections ?? []),
                ...(draftStream.partial?.tweets ?? []).map((tweet, index) => `${index + 1}/ ${tweet}`),
                draftStream.partial?.body,
                draftStream.partial?.conclusion,
                draftStream.partial?.call_to_action,
              ].filter(Boolean).join("\n\n")} />
            </StreamSection>
          </div>
        )}
        {/* Status */}
        <div className="flex items-center gap-2">
          <Badge variant={statusConfig[idea.status].variant}>
            {statusConfig[idea.status].label}
          </Badge>
          <Badge variant={priorityConfig[idea.priority].variant}>
            {priorityConfig[idea.priority].label}
          </Badge>
        </div>

        {/* Idea Details */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Rationale</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{idea.rationale}</p>
            </CardContent>
          </Card>

          {idea.sourceTopics && idea.sourceTopics.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Source topics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {idea.sourceTopics.map((topic) => (
                    <Badge key={topic.id} variant="outline">
                      {topic.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {idea.sourceInsight && (
            <Card>
              <CardHeader>
                <CardTitle>Source insight</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {idea.sourceInsight.provider === "outreach"
                      ? "Outreach"
                      : idea.sourceInsight.provider}
                  </Badge>
                  {idea.sourceInsight.contextLabel && (
                    <span className="text-muted-foreground">
                      {idea.sourceInsight.contextLabel}
                    </span>
                  )}
                </div>
                <p className="font-medium">{idea.sourceInsight.title}</p>
                {idea.sourceInsight.evidence.length > 0 && (
                  <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                    {idea.sourceInsight.evidence.map((item, index) => (
                      <li key={`${idea.sourceInsight?.sourceId}-${index}`}>{item}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Calculated {formatDistanceToNow(new Date(idea.sourceInsight.generatedAt), { addSuffix: true })}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Refined Content */}
        {idea.status === "refined" && (
          <div className="grid gap-6 md:grid-cols-2">
            {idea.outline && idea.outline.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Outline</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {idea.outline.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {idea.keyPoints && idea.keyPoints.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Key points</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {idea.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {idea.suggestedCitations && idea.suggestedCitations.length > 0 && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Suggested citations</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {idea.suggestedCitations.map((citation, i) => (
                      <li key={i}>{citation}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {idea.status === "refined" && (
          <Card>
            <CardHeader>
              <CardTitle>Media gallery</CardTitle>
              <p className="text-sm text-muted-foreground">Images and videos belong to this Content Base. Posts only reference them.</p>
            </CardHeader>
            <CardContent className="space-y-5">
              {mediaLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton className="aspect-square" key={index} />)}</div>
              ) : pendingMediaBrief || visibleMediaRuns.length || media?.assets.length ? (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {pendingMediaBrief ? (
                    <MediaGenerationCard brief={pendingMediaBrief} />
                  ) : null}
                  {visibleMediaRuns.map((run) => (
                    <MediaGenerationCard
                      brief={run.visualBrief}
                      key={run.id}
                      onRetry={["failed", "cancelled"].includes(run.status)
                        ? () => void submitVisualBrief(run.visualBrief, run.parentAssetId)
                        : undefined}
                      run={run}
                    />
                  ))}
                  {(media?.assets ?? []).map((asset) => {
                    const run = media?.runs.find((entry) => entry.id === asset.generationRunId);
                    const usedBy = media?.usage.filter((usage) => usage.assetId === asset.id) ?? [];
                    const sourceLineage = asset.metadata.sourceLineage as {
                      topics?: Array<{ id: string; name: string }>;
                      research?: Array<{ id: string; title: string }>;
                      claimIds?: string[];
                      evidenceIds?: string[];
                      citations?: string[];
                    } | undefined;
                    return (
                      <article className="overflow-hidden rounded-xl border bg-card" key={asset.id}>
                        <div className="aspect-square bg-muted/20"><MediaPreview asset={asset} /></div>
                        <div className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="font-medium">{VISUAL_LABEL(asset.visualType)}</p><p className="mt-1 text-xs text-muted-foreground">{asset.description}</p></div>
                            <Badge variant="outline">{asset.mediaKind}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                            <span>{formatDistanceToNow(new Date(asset.createdAt), { addSuffix: true })}</span>
                            {asset.originPostId ? <Badge variant="secondary">Created from a Post</Badge> : <Badge variant="secondary">Created from Base</Badge>}
                            {asset.parentAssetId ? <Badge variant="outline">Variation</Badge> : null}
                            {usedBy.length ? <Badge variant="outline">Used by {usedBy.length} Post{usedBy.length === 1 ? "" : "s"}</Badge> : null}
                          </div>
                          {run ? (
                            <details className="rounded-lg bg-muted/25 p-3 text-xs">
                              <summary className="cursor-pointer font-medium">Generation attribution</summary>
                              <dl className="mt-2 space-y-2 text-muted-foreground">
                                {run.visualBrief.exactOnMediaText ? <div><dt className="font-medium text-foreground">Exact text</dt><dd>{run.visualBrief.exactOnMediaText}</dd></div> : null}
                                {run.visualBrief.creativeDirection ? <div><dt className="font-medium text-foreground">Direction</dt><dd>{run.visualBrief.creativeDirection}</dd></div> : null}
                                <div><dt className="sr-only">Compiled prompt</dt><dd><CopyablePrompt label="Compiled prompt" prompt={run.provenance.compiledPrompt} /></dd></div>
                                {run.provenance.negativePrompt ? <div><dt className="font-medium text-foreground">Negative prompt</dt><dd>{run.provenance.negativePrompt}</dd></div> : null}
                                <div><dt className="font-medium text-foreground">Execution</dt><dd>{run.provenance.rendererVersion ?? `${run.provenance.provider} · ${run.provenance.deploymentId}`}</dd></div>
                                <div><dt className="font-medium text-foreground">Parameters</dt><dd>{JSON.stringify(run.provenance.providerParams)}</dd></div>
                                <div><dt className="font-medium text-foreground">Sources used</dt><dd>{[
                                  `${sourceLineage?.research?.length ?? 0} research`,
                                  `${sourceLineage?.topics?.length ?? 0} topics`,
                                  `${sourceLineage?.claimIds?.length ?? 0} facts`,
                                  `${sourceLineage?.evidenceIds?.length ?? 0} evidence`,
                                ].join(" · ")}</dd></div>
                                {asset.parentAssetId ? <div><dt className="font-medium text-foreground">Derived from</dt><dd>{asset.parentAssetId}</dd></div> : null}
                                {asset.originPostId ? <div><dt className="font-medium text-foreground">Originating Post</dt><dd>{drafts.find((draft) => draft.id === asset.originPostId)?.title ?? asset.originPostId}</dd></div> : null}
                              </dl>
                            </details>
                          ) : null}
                          <div className="grid gap-2">
                            {asset.mediaKind === "image" ? (
                              <Button
                                aria-pressed={selectedMediaForPost.includes(asset.id)}
                                disabled={generatingContent}
                                onClick={() => togglePostGroundingImage(asset.id)}
                                variant={selectedMediaForPost.includes(asset.id) ? "default" : "outline"}
                              >
                                {selectedMediaForPost.includes(asset.id) ? <Check className="size-4" /> : <ImageIcon className="size-4" />}
                                {selectedMediaForPost.includes(asset.id) ? "Selected for next Post" : "Use to ground next Post"}
                              </Button>
                            ) : null}
                            {drafts.length ? (
                              <Select disabled={assetActionId === asset.id} onValueChange={(value) => void attachAssetToPost(asset.id, value)}>
                                <SelectTrigger><SelectValue placeholder="Use in existing Post" /></SelectTrigger>
                                <SelectContent>{drafts.map((draft) => <SelectItem key={draft.id} value={draft.id}>{draft.title}</SelectItem>)}</SelectContent>
                              </Select>
                            ) : null}
                            <div className="flex gap-2">
                              <Button className="flex-1" disabled={assetActionId === asset.id} onClick={() => handleGenerateMedia(asset.mediaKind, asset.id)} size="sm" variant="outline"><Copy className="size-4" />Variation</Button>
                              <Button aria-label={`Delete ${asset.description}`} disabled={assetActionId === asset.id} onClick={() => void removeAsset(asset.id)} size="sm" variant="ghost"><Trash2 className="size-4" /></Button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center"><ImageIcon className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No Base media yet</p><p className="mt-1 text-xs text-muted-foreground">Generate an image or video with a Visual Brief.</p></div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span title={new Date(idea.createdAt).toLocaleString()}>
                Created {formatDistanceToNow(new Date(idea.createdAt), { addSuffix: true })}
              </span>
              <span title={new Date(idea.updatedAt).toLocaleString()}>
                Updated {formatDistanceToNow(new Date(idea.updatedAt), { addSuffix: true })}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
      {idea.status === "refined" && selectedMediaForPost.length > 0 ? (
        <div
          aria-label="Generate grounded Post"
          className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-3 rounded-2xl border bg-background/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:right-5 sm:w-[560px] sm:flex-row sm:items-center"
          role="region"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{selectedMediaForPost.length} image{selectedMediaForPost.length === 1 ? "" : "s"} selected</p>
            <p className="truncate text-xs text-muted-foreground">Ready to generate another Post from this Content Base.</p>
          </div>
          <Select
            disabled={generatingContent}
            onValueChange={(value) => setSelectedPostType(value as ContentType)}
            value={selectedPostType}
          >
            <SelectTrigger aria-label="Quick Post format" className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{CONTENT_TYPE_CONFIG[type].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={generatingContent} onClick={handleGenerateDraft}>
            {generatingDraft ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            {generatingDraft ? "Generating…" : "Generate Post"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
