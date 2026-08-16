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
  AudioWaveform,
  RefreshCw,
  PenLine,
  ArrowLeft,
  ArrowRight,
  FileQuestion,
  Loader2,
} from "lucide-react";

import { apiGet } from "@content-automation/platform/network/api-client";
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

export default function ContentBaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [idea, setIdea] = useState<ContentIdea | null>(null);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const refineStream = useCapabilityStream<{
    outline?: string[]; key_points?: string[]; keyPoints?: string[];
  }, { refined: true }>({ api: `/content/ideas/${id}/refine` });
  const draftStream = useCapabilityStream<{
    title?: string; introduction?: string; sections?: string[]; conclusion?: string;
    tweets?: string[]; hook?: string; body?: string; main_sections?: string[];
    post?: string; headline?: string; primary_text?: string; description?: string; call_to_action?: string;
  }, { draftId: string }>({ api: `/content/ideas/${id}/draft` });
  const refining = refineStream.isStreaming;
  const generatingDraft = draftStream.isStreaming;

  const fetchIdea = async () => {
    try {
      const data = await apiGet<{ idea: ContentIdea }>(`/content/ideas/${id}`);
      setIdea(data.idea);
    } catch (error) {
      console.error("Error fetching Content Base:", error);
      toast.error("Could not load the Content Base. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchDrafts = async () => {
    try {
      const data = await apiGet<{ items: ContentDraft[] }>(`/content/drafts`, { ideaId: id, limit: 100 });
      setDrafts(data.items);
    } catch (error) {
      console.error("Error fetching drafts:", error);
    }
  };

  useEffect(() => {
    fetchIdea();
    fetchDrafts();
  }, [id]);

  const handleRefine = () => refineStream.start();
  const handleGenerateDraft = (contentType: ContentType) => draftStream.start({ contentType });

  useEffect(() => { if (refineStream.final) void fetchIdea(); }, [refineStream.final]);
  useEffect(() => { if (draftStream.final) void fetchDrafts(); }, [draftStream.final]);
  useEffect(() => { if (refineStream.error) toast.error(refineStream.error); }, [refineStream.error]);
  useEffect(() => { if (draftStream.error) toast.error(draftStream.error); }, [draftStream.error]);

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
              This Content Base doesn't exist or was removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      {backLink}
      <PageHeader
        title={idea.title}
        description={idea.description}
        actions={
          <div className="flex items-center gap-2">
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
              <Select
                onValueChange={(value) => handleGenerateDraft(value as ContentType)}
                disabled={generatingDraft}
              >
                <SelectTrigger aria-label="Content template" className="w-[220px]">
                  {generatingDraft ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PenLine className="h-4 w-4" />
                  )}
                  <SelectValue placeholder="Generate Post as…" />
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
                          <div className="min-w-0">
                            <p>{config.label}</p>
                            <p className="text-xs text-muted-foreground">
                              Resonance: {profile.frames.map((frame) => profile.frameLabels[frame] ?? frame).join(" · ")}
                            </p>
                          </div>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </div>
        }
      />

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

        {/* Posts */}
        {drafts.length > 0 && (
          <ListCard title="Posts" description="Posts created from this Content Base.">
            <ListRows>
              {drafts.map((draft) => {
                const config = typeConfig[draft.type];
                const Icon = config.icon;
                const status = draftStatusConfig[draft.status];
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
                      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </span>
                    }
                    meta={[config.label]}
                    title={draft.title}
                  />
                );
              })}
            </ListRows>
          </ListCard>
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
    </div>
  );
}
