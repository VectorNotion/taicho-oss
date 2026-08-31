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
} from "lucide-react";

import { ApiError, apiGet, apiMutate } from "@content-automation/platform/network/api-client";
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
import { ContentResonanceExperience } from "@/products/content-generator/ui/components/resonance/ContentResonanceExperience";
import { VisualBriefDialog } from "@/products/content-generator/ui/components/VisualBriefDialog";
import { MediaGenerationCard } from "@/products/content-generator/ui/components/MediaGenerationCard";
import { MediaPreview } from "@/products/content-generator/ui/components/MediaPreview";
import { CopyablePrompt } from "@/products/content-generator/ui/components/CopyablePrompt";
import type { CreativeAssetView, CreativeRunView, PostMediaUsageView, VisualBrief } from "@/products/content-generator/ui/components/media-types";

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

interface PerformanceMetricSummary {
  metrics: Record<string, number>;
  lastMeasuredAt: string | null;
  sources: Array<{ key: string; label: string }>;
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

function localDateTimeInputValue(date: Date): string {
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
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
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
  const [metricSummary, setMetricSummary] = useState<PerformanceMetricSummary | null>(null);
  const [metricSummaryError, setMetricSummaryError] = useState<string | null>(null);
  const [metricSummaryLoading, setMetricSummaryLoading] = useState(false);

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

  // Content Base-owned media referenced by this Post.
  const [mediaRuns, setMediaRuns] = useState<CreativeRunView[]>([]);
  const [baseMediaRuns, setBaseMediaRuns] = useState<CreativeRunView[]>([]);
  const [linkedMedia, setLinkedMedia] = useState<PostMediaUsageView[]>([]);
  const [availableMedia, setAvailableMedia] = useState<CreativeAssetView[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaGenerating, setMediaGenerating] = useState(false);
  const [mediaCancellingId, setMediaCancellingId] = useState<string | null>(null);
  const [mediaActionId, setMediaActionId] = useState<string | null>(null);
  const [visualBriefOpen, setVisualBriefOpen] = useState(false);
  const [pendingMediaBrief, setPendingMediaBrief] = useState<VisualBrief | null>(null);

  const fetchMetricSummary = async (silent = false, cancelled: () => boolean = () => false) => {
    setMetricSummaryLoading(true);
    try {
      const summary = await apiGet<PerformanceMetricSummary>(`/content/posts/${id}/metrics`);
      if (cancelled()) return;
      setMetricSummary(summary);
      setMetricSummaryError(null);
    } catch (error) {
      if (cancelled()) return;
      const message = error instanceof Error ? error.message : "Could not load performance metrics.";
      setMetricSummaryError(message);
      if (!silent) toast.error(message);
    } finally {
      if (!cancelled()) setMetricSummaryLoading(false);
    }
  };

  const fetchDraft = async (cancelled: () => boolean = () => false) => {
    try {
      const { draft: data } = await apiGet<{ draft: ContentDraft }>(`/content/drafts/${id}`);
      if (cancelled()) return;
      setDraft(data);
      setEditTitle(data.title);
      setEditContent(data.content);
      setPublishedUrl(data.publishedUrl || "");
      setPerformanceLevel(data.performanceLevel || "");
      setPerformanceInsights(data.performanceInsights || "");
      setReminderWhen(reminderInputValue(data.scheduledFor));
      if (data.status === "published") void fetchMetricSummary(true, cancelled);
    } catch (error) {
      if (cancelled()) return;
      console.error("Error fetching Post:", error);
      toast.error("Could not load the Post. Refresh to try again.");
    } finally {
      if (!cancelled()) setLoading(false);
    }
  };

  const fetchPosts = async (silent = false, cancelled: () => boolean = () => false) => {
    try {
      const data = await apiGet<{ posts?: PublishingPost[] }>(`/publishing/drafts/${id}/posts`);
      if (cancelled()) return;
      setPosts(data.posts ?? []);
    } catch (error) {
      if (cancelled()) return;
      console.error("Error fetching posts:", error);
      if (!silent) toast.error("Could not load publishing posts. Refresh to try again.");
    } finally {
      if (!cancelled()) setPostsLoading(false);
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

  const fetchCreativeMedia = async (silent = false, cancelled: () => boolean = () => false) => {
    try {
      const data = await apiGet<{ contentBaseId: string; linked: PostMediaUsageView[]; available: CreativeAssetView[] }>(`/content/drafts/${id}/media-links`);
      if (cancelled()) return;
      setLinkedMedia(data.linked ?? []);
      setAvailableMedia(data.available ?? []);
      const overview = await apiGet<{ runs: CreativeRunView[] }>(`/content/ideas/${data.contentBaseId}/media`);
      if (!cancelled()) {
        setBaseMediaRuns(overview.runs ?? []);
        setMediaRuns((overview.runs ?? []).filter((run) => run.originPostId === id));
      }
    } catch (error) {
      if (cancelled()) return;
      console.error("Error fetching creative media:", error);
      if (!silent) toast.error("Could not load creative assets. Refresh to try again.");
    } finally {
      if (!cancelled()) setMediaLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const cancelled = () => !active;
    void fetchDraft(cancelled);
    void fetchPosts(false, cancelled);
    void fetchCreativeMedia(false, cancelled);
    return () => { active = false; };
  }, [id]);

  const hasUnsavedChanges = Boolean(
    editing
    && draft
    && (editTitle !== draft.title || editContent !== draft.content),
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedUnload);
    return () => window.removeEventListener("beforeunload", preventUnsavedUnload);
  }, [hasUnsavedChanges]);

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

  const visibleMediaRuns = mediaRuns.filter((run) =>
    run.status === "preparing" || run.status === "queued" || run.status === "submitted" || run.status === "processing"
      || run.status === "failed" || run.status === "cancelled",
  );
  const activeMediaRuns = visibleMediaRuns.filter((run) =>
    run.status === "preparing" || run.status === "queued" || run.status === "submitted" || run.status === "processing",
  );
  const hasActiveMediaRuns = activeMediaRuns.length > 0;

  useEffect(() => {
    if (!hasActiveMediaRuns) return;
    const interval = setInterval(() => fetchCreativeMedia(true), 5_000);
    return () => clearInterval(interval);
  }, [hasActiveMediaRuns, id]);

  const startCreativeMedia = async (brief: VisualBrief) => {
    setVisualBriefOpen(false);
    setPendingMediaBrief(brief);
    setMediaGenerating(true);
    try {
      const { data } = await apiMutate<{ run: CreativeRunView }>("POST", `/content/drafts/${id}/media`, { brief });
      setMediaRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
      setPendingMediaBrief(null);
      toast.success("Visual generation started");
      await fetchCreativeMedia(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start creative generation.");
      await fetchCreativeMedia(true);
    } finally {
      setPendingMediaBrief(null);
      setMediaGenerating(false);
    }
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

  const handleAttachCreativeAsset = async (assetId: string) => {
    setMediaActionId(assetId);
    try {
      await apiMutate("POST", `/content/drafts/${id}/media-links`, { assetId });
      toast.success("Media attached to the Post");
      await fetchCreativeMedia(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not attach this media.");
    } finally {
      setMediaActionId(null);
    }
  };

  const handleDetachCreativeAsset = async (assetId: string) => {
    setMediaActionId(assetId);
    try {
      await apiMutate("DELETE", `/content/drafts/${id}/media-links/${assetId}`, {});
      toast.success("Media detached; the Content Base asset was preserved");
      await fetchCreativeMedia(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not detach this media."); }
    finally { setMediaActionId(null); }
  };

  const handlePublish = async () => {
    const channel = channels.find((entry) => entry.id === selectedChannelId);
    if (!channel) return;
    if (scheduleWhen && new Date(scheduleWhen).getTime() <= Date.now()) {
      toast.error("Schedule time must be in the future.");
      return;
    }
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
      toast.error(error instanceof Error ? error.message : "Could not schedule the post. Try again.");
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
    if (status === "published" && publishedUrl) {
      try {
        const parsed = new URL(publishedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
      } catch {
        toast.error("Enter a valid HTTP or HTTPS URL, or leave the published URL empty.");
        return;
      }
    }
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
      toast.error(error instanceof Error ? error.message : "Could not update the Post. Try again.");
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    const title = editTitle.trim();
    if (!title || !editContent.trim()) {
      toast.error("Title and content are required.");
      return;
    }
    setUpdating(true);
    try {
      const result = await apiMutate<{ draft: ContentDraft }>("PATCH", `/content/drafts/${id}`, {
        title,
        content: editContent,
        expectedUpdatedAt: draft.updatedAt,
      });
      setDraft(result.data.draft);
      setEditTitle(result.data.draft.title);
      setEditContent(result.data.draft.content);
      setEditing(false);
      toast.success("Post saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const { draft: latest } = await apiGet<{ draft: ContentDraft }>(`/content/drafts/${id}`);
          setDraft(latest);
          toast.error(`${error.message} Your edits are preserved; review and save again.`);
        } catch {
          toast.error(`${error.message} Your edits are preserved; refresh when you are ready to reconcile them.`);
        }
      } else {
        toast.error(error instanceof Error ? error.message : "Could not save the Post. Try again.");
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleCancelEditing = () => {
    if (hasUnsavedChanges && !window.confirm("Discard your unsaved Post changes?")) return;
    if (draft) {
      setEditTitle(draft.title);
      setEditContent(draft.content);
    }
    setEditing(false);
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
        try {
          await apiMutate("POST", `/content/posts/${metricsTargetId}/metrics`, {
            impressions: metricImpressions.trim() === "" ? undefined : Number(metricImpressions),
            clicks: metricClicks.trim() === "" ? undefined : Number(metricClicks),
          });
        } catch (error) {
          toast.error(error instanceof Error
            ? `Saved the annotation, but metrics were not recorded. ${error.message}`
            : "Saved the annotation, but metrics were not recorded. Try again.");
          fetchDraft();
          return;
        }
        setMetricImpressions("");
        setMetricClicks("");
        await fetchMetricSummary(true);
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
    if (!draft?.content) return;
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard access was denied. Select the Post content and copy it manually.");
    }
  };

  const handleExportContent = (format: ContentExportFormat) => {
    if (!draft) return;
    try {
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
    } catch {
      toast.error("Could not export the Post. Try again.");
    }
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
      onClick={(event) => {
        if (hasUnsavedChanges && !window.confirm("Leave without saving your Post changes?")) {
          event.preventDefault();
        }
      }}
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
        stackActionsUntil="xl"
        title={draft.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {draft.status === "draft" && !editing && (
              <Button onClick={() => setEditing(true)} size="sm" variant="outline">
                <Edit className="h-4 w-4" />
                Edit Post
              </Button>
            )}
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

        {editing && (
          <Card>
            <CardHeader>
              <CardTitle>Edit Post</CardTitle>
              <CardDescription>
                Save the title and body before moving this Post into editorial review.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="post-title">Title</Label>
                <Input
                  id="post-title"
                  maxLength={500}
                  onChange={(event) => setEditTitle(event.target.value)}
                  value={editTitle}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="post-content">Content</Label>
                <Textarea
                  className="min-h-64 font-mono text-sm"
                  id="post-content"
                  onChange={(event) => setEditContent(event.target.value)}
                  value={editContent}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={updating} onClick={handleCancelEditing} variant="outline">
                  Cancel
                </Button>
                <Button
                  disabled={updating || !hasUnsavedChanges || !editTitle.trim() || !editContent.trim()}
                  onClick={() => void handleSaveDraft()}
                >
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save Post
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <PostContentPreview media={linkedMedia.map(({ asset }) => asset)} post={draft} />

        <VisualBriefDialog
          initialKind="image"
          onOpenChange={setVisualBriefOpen}
          onSubmit={startCreativeMedia}
          open={visualBriefOpen}
          submitLabel="Create visual"
          submitting={mediaGenerating}
          title="Create a visual from this Post"
        />

        <Card id="creative-assets">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Media used
              </CardTitle>
              <CardDescription className="mt-1">
                This Post references media owned by its Content Base. Detaching an item never deletes the Base asset.
              </CardDescription>
            </div>
            <Button disabled={mediaGenerating} onClick={() => setVisualBriefOpen(true)} size="sm">
              <ImageIcon className="size-4" />
              Create visual
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {mediaLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 2 }).map((_, index) => <Skeleton className="aspect-video" key={index} />)}</div>
            ) : null}

            {!mediaLoading && (pendingMediaBrief || visibleMediaRuns.length || linkedMedia.length) ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pendingMediaBrief ? (
                  <MediaGenerationCard aspect="video" brief={pendingMediaBrief} />
                ) : null}
                {visibleMediaRuns.map((run) => (
                  <MediaGenerationCard
                    aspect="video"
                    brief={run.visualBrief}
                    cancelling={mediaCancellingId === run.id}
                    key={run.id}
                    onCancel={activeMediaRuns.some((active) => active.id === run.id)
                      ? () => void handleCancelCreativeRun(run.id)
                      : undefined}
                    onRetry={["failed", "cancelled"].includes(run.status)
                      ? () => void startCreativeMedia(run.visualBrief)
                      : undefined}
                    run={run}
                  />
                ))}
                {linkedMedia.map((link) => {
                  const { asset } = link;
                  const run = baseMediaRuns.find((entry) => entry.id === asset.generationRunId);
                  const groundedGeneration = link.role.startsWith("grounding-");
                  return (
                    <article className="overflow-hidden rounded-xl border" key={asset.id}>
                      <div className="aspect-video bg-muted/20"><MediaPreview asset={asset} /></div>
                      <div className="space-y-3 p-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium capitalize">{asset.visualType.replaceAll("-", " ")}</p>
                            {groundedGeneration ? <Badge variant="secondary">Grounded this Post</Badge> : <Badge variant="outline">Attached after generation</Badge>}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{asset.description}</p>
                        </div>
                        {groundedGeneration && run ? (
                          <details className="rounded-lg bg-muted/25 p-3 text-xs">
                            <summary className="cursor-pointer font-medium">Image grounding used</summary>
                            <div className="mt-2 space-y-2 text-muted-foreground">
                              <p><span className="font-medium text-foreground">Visual Brief:</span> {JSON.stringify(run.visualBrief)}</p>
                              <CopyablePrompt label="Image prompt in Post generation" prompt={run.provenance.compiledPrompt} />
                            </div>
                          </details>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Button className="flex-1" disabled={mediaActionId === asset.id} onClick={() => void handleDetachCreativeAsset(asset.id)} size="sm" variant="outline">Detach</Button>
                          <Button asChild size="sm" variant="ghost"><a download={asset.fileName} href={asset.url}><Download className="size-4" /><span className="sr-only">Download</span></a></Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {!mediaLoading && !pendingMediaBrief && !visibleMediaRuns.length && !linkedMedia.length ? (
              <div className="rounded-lg border border-dashed p-7 text-center"><ImageIcon className="mx-auto size-8 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No media attached</p><p className="mt-1 text-xs text-muted-foreground">Attach existing Base media or create a new visual from this Post.</p></div>
            ) : null}

            {availableMedia.some((asset) => !linkedMedia.some((link) => link.assetId === asset.id)) ? (
              <div className="space-y-3 border-t pt-5">
                <div><p className="text-sm font-medium">Available from Content Base</p><p className="text-xs text-muted-foreground">Reuse a Base asset without copying or moving it.</p></div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {availableMedia.filter((asset) => !linkedMedia.some((link) => link.assetId === asset.id)).map((asset) => (
                    <button className="overflow-hidden rounded-lg border text-left transition-colors hover:border-primary" disabled={mediaActionId === asset.id} key={asset.id} onClick={() => void handleAttachCreativeAsset(asset.id)} type="button">
                      <div className="aspect-video bg-muted/20"><MediaPreview asset={asset} /></div>
                      <div className="p-2"><p className="truncate text-xs font-medium capitalize">{asset.visualType.replaceAll("-", " ")}</p><p className="text-[11px] text-muted-foreground">Attach to Post</p></div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button asChild size="sm" variant="ghost">
                <Link href={`/content/${contentBaseIdFromRoute ?? draft.ideaId}`}>Open Content Base media gallery <ExternalLink className="size-4" /></Link>
              </Button>
            </div>
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
                        aria-invalid={scheduleWhen !== "" && new Date(scheduleWhen).getTime() <= Date.now()}
                        id="publish-when"
                        min={localDateTimeInputValue(new Date())}
                        type="datetime-local"
                        value={scheduleWhen}
                        onChange={(e) => setScheduleWhen(e.target.value)}
                      />
                      {scheduleWhen !== "" && new Date(scheduleWhen).getTime() <= Date.now() ? (
                        <p className="text-xs text-destructive" role="alert">Schedule time must be in the future.</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Leave empty to publish now.</p>
                      )}
                    </div>
                    {linkedMedia.length ? (
                      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                        The first compatible attached Base asset will be included automatically. Destinations that do not accept that media type will publish the copy only.
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
                      disabled={publishing || !selectedChannelId || (scheduleWhen !== "" && new Date(scheduleWhen).getTime() <= Date.now())}
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
                  type="url"
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
                <p className="text-xs text-destructive" role="alert">{metricsFieldError}</p>
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

        {draft.status === "published" && (
          <Card>
            <CardHeader>
              <CardTitle>Performance metrics</CardTitle>
              <CardDescription>Latest resolved counts for this Post across recorded sources.</CardDescription>
            </CardHeader>
            <CardContent>
              {metricSummaryLoading ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {Array.from({ length: 3 }, (_, index) => <Skeleton className="h-20" key={index} />)}
                </div>
              ) : metricSummaryError ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
                  <div>
                    <p className="text-sm font-medium">Performance metrics could not be loaded</p>
                    <p className="mt-1 text-xs text-muted-foreground">{metricSummaryError}</p>
                  </div>
                  <Button onClick={() => void fetchMetricSummary()} size="sm" variant="outline">Try again</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["Impressions", metricSummary?.metrics.impressions],
                      ["Clicks", metricSummary?.metrics.clicks],
                      ["Engagements", metricSummary?.metrics.engagements],
                    ].map(([label, value]) => (
                      <div className="rounded-lg border bg-muted/20 p-4" key={String(label)}>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">
                          {typeof value === "number" ? value.toLocaleString() : "Not recorded"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {metricSummary?.lastMeasuredAt
                      ? `Last measured ${new Date(metricSummary.lastMeasuredAt).toLocaleString()} · ${metricSummary.sources.map(({ label }) => label).join(", ") || "Source unavailable"}`
                      : "No performance metrics recorded yet. Add a human annotation or connect a measurement source."}
                  </p>
                </div>
              )}
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

        <ContentResonanceExperience
          draft={draft}
          onDraftUpdated={() => fetchDraft()}
          showSourceContent={false}
        />

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
