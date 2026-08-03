import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Video, FileText, MessageSquare, Globe, User } from "lucide-react";

type ContentType = "video" | "blog" | "tweet" | "landing_page";
type ContentStatus = "planned" | "draft_ready" | "awaiting_recording" | "ready_to_publish" | "published";

interface ContentCardProps {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  requiresHuman?: boolean;
  publishDate?: string;
  platforms?: string[];
}

const typeConfig = {
  video: {
    icon: Video,
    label: "Video",
  },
  blog: {
    icon: FileText,
    label: "Blog",
  },
  tweet: {
    icon: MessageSquare,
    label: "Tweet",
  },
  landing_page: {
    icon: Globe,
    label: "Landing page",
  },
};

const statusConfig = {
  planned: {
    variant: "secondary" as const,
    label: "Planned",
  },
  draft_ready: {
    variant: "default" as const,
    label: "Draft Ready",
  },
  awaiting_recording: {
    variant: "secondary" as const,
    label: "Awaiting Recording",
  },
  ready_to_publish: {
    variant: "default" as const,
    label: "Ready to Publish",
  },
  published: {
    variant: "default" as const,
    label: "Published",
  },
};

export function ContentCard({
  id,
  title,
  type,
  status,
  requiresHuman,
  publishDate,
  platforms = [],
}: ContentCardProps) {
  const typeStyle = typeConfig[type];
  const statusStyle = statusConfig[status];
  const TypeIcon = typeStyle.icon;

  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-2 rounded-lg bg-primary/10">
            <TypeIcon className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <CardTitle className="line-clamp-2">{title}</CardTitle>
              <CardDescription>{typeStyle.label}</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={statusStyle.variant}>{statusStyle.label}</Badge>
              {requiresHuman && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  Human needed
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="pt-4 space-y-3">
        {publishDate && (
          <div className="text-sm">
            <span className="font-medium text-foreground">Publish:</span>
            <span className="text-muted-foreground ml-2">{publishDate}</span>
          </div>
        )}

        {platforms.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Platforms</div>
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((platform) => (
                <Badge key={platform} variant="outline" className="text-xs">
                  {platform}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <Separator />

      <CardFooter className="pt-4">
        <Link href={`/content/${id}`} className="w-full">
          <Button className="w-full" variant="outline" size="sm">
            View Details
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
