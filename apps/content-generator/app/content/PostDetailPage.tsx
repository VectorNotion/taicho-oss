"use client";

import * as React from "react";
import { useState, useEffect, use } from "react";
import Link from "next/link";
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
  ArrowLeft,
  Check,
  ExternalLink,
  FileQuestion,
  Loader2,
  Edit,
  Copy,
  Download,
  BellRing,
  RotateCcw,
  Send,
  AudioWaveform,
  ImageIcon,
  Music2,
  Sparkles,
  Ban,
} from "lucide-react";

import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/PageHeader";
import {
  buildContentExport,
  type ContentExportFormat,
} from "@/products/content-generator/domain/content-export";
import type { ContentDraft, ContentType, PerformanceLevel } from "@/products/content-generator/domain/content";
import { PostContentPreview } from "@/products/content-generator/ui/components/PostContentPreview";

const typeConfig: Record<ContentType, { icon: React.ElementType; label: string }> = {
  video_script: { icon: Video, label: "YouTube video script" },
  blog_post: { icon: FileText, label: "Blog post" },
  x_post: { icon: AtSign, label: "X post" },
  tweet_thread: { icon: Twitter, label: "X thread" },
  linkedin_post: { icon: Linkedin, label: "LinkedIn post" },
  social_post: { icon: MessageSquareText, label: "Social post" },
  ad_campaign: { icon: Megaphone, label: "Ad campaign" },
};

const statusConfig = {
  draft: { label: "Post", variant: "secondary" as const },
  ready: { label: "Ready", variant: "default" as const },
  published: { label: "Published", variant: "default" as const },
};

const performanceConfig = {
  high: { label: "High performance", variant: "default" as const },
  medium: { label: "Medium performance", variant: "secondary" as const },
  low: { label: "Low performance", variant: "outline" as const },
};

interface ChannelSummary {
  id: string;
  destination: string;
  name: string;
}

type PublishingPostStatus = "scheduled" | "publishing" | "published" | "failed" | "cancelled";

interface PublishingPost {
  id: string;
  destination: string;
  channelId: string;
  status: PublishingPostStatus;
  attempts: number;
  publishAt: string;
  resultUrl: string | null;
  error: string | null;
  createdAt: string;
}

type CreativeMediaKind = "image" | "video" | "audio";
type CreativeRunStatus = "queued" | "submitted" | "processing" | "succeeded" | "failed" | "cancelled";

interface CreativeModelOption {
  key: string;
  name: string;
  description: string;
  recommended?: boolean;
}

interface CreativeTemplateOption {
  key: string;
  name: string;
  description: string;
  kind: CreativeMediaKind;
  assetRole: string;
  defaultAspectRatio?: string;
  allowedAspectRatios: string[];
  defaultDurationSeconds?: number;
  defaultVariations: number;
  models: CreativeModelOption[];
}

interface CreativeRun {
  id: string;
  templateKey: string;
  mediaKind: CreativeMediaKind;
  assetRole: string;
  modelKey: string;
  status: CreativeRunStatus;
  progress: number;
  error: string | null;
  estimatedCredits: number;
  createdAt: string;
}

interface CreativeAsset {
  id: string;
  generationRunId: string;
  assetRole: string;
  mediaKind: CreativeMediaKind;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  byteSize: number;
  isSelected: boolean;
  createdAt: string;
  url: string;
}

const postStatusConfig: Record<
  PublishingPostStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  scheduled: { label: "Scheduled", variant: "secondary" },
  publishing: { label: "Publishing", variant: "secondary" },
  published: { label: "Published", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const destinationLabels: Record<string, string> = {
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  cms: "CMS",
  webhook: "Webhook",
};

function destinationLabel(destination: string): string {
  return destinationLabels[destination] ?? destination;
}

function reminderInputValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function PostDetailPage({
  params,
}: {
  params: Promise<{ id?: string; baseId?: string; postId?: string }>;
}) {
  const routeParams = use(params);
  const id = routeParams.postId ?? routeParams.id ?? "";
  const contentBaseIdFromRoute = routeParams.baseId ?? (routeParams.postId ? routeParams.id : undefined);
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [performanceLevel, setPerformanceLevel] = useState<PerformanceLevel | "">("");
  const [performanceInsights, setPerformanceInsights] = useState("");
  const [showPerformanceForm, setShowPerformanceForm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reminderWhen, setReminderWhen] = useState("");
  const [reminderUpdating, setReminderUpdating] = useState(false);

  // Numeric annotation (metrics groundwork): snapshot entry, not editable state,
  // so the inputs start empty on every load.
  const [metricImpressions, setMetricImpressions] = useState("");
  const [metricClicks, setMetricClicks] = useState("");
  const [metricsPostId, setMetricsPostId] = useState("");
  const [metricsFieldError, setMetricsFieldError] = useState<string | null>(null);

  // Publishing state
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [scheduleWhen, setScheduleWhen] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [posts, setPosts] = useState<PublishingPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [retryingPostId, setRetryingPostId] = useState<string | null>(null);

  // Creative media generation state
  const [mediaTemplates, setMediaTemplates] = useState<CreativeTemplateOption[]>([]);
  const [mediaRuns, setMediaRuns] = useState<CreativeRun[]>([]);
  const [mediaAssets, setMediaAssets] = useState<CreativeAsset[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaGenerating, setMediaGenerating] = useState(false);
  const [mediaCancellingId, setMediaCancellingId] = useState<string | null>(null);
  const [mediaSelectingId, setMediaSelectingId] = useState<string | null>(null);
  const [mediaTemplateKey, setMediaTemplateKey] = useState("");
  const [mediaModelKey, setMediaModelKey] = useState("auto");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [mediaAspectRatio, setMediaAspectRatio] = useState("");
  const [mediaVariations, setMediaVariations] = useState("1");
  const [mediaDuration, setMediaDuration] = useState("5");

  const fetchDraft = async () => {
    try {
      const { draft: data } = await apiGet<{ draft: ContentDraft }>(`/content/drafts/${id}`);
      setDraft(data);
      setPublishedUrl(data.publishedUrl || "");
      setPerformanceLevel(data.performanceLevel || "");
      setPerformanceInsights(data.performanceInsights || "");
      setReminderWhen(reminderInputValue(data.scheduledFor));
    } catch (error) {
      console.error("Error fetching Post:", error);
      toast.error("Could not load the Post. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchPosts = async (silent = false) => {
    try {
      const data = await apiGet<{ posts?: PublishingPost[] }>(`/publishing/drafts/${id}/posts`);
      setPosts(data.posts ?? []);
    } catch (error) {
      console.error("Error fetching posts:", error);
      if (!silent) toast.error("Could not load publishing posts. Refresh to try again.");
    } finally {
      setPostsLoading(false);
    }
  };

  const fetchChannels = async () => {
    setChannelsLoading(true);
    try {
      const data = await apiGet<{ channels?: ChannelSummary[] }>("/publishing");
      setChannels(data.channels ?? []);
    } catch (error) {
      console.error("Error fetching channels:", error);
      toast.error("Could not load channels. Try again.");
    } finally {
      setChannelsLoading(false);
    }
  };

  const fetchCreativeMedia = async (silent = false) => {
    try {
      const data = await apiGet<{ templates?: CreativeTemplateOption[]; runs?: CreativeRun[]; assets?: CreativeAsset[] }>(`/content/drafts/${id}/media`);
      const templates = (data.templates ?? []) as CreativeTemplateOption[];
      setMediaTemplates(templates);
      setMediaRuns(data.runs ?? []);
      setMediaAssets(data.assets ?? []);
      setMediaTemplateKey((current) => current || templates[0]?.key || "");
    } catch (error) {
      console.error("Error fetching creative media:", error);
      if (!silent) toast.error("Could not load creative assets. Refresh to try again.");
    } finally {
      setMediaLoading(false);
    }
  };

  useEffect(() => {
    fetchDraft();
    fetchPosts();
    fetchCreativeMedia();
  }, [id]);

  const selectedMediaTemplate = mediaTemplates.find((template) => template.key === mediaTemplateKey);

  useEffect(() => {
    if (!selectedMediaTemplate) return;
    setMediaModelKey((current) =>
      current !== "auto" && selectedMediaTemplate.models.some((model) => model.key === current)
        ? current
        : "auto",
    );
    setMediaAspectRatio(selectedMediaTemplate.defaultAspectRatio ?? "");
    setMediaVariations(String(selectedMediaTemplate.defaultVariations));
    setMediaDuration(String(selectedMediaTemplate.defaultDurationSeconds ?? 5));
  }, [selectedMediaTemplate?.key]);

  // Refresh channels whenever the publish dialog opens.
  useEffect(() => {
    if (publishDialogOpen) fetchChannels();
  }, [publishDialogOpen]);

  // Poll while any post is still moving through the queue.
  const hasActivePosts = posts.some(
    (post) => post.status === "scheduled" || post.status === "publishing",
  );

  useEffect(() => {
    if (!hasActivePosts) return;
    const interval = setInterval(() => fetchPosts(true), 10_000);
    return () => clearInterval(interval);
  }, [hasActivePosts, id]);

  const hasActiveMediaRuns = mediaRuns.some((run) =>
    run.status === "queued" || run.status === "submitted" || run.status === "processing",
  );

  useEffect(() => {
    if (!hasActiveMediaRuns) return;
    const interval = setInterval(() => fetchCreativeMedia(true), 5_000);
    return () => clearInterval(interval);
  }, [hasActiveMediaRuns, id]);

  const startCreativeMedia = async (input: Record<string, unknown>) => {
    setMediaGenerating(true);
    try {
      await apiMutate("POST", `/content/drafts/${id}/media`, input);
      toast.success("Creative generation started");
      await fetchCreativeMedia(true);
    } catch (error) {
      console.error("Error generating creative media:", error);
      toast.error(error instanceof Error ? error.message : "Could not start creative generation.");
    } finally {
      setMediaGenerating(false);
    }
  };

  const handleGenerateCreativeMedia = async () => {
    if (!selectedMediaTemplate) return;
    await startCreativeMedia({
      templateKey: selectedMediaTemplate.key,
      modelKey: mediaModelKey === "auto" ? undefined : mediaModelKey,
      prompt: mediaPrompt.trim() || undefined,
      aspectRatio: mediaAspectRatio || undefined,
      variations: Number(mediaVariations),
      durationSeconds: selectedMediaTemplate.kind === "video" ? Number(mediaDuration) : undefined,
    });
  };

  const handleCancelCreativeRun = async (runId: string) => {
    setMediaCancellingId(runId);
    try {
      await apiMutate("POST", `/content/media/runs/${runId}/cancel`, { confirm: true });
      toast.success("Generation cancelled");
      await fetchCreativeMedia(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel generation.");
    } finally {
      setMediaCancellingId(null);
    }
  };

  const handleSelectCreativeAsset = async (asset: CreativeAsset) => {
    setMediaSelectingId(asset.id);
    try {
      await apiMutate("POST", `/content/drafts/${id}/media/${asset.id}/select`);
      toast.success("Asset selected for publishing");
      await fetchCreativeMedia(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not select this asset.");
    } finally {
      setMediaSelectingId(null);
    }
  };

  const handlePublish = async () => {
    const channel = channels.find((entry) => entry.id === selectedChannelId);
    if (!channel) return;
    setPublishing(true);
    try {
      await apiMutate("POST", `/publishing/drafts/${id}/publish`, {
        destination: channel.destination,
        channelId: channel.id,
        when: scheduleWhen ? new Date(scheduleWhen).toISOString() : undefined,
      });
      toast.success(scheduleWhen ? "Post scheduled" : "Post queued for publishing");
      setPublishDialogOpen(false);
      setSelectedChannelId("");
      setScheduleWhen("");
      fetchPosts(true);
    } catch (error) {
      console.error("Error publishing draft:", error);
      toast.error("Could not schedule the post. Try again.");
    } finally {
      setPublishing(false);
    }
  };

  const handleRetryPost = async (postId: string) => {
    setRetryingPostId(postId);
    try {
      await apiMutate("POST", `/publishing/posts/${postId}/retry`);
      toast.success("Retry scheduled");
      fetchPosts(true);
    } catch (error) {
      console.error("Error retrying post:", error);
      toast.error("Could not retry the post. Try again.");
    } finally {
      setRetryingPostId(null);
    }
  };

  const handleUpdateStatus = async (status: "ready" | "published") => {
    setUpdating(true);
    try {
      const body: Record<string, string> = { status };
      if (status === "published" && publishedUrl) {
        body.publishedUrl = publishedUrl;
      }

      await apiMutate("PATCH", `/content/drafts/${id}`, body);
      toast.success(status === "ready" ? "Post marked as ready" : "Post marked as published");
      fetchDraft();
    } catch (error) {
      console.error("Error updating Post:", error);
      toast.error("Could not update the Post. Try again.");
    } finally {
      setUpdating(false);
    }
  };

  const publishedPosts = posts.filter((post) => post.status === "published");

  const handleSavePerformance = async () => {
    setMetricsFieldError(null);
    const hasMetrics = metricImpressions.trim() !== "" || metricClicks.trim() !== "";
    let metricsTargetId = "";
    if (hasMetrics) {
      for (const [label, raw] of [
        ["Impressions", metricImpressions],
        ["Clicks", metricClicks],
      ] as const) {
        if (raw.trim() === "") continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          setMetricsFieldError(`${label} must be a non-negative number.`);
          toast.error(`${label} must be a non-negative number.`);
          return;
        }
      }
      metricsTargetId =
        publishedPosts.length === 0
          ? id
          : publishedPosts.length === 1
            ? publishedPosts[0].id
            : metricsPostId;
      if (!metricsTargetId) {
        setMetricsFieldError("Choose which published post these numbers belong to.");
        toast.error("Choose which published post these numbers belong to.");
        return;
      }
    }

    setUpdating(true);
    try {
      try {
        await apiMutate("PATCH", `/content/drafts/${id}`, {
          performanceLevel: performanceLevel || undefined,
          performanceInsights: performanceInsights || undefined,
        });
      } catch {
        toast.error("Could not save the annotation. Try again.");
        return;
      }

      if (hasMetrics) {
        const metricsRes = await fetch(`/api/content/posts/${metricsTargetId}/metrics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            impressions: metricImpressions.trim() === "" ? undefined : Number(metricImpressions),
            clicks: metricClicks.trim() === "" ? undefined : Number(metricClicks),
          }),
        });
        if (!metricsRes.ok) {
          toast.error("Saved the annotation, but could not record the metrics. Try again.");
          fetchDraft();
          return;
        }
        setMetricImpressions("");
        setMetricClicks("");
      }

      toast.success("Performance annotation saved");
      fetchDraft();
      setShowPerformanceForm(false);
    } catch (error) {
      console.error("Error saving performance:", error);
      toast.error("Could not save the annotation. Try again.");
    } finally {
      setUpdating(false);
    }
  };

  const handleCopyContent = async () => {
    if (draft?.content) {
      await navigator.clipboard.writeText(draft.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportContent = (format: ContentExportFormat) => {
    if (!draft) return;
    const exported = buildContentExport(draft, format);
    const url = URL.createObjectURL(
      new Blob([exported.body], { type: exported.mimeType }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = exported.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success(`Exported ${exported.filename}`);
  };

  const handleReminder = async (clear = false) => {
    if (!clear && !reminderWhen) return;
    if (!clear) {
      const reminderAt = new Date(reminderWhen).getTime();
      if (!Number.isFinite(reminderAt) || reminderAt <= Date.now()) {
        toast.error("Choose a valid reminder time in the future.");
        return;
      }
    }
    setReminderUpdating(true);
    try {
      await apiMutate("PATCH", `/content/drafts/${id}`, {
        scheduledFor: clear
          ? null
          : new Date(reminderWhen).toISOString(),
      });
      toast.success(clear ? "Posting reminder cleared" : "Posting reminder saved");
      if (clear) setReminderWhen("");
      await fetchDraft();
    } catch (error) {
      console.error("Error updating posting reminder:", error);
      toast.error("Could not update the posting reminder. Try again.");
    } finally {
      setReminderUpdating(false);
    }
  };

  const backLink = (
    <Link
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      href={draft?.ideaId
        ? `/content/${draft.ideaId}`
        : contentBaseIdFromRoute
          ? `/content/${contentBaseIdFromRoute}`
          : "/content"}
    >
      <ArrowLeft className="size-4" />
      {draft?.ideaId || contentBaseIdFromRoute ? "Content Base" : "All content"}
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
            <Skeleton className="h-5 w-24" />
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="w-full min-w-0">
        {backLink}
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileQuestion className="mb-4 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This Post does not exist or was removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const config = typeConfig[draft.type];
  const Icon = config.icon;

  return (
    <div className="w-full min-w-0">
      {backLink}
      <PageHeader
        title={draft.title}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/resonance?post=${draft.id}`}>
                <AudioWaveform className="h-4 w-4" />
                Compare in Resonance
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyContent}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportContent("markdown")}>
                  Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportContent("plain_text")}>
                  Plain text (.txt)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {draft.status === "draft" && (
              <Button onClick={() => handleUpdateStatus("ready")} disabled={updating}>
                {updating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Mark as ready
              </Button>
            )}
            {draft.status === "published" && (
              <Button
                variant="outline"
                onClick={() => setShowPerformanceForm(!showPerformanceForm)}
              >
                <Edit className="h-4 w-4" />
                Annotate performance
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-8">
        {/* Status */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusConfig[draft.status].variant}>
            {statusConfig[draft.status].label}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {config.label}
          </Badge>
          {draft.performanceLevel && (
            <Badge variant={performanceConfig[draft.performanceLevel].variant}>
              {performanceConfig[draft.performanceLevel].label}
            </Badge>
          )}
        </div>

        <PostContentPreview post={draft} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Creative assets
            </CardTitle>
            <CardDescription>
              Generate images, video, and audio from this Post. Selected assets are attached automatically when the destination supports them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {mediaLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton className="h-36 w-full" key={index} />
                ))}
              </div>
            ) : mediaTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Creative models are not available for this workspace yet.
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="grid gap-2 lg:col-span-2">
                    <Label htmlFor="creative-template">Content template</Label>
                    <Select value={mediaTemplateKey} onValueChange={setMediaTemplateKey}>
                      <SelectTrigger id="creative-template">
                        <SelectValue placeholder="Choose a template" />
                      </SelectTrigger>
                      <SelectContent>
                        {mediaTemplates.map((template) => (
                          <SelectItem key={template.key} value={template.key}>
                            {template.name} — {template.kind}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedMediaTemplate ? (
                      <p className="text-xs text-muted-foreground">{selectedMediaTemplate.description}</p>
                    ) : null}
                  </div>
                  <div className="grid gap-2 lg:col-span-2">
                    <Label htmlFor="creative-model">Model</Label>
                    <Select value={mediaModelKey} onValueChange={setMediaModelKey}>
                      <SelectTrigger id="creative-model">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto — recommended</SelectItem>
                        {selectedMediaTemplate?.models.map((model) => (
                          <SelectItem key={model.key} value={model.key}>
                            {model.name}{model.recommended ? " — recommended" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedMediaTemplate?.allowedAspectRatios.length ? (
                    <div className="grid gap-2">
                      <Label htmlFor="creative-aspect">Aspect ratio</Label>
                      <Select value={mediaAspectRatio} onValueChange={setMediaAspectRatio}>
                        <SelectTrigger id="creative-aspect"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {selectedMediaTemplate.allowedAspectRatios.map((ratio) => (
                            <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {selectedMediaTemplate?.kind === "image" ? (
                    <div className="grid gap-2">
                      <Label htmlFor="creative-variations">Variations</Label>
                      <Select value={mediaVariations} onValueChange={setMediaVariations}>
                        <SelectTrigger id="creative-variations"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((count) => (
                            <SelectItem key={count} value={String(count)}>{count}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {selectedMediaTemplate?.kind === "video" ? (
                    <div className="grid gap-2">
                      <Label htmlFor="creative-duration">Duration</Label>
                      <Select value={mediaDuration} onValueChange={setMediaDuration}>
                        <SelectTrigger id="creative-duration"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[5, 10, 15].map((seconds) => (
                            <SelectItem key={seconds} value={String(seconds)}>{seconds} seconds</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="creative-prompt">Creative direction (optional)</Label>
                  <Textarea
                    id="creative-prompt"
                    maxLength={4000}
                    onChange={(event) => setMediaPrompt(event.target.value)}
                    placeholder="Leave empty to build a prompt from the Post, or describe the visual, motion, or voice you want."
                    rows={3}
                    value={mediaPrompt}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Generation runs remotely on FAL and the final files are copied into your workspace storage.
                  </p>
                  <Button disabled={mediaGenerating || !selectedMediaTemplate} onClick={() => void handleGenerateCreativeMedia()}>
                    {mediaGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate {selectedMediaTemplate?.kind ?? "asset"}
                  </Button>
                </div>
              </div>
            )}

            {mediaRuns.some((run) => run.status !== "succeeded") ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Generation activity</p>
                {mediaRuns.filter((run) => run.status !== "succeeded").slice(0, 5).map((run) => {
                  const template = mediaTemplates.find((entry) => entry.key === run.templateKey);
                  const active = run.status === "queued" || run.status === "submitted" || run.status === "processing";
                  return (
                    <div className="rounded-lg border p-3" key={run.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {run.mediaKind === "image" ? <ImageIcon className="h-4 w-4" /> : run.mediaKind === "video" ? <Video className="h-4 w-4" /> : <Music2 className="h-4 w-4" />}
                            <span className="text-sm font-medium">{template?.name ?? run.templateKey}</span>
                            <Badge variant={run.status === "failed" ? "destructive" : run.status === "cancelled" ? "outline" : "secondary"}>
                              {run.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {run.error || `${run.progress}% complete · up to ${run.estimatedCredits} credits`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {(run.status === "failed" || run.status === "cancelled") ? (
                            <Button
                              disabled={mediaGenerating}
                              onClick={() => void startCreativeMedia({ templateKey: run.templateKey, modelKey: run.modelKey })}
                              size="sm"
                              variant="outline"
                            >
                              <RotateCcw className="h-4 w-4" />
                              Retry
                            </Button>
                          ) : null}
                          {active ? (
                            <Button
                              disabled={mediaCancellingId === run.id}
                              onClick={() => void handleCancelCreativeRun(run.id)}
                              size="sm"
                              variant="ghost"
                            >
                              {mediaCancellingId === run.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {active ? (
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(5, run.progress)}%` }} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {mediaAssets.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Asset library</p>
                  <p className="text-xs text-muted-foreground">Selection is tracked per role, so a hero, thumbnail, and primary asset can coexist.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {mediaAssets.map((asset) => (
                    <div className={`overflow-hidden rounded-lg border ${asset.isSelected ? "ring-2 ring-primary" : ""}`} key={asset.id}>
                      <div className="flex aspect-video items-center justify-center bg-muted/30">
                        {asset.mediaKind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={asset.fileName} className="h-full w-full object-cover" loading="lazy" src={asset.url} />
                        ) : asset.mediaKind === "video" ? (
                          <video className="h-full w-full object-cover" controls preload="metadata" src={asset.url} />
                        ) : (
                          <div className="w-full space-y-3 p-5 text-center">
                            <Music2 className="mx-auto h-8 w-8 text-muted-foreground" />
                            <audio className="w-full" controls preload="metadata" src={asset.url} />
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{asset.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {asset.assetRole} · {(asset.byteSize / 1024 / 1024).toFixed(1)} MB
                            </p>
                          </div>
                          {asset.isSelected ? <Badge>Selected</Badge> : null}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            disabled={asset.isSelected || mediaSelectingId === asset.id}
                            onClick={() => void handleSelectCreativeAsset(asset)}
                            size="sm"
                            variant={asset.isSelected ? "secondary" : "outline"}
                          >
                            {mediaSelectingId === asset.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {asset.isSelected ? "Selected" : "Use this asset"}
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <a download={asset.fileName} href={asset.url}><Download className="h-4 w-4" /><span className="sr-only">Download</span></a>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : !mediaLoading ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <ImageIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No creative assets yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Choose a template above to generate the first one.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Publish actions for ready drafts */}
        {draft.status === "ready" && (
          <Card>
            <CardHeader>
              <CardTitle>Publish</CardTitle>
              <CardDescription>
                Publish this Post to a connected channel, or mark it published manually
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start gap-3">
                  <BellRing className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="posting-reminder">Remind me to post</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      A dashboard notification appears one hour before this time.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="posting-reminder"
                        onChange={(event) => setReminderWhen(event.target.value)}
                        type="datetime-local"
                        value={reminderWhen}
                      />
                      <Button
                        disabled={reminderUpdating || !reminderWhen}
                        onClick={() => void handleReminder()}
                        type="button"
                        variant="outline"
                      >
                        {reminderUpdating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <BellRing className="size-4" />
                        )}
                        Save reminder
                      </Button>
                      {draft.scheduledFor ? (
                        <Button
                          disabled={reminderUpdating}
                          onClick={() => void handleReminder(true)}
                          type="button"
                          variant="ghost"
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Send className="h-4 w-4" />
                    Publish
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Publish Post</DialogTitle>
                    <DialogDescription>
                      Send this Post to a connected channel now, or schedule it for later.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="publish-channel">Channel</Label>
                      {channelsLoading ? (
                        <Skeleton className="h-9 w-full" />
                      ) : channels.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No channels connected yet.{" "}
                          <Link className="underline hover:text-foreground" href="/content/channels">
                            Connect a channel
                          </Link>{" "}
                          first.
                        </p>
                      ) : (
                        <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                          <SelectTrigger id="publish-channel">
                            <SelectValue placeholder="Select a channel" />
                          </SelectTrigger>
                          <SelectContent>
                            {channels.map((channel) => (
                              <SelectItem key={channel.id} value={channel.id}>
                                {channel.name} — {destinationLabel(channel.destination)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="publish-when">Schedule (optional)</Label>
                      <Input
                        id="publish-when"
                        type="datetime-local"
                        value={scheduleWhen}
                        onChange={(e) => setScheduleWhen(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave empty to publish now.
                      </p>
                    </div>
                    {mediaAssets.some((asset) => asset.isSelected) ? (
                      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                        The selected compatible creative asset will be attached automatically. Destinations that do not accept that media type will publish the copy only.
                      </div>
                    ) : null}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setPublishDialogOpen(false)}
                      disabled={publishing}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handlePublish}
                      disabled={publishing || !selectedChannelId}
                    >
                      {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
                      {scheduleWhen ? "Schedule post" : "Publish now"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <div className="grid gap-2">
                <Label htmlFor="publishedUrl">Published URL (optional)</Label>
                <Input
                  id="publishedUrl"
                  placeholder="https://..."
                  value={publishedUrl}
                  onChange={(e) => setPublishedUrl(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                onClick={() => handleUpdateStatus("published")}
                disabled={updating}
              >
                {updating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Mark as published
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Publishing deliveries for this Post */}
        {(draft.status === "ready" || posts.length > 0) && (
          <ListCard title="Publishing" description="Deliveries created from this Post and their status.">
            {postsLoading ? (
              <div className="divide-y">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div className="px-6 py-3.5" key={i}>
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <Send className="mb-4 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Posts published to connected channels appear here.
                </p>
              </div>
            ) : (
              <ListRows>
                {posts.map((post) => (
                  <ListRow
                    actions={[
                      ...(post.resultUrl ? [{
                        external: true,
                        href: post.resultUrl,
                        icon: ExternalLink,
                        label: "View published post",
                      }] : []),
                      ...(post.status === "failed" ? [{
                        disabled: retryingPostId === post.id,
                        icon: retryingPostId === post.id ? Loader2 : RotateCcw,
                        label: "Retry post",
                        onSelect: () => void handleRetryPost(post.id),
                      }] : []),
                    ]}
                    badge={
                      <Badge variant={postStatusConfig[post.status].variant}>
                        {postStatusConfig[post.status].label}
                      </Badge>
                    }
                    key={post.id}
                    meta={[
                      `${post.attempts} ${post.attempts === 1 ? "attempt" : "attempts"}`,
                      <span key="publish-at" title={new Date(post.publishAt).toLocaleString()}>
                        {new Date(post.publishAt).toLocaleString()}
                      </span>,
                      ...(post.error ? [<span className="text-destructive" key="error">{post.error}</span>] : []),
                    ]}
                    title={destinationLabel(post.destination)}
                  />
                ))}
              </ListRows>
            )}
          </ListCard>
        )}

        {/* Performance Annotation for published drafts */}
        {draft.status === "published" && showPerformanceForm && (
          <Card>
            <CardHeader>
              <CardTitle>Performance annotation</CardTitle>
              <CardDescription>Rate how this content performed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Performance level</Label>
                <Select value={performanceLevel} onValueChange={(v) => setPerformanceLevel(v as PerformanceLevel)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select performance level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="insights">Performance insights</Label>
                <Textarea
                  id="insights"
                  placeholder="What made this content perform well or poorly?"
                  value={performanceInsights}
                  onChange={(e) => setPerformanceInsights(e.target.value)}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="metric-impressions">Impressions</Label>
                  <Input
                    id="metric-impressions"
                    inputMode="numeric"
                    min="0"
                    type="number"
                    placeholder="e.g. 2100"
                    value={metricImpressions}
                    onChange={(e) => setMetricImpressions(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Total impressions the platform reports. Optional.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="metric-clicks">Clicks</Label>
                  <Input
                    id="metric-clicks"
                    inputMode="numeric"
                    min="0"
                    type="number"
                    placeholder="e.g. 34"
                    value={metricClicks}
                    onChange={(e) => setMetricClicks(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Link or detail clicks the platform reports. Optional.
                  </p>
                </div>
              </div>
              {publishedPosts.length > 1 && (
                <div className="grid gap-2">
                  <Label>Measured post</Label>
                  <Select value={metricsPostId} onValueChange={setMetricsPostId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose the published post" />
                    </SelectTrigger>
                    <SelectContent>
                      {publishedPosts.map((post) => (
                        <SelectItem key={post.id} value={post.id}>
                          {destinationLabel(post.destination)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Numbers attach to one published post at a time — the post is the unit of measurement.
                  </p>
                </div>
              )}
              {metricsFieldError && (
                <p className="text-xs text-destructive">{metricsFieldError}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowPerformanceForm(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSavePerformance} disabled={updating}>
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save annotation
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Published URL display */}
        {draft.status === "published" && draft.publishedUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Published URL</CardTitle>
            </CardHeader>
            <CardContent>
              <a
                href={draft.publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                {draft.publishedUrl}
              </a>
            </CardContent>
          </Card>
        )}

        {/* Performance Insights display */}
        {draft.status === "published" && draft.performanceInsights && !showPerformanceForm && (
          <Card>
            <CardHeader>
              <CardTitle>Performance insights</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm italic text-muted-foreground">
                &ldquo;{draft.performanceInsights}&rdquo;
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Resonance</CardTitle>
            <CardDescription>
              Compare this Post against another saved Post before deciding which one to use.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/resonance?post=${draft.id}`}>
                <AudioWaveform className="h-4 w-4" />
                Choose comparison Post
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Content Base Link */}
        {draft.ideaId && (
          <Card>
            <CardHeader>
              <CardTitle>Content Base</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  This Post was generated from its Content Base.
                </span>
                <Button variant="link" asChild className="h-auto p-0">
                  <Link href={`/content/${draft.ideaId}`}>
                    View Content Base
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </Button>
              </div>
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
              <span title={new Date(draft.createdAt).toLocaleString()}>
                Created {formatDistanceToNow(new Date(draft.createdAt), { addSuffix: true })}
              </span>
              <span title={new Date(draft.updatedAt).toLocaleString()}>
                Updated {formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true })}
              </span>
              {draft.publishedAt && (
                <span title={new Date(draft.publishedAt).toLocaleString()}>
                  Published {formatDistanceToNow(new Date(draft.publishedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
