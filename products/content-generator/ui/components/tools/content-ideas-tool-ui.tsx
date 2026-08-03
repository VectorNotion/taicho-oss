"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, Youtube, Linkedin, Twitter, FileText, Zap } from "lucide-react";
import { parseToolResult, ContentIdeasResult } from "./types";

interface ContentIdeasArgs {
  topic: string;
  platform?: string;
}

const platformIcons: Record<string, React.ReactNode> = {
  blog: <FileText className="h-4 w-4" />,
  youtube: <Youtube className="h-4 w-4" />,
  linkedin: <Linkedin className="h-4 w-4" />,
  twitter: <Twitter className="h-4 w-4" />,
};

const difficultyColors = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const engagementColors = {
  low: "text-gray-500",
  medium: "text-yellow-600",
  high: "text-green-600",
};

export const ContentIdeasToolUI = makeAssistantToolUI<ContentIdeasArgs, string>({
  toolName: "generate_content_ideas",
  render: ({ args, result, status }) => {
    // Loading state
    if (status.type === "running") {
      return (
        <Card className="my-4 border-purple-200 dark:border-purple-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 animate-pulse" />
              Generating ideas for: {args.topic}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border p-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
                <Skeleton className="mt-3 h-3 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      );
    }

    // Parse the result
    const parsed = parseToolResult(result);
    if (!parsed || parsed.type !== "content_ideas") {
      return (
        <Card className="my-4 border-muted">
          <CardContent className="py-4 text-sm text-muted-foreground">
            {typeof result === "string" ? result : "Content ideas generated"}
          </CardContent>
        </Card>
      );
    }

    const data = parsed as ContentIdeasResult;
    const PlatformIcon = platformIcons[data.platform] || <FileText className="h-4 w-4" />;

    return (
      <Card className="my-4 border-purple-200 dark:border-purple-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4 text-purple-600" />
            Content Ideas: {data.topic}
            <Badge variant="outline" className="ml-auto flex items-center gap-1">
              {PlatformIcon}
              {data.platform}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.ideas.map((idea, index) => (
            <div
              key={index}
              className="group relative rounded-lg border bg-card p-4 transition-all hover:border-purple-300 hover:shadow-md dark:hover:border-purple-700"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <Badge variant="secondary" className="text-xs">
                  {idea.format}
                </Badge>
                <Badge
                  variant="secondary"
                  className={difficultyColors[idea.difficulty]}
                >
                  {idea.difficulty}
                </Badge>
              </div>
              <h4 className="font-medium text-sm leading-tight">{idea.title}</h4>
              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                {idea.rationale}
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs">
                <Zap className={`h-3 w-3 ${engagementColors[idea.estimated_engagement]}`} />
                <span className={engagementColors[idea.estimated_engagement]}>
                  {idea.estimated_engagement} engagement
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  },
});
