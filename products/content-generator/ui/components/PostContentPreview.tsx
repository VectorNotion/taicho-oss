import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart3,
  Clock3,
  Globe2,
  Heart,
  ImageIcon,
  MessageCircle,
  MessageSquareText,
  MousePointerClick,
  Play,
  Repeat2,
  Send,
  ThumbsUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ContentDraft } from "@/products/content-generator/domain/content";

function SurfaceHeader({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <Badge variant="outline">{label}</Badge>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  );
}

function AvatarDot({
  label = "YP",
  square = false,
}: {
  label?: string;
  square?: boolean;
}) {
  return (
    <span
      className={[
        "grid size-9 shrink-0 place-items-center bg-primary/15 text-xs font-semibold text-primary",
        square ? "rounded-lg" : "rounded-full",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function PlatformActionRail({ compact = false }: { compact?: boolean }) {
  const actions = [
    { icon: MessageCircle, label: "Reply" },
    { icon: Repeat2, label: "Repost" },
    { icon: Heart, label: "Like" },
    { icon: BarChart3, label: "View" },
  ];
  return (
    <div className="mt-3 flex items-center justify-between border-t pt-3 text-muted-foreground">
      {actions.map(({ icon: Icon, label }) => (
        <span className="flex items-center gap-1.5 text-xs" key={label} title={label}>
          <Icon className="size-3.5" />
          {!compact ? label : null}
        </span>
      ))}
    </div>
  );
}

function splitThread(content: string): string[] {
  const normalized = content.trim();
  const blocks = normalized
    .split(/\n{2,}(?=\d+\/(?:\d+|\?)\s)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return blocks.length > 1 ? blocks : [normalized];
}

function XPreview({ post }: { post: ContentDraft }) {
  const thread = post.type === "tweet_thread";
  const entries = thread ? splitThread(post.content) : [post.content.trim()];
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="post-preview-x">
      <SurfaceHeader
        description={thread ? `${entries.length} connected Posts` : `${post.content.length.toLocaleString()} characters`}
        label={thread ? "X thread preview" : "X Post preview"}
      />
      <CardContent className="p-0">
        <div className="mx-auto max-w-2xl px-4 py-2">
          {entries.map((entry, index) => (
            <div className="relative flex items-start gap-3 py-4" key={`${index}-${entry.slice(0, 24)}`}>
              {thread && index < entries.length - 1 ? (
                <span className="absolute bottom-0 left-[1.1rem] top-12 w-px bg-border" aria-hidden />
              ) : null}
              <AvatarDot />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-semibold">Your profile</span>
                  <span className="text-muted-foreground">@your-handle · now</span>
                  {thread ? (
                    <Badge className="ml-auto" variant="outline">
                      {index + 1}/{entries.length}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-6">{entry}</p>
                <PlatformActionRail compact />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LinkedInPreview({ post }: { post: ContentDraft }) {
  const foldLength = 210;
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="post-preview-linkedin">
      <SurfaceHeader
        description={`See-more fold begins around ${foldLength} characters`}
        label="LinkedIn Post preview"
      />
      <CardContent className="mx-auto w-full max-w-2xl p-5">
        <div className="flex items-start gap-3">
          <AvatarDot square />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">Your profile</p>
            <p className="text-xs text-muted-foreground">Your profile headline</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Now · <Globe2 className="size-3" />
            </p>
          </div>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-[15px] leading-6">{post.content}</p>
        {post.content.length > foldLength ? (
          <p className="mt-3 border-t border-dashed pt-2 text-xs text-muted-foreground">
            LinkedIn’s collapsed preview normally ends above this marker.
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-2 border-t py-3 text-xs text-muted-foreground">
          <span className="flex -space-x-1">
            <span className="grid size-5 place-items-center rounded-full bg-primary/20 ring-2 ring-card">
              <ThumbsUp className="size-3 text-primary" />
            </span>
            <span className="grid size-5 place-items-center rounded-full bg-primary/30 ring-2 ring-card">
              <Heart className="size-3 text-primary" />
            </span>
          </span>
          Audience reactions appear after publishing
        </div>
        <div className="grid grid-cols-3 border-t pt-2 text-xs text-muted-foreground">
          <span className="flex items-center justify-center gap-1.5 py-1.5">
            <ThumbsUp className="size-3.5" /> Like
          </span>
          <span className="flex items-center justify-center gap-1.5 py-1.5">
            <MessageCircle className="size-3.5" /> Comment
          </span>
          <span className="flex items-center justify-center gap-1.5 py-1.5">
            <Send className="size-3.5" /> Send
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function readingTime(content: string, wordsPerMinute: number): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

function YouTubePreview({ post }: { post: ContentDraft }) {
  const minutes = readingTime(post.content, 145);
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="post-preview-youtube">
      <SurfaceHeader
        description="Title, thumbnail framing, and complete script"
        label="YouTube video preview"
      />
      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
          <div className="border-b lg:border-b-0 lg:border-r">
            <div className="relative aspect-video bg-gradient-to-br from-primary/25 via-background to-chart-1/15">
              <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-background/85 shadow-sm">
                <Play className="ml-0.5 size-5" />
              </span>
              <span className="absolute bottom-2 right-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px]">
                ~{minutes}:00
              </span>
            </div>
            <div className="p-4">
              <div className="flex gap-3">
                <AvatarDot label="CH" />
                <div className="min-w-0">
                  <p className="font-medium leading-snug">{post.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Your channel · Preview</p>
                </div>
              </div>
            </div>
          </div>
          <div className="min-w-0 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Video script</p>
              <span className="text-xs text-muted-foreground">~{minutes} min</span>
            </div>
            <div className="prose prose-sm dark:prose-invert mt-4 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function withoutDuplicateTitle(title: string, content: string): string {
  const lines = content.trim().split("\n");
  const first = lines[0]?.replace(/^#\s+/, "").trim().toLowerCase();
  return first === title.trim().toLowerCase()
    ? lines.slice(1).join("\n").trim()
    : content;
}

function BlogPreview({ post }: { post: ContentDraft }) {
  const body = withoutDuplicateTitle(post.title, post.content);
  const minutes = readingTime(body, 220);
  const dek = body
    .replace(/[#*_>`-]/g, "")
    .split(/\n{2,}/)
    .find(Boolean)
    ?.slice(0, 220);
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="post-preview-blog">
      <SurfaceHeader
        description="Article hero and complete reading view"
        label="Blog article preview"
      />
      <CardContent className="p-0">
        <div className="h-28 bg-gradient-to-r from-chart-3/25 via-primary/10 to-transparent" />
        <article className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Article</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
          {dek ? (
            <p className="mt-4 text-base leading-7 text-muted-foreground">{dek}</p>
          ) : null}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" /> {minutes} min read · Preview
          </p>
          <div className="prose prose-sm dark:prose-invert mt-8 max-w-none border-t pt-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        </article>
      </CardContent>
    </Card>
  );
}

function SocialPreview({ post }: { post: ContentDraft }) {
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="post-preview-social">
      <SurfaceHeader description="Feed composition and caption" label="Social Post preview" />
      <CardContent className="mx-auto w-full max-w-2xl p-0">
        <div className="flex items-center gap-3 p-4">
          <AvatarDot />
          <div>
            <p className="text-sm font-semibold">your.profile</p>
            <p className="text-xs text-muted-foreground">Original Post</p>
          </div>
        </div>
        <div className="relative aspect-square border-y bg-gradient-to-br from-chart-2/20 via-background to-chart-5/20">
          <span className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background/75 text-muted-foreground backdrop-blur-sm">
            <ImageIcon className="size-5" />
          </span>
          <p className="absolute inset-x-8 bottom-8 rounded-lg bg-background/75 p-3 text-center text-sm font-medium backdrop-blur-sm">
            {post.title}
          </p>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-4">
            <Heart className="size-5" />
            <MessageCircle className="size-5" />
            <Send className="size-5" />
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
            <span className="mr-1 font-semibold">your.profile</span>
            {post.content}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface AdParts {
  headline: string;
  primaryText: string;
  description: string;
  callToAction: string;
}

function parseAd(content: string, fallbackTitle: string): AdParts {
  const read = (label: string, nextLabels: string[]) => {
    const next = nextLabels.length > 0
      ? `(?=\\n(?:${nextLabels.join("|")}):|$)`
      : "$";
    return new RegExp(`${label}:\\s*([\\s\\S]*?)${next}`, "i").exec(content)?.[1]?.trim() ?? "";
  };
  return {
    headline: read("Headline", ["Primary text", "Description", "CTA"]) || fallbackTitle,
    primaryText: read("Primary text", ["Description", "CTA"]) || content,
    description: read("Description", ["CTA"]),
    callToAction: read("CTA", []) || "Learn more",
  };
}

function AdPreview({ post }: { post: ContentDraft }) {
  const ad = parseAd(post.content, post.title);
  return (
    <Card className="gap-0 overflow-hidden py-0" data-testid="post-preview-ad">
      <SurfaceHeader description="Sponsored feed placement" label="Ad preview" />
      <CardContent className="mx-auto w-full max-w-2xl p-0">
        <div className="flex items-center gap-3 p-4">
          <AvatarDot label="BR" square />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Your brand</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Sponsored · <Globe2 className="size-3" />
            </p>
          </div>
        </div>
        <p className="whitespace-pre-wrap px-4 pb-4 text-sm leading-6">{ad.primaryText}</p>
        <div className="relative aspect-[1.91/1] border-y bg-gradient-to-br from-primary/20 via-background to-chart-2/15">
          <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background/75 text-muted-foreground">
            <MousePointerClick className="size-5" />
          </span>
        </div>
        <div className="flex items-center gap-4 bg-muted/35 p-4">
          <div className="min-w-0 flex-1">
            {ad.description ? (
              <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">{ad.description}</p>
            ) : null}
            <p className="mt-1 font-medium leading-snug">{ad.headline}</p>
          </div>
          <Badge className="shrink-0" variant="outline">{ad.callToAction}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewFallback({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <SurfaceHeader description="Audience-visible content" label="Post preview" />
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <MessageSquareText className="size-4" />
          </span>
          <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PostContentPreview({ post }: { post: ContentDraft }) {
  if (post.type === "x_post" || post.type === "tweet_thread") {
    return <XPreview post={post} />;
  }
  if (post.type === "linkedin_post") {
    return <LinkedInPreview post={post} />;
  }
  if (post.type === "video_script") {
    return <YouTubePreview post={post} />;
  }
  if (post.type === "blog_post") {
    return <BlogPreview post={post} />;
  }
  if (post.type === "social_post") {
    return <SocialPreview post={post} />;
  }
  if (post.type === "ad_campaign") {
    return <AdPreview post={post} />;
  }
  return <PreviewFallback>{post.content}</PreviewFallback>;
}
