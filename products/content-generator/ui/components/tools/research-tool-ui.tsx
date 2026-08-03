"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ExternalLink, TrendingUp } from "lucide-react";
import { parseToolResult, ResearchResult } from "./types";

interface ResearchToolArgs {
  query: string;
}

const priorityColors = {
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export const ResearchToolUI = makeAssistantToolUI<ResearchToolArgs, string>({
  toolName: "research_topics",
  render: ({ args, result, status }) => {
    // Loading state
    if (status.type === "running") {
      return (
        <Card className="my-4 border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 animate-pulse" />
              Researching: {args.query}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </CardContent>
        </Card>
      );
    }

    // Parse the result
    const parsed = parseToolResult(result);
    if (!parsed || parsed.type !== "research_results") {
      return (
        <Card className="my-4 border-muted">
          <CardContent className="py-4 text-sm text-muted-foreground">
            {typeof result === "string" ? result : "Research completed"}
          </CardContent>
        </Card>
      );
    }

    const data = parsed as ResearchResult;

    return (
      <Card className="my-4 border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            Research Results: {data.query}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.items.map((item, index) => (
            <div
              key={index}
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-sm">{item.title}</h4>
                <Badge
                  variant="secondary"
                  className={priorityColors[item.priority]}
                >
                  {item.priority}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.content}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  {item.source}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  },
});
