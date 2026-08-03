'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tags, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopicCloudProps {
  topics: Record<string, unknown>[];
}

export function TopicCloud({ topics }: TopicCloudProps) {
  if (!topics || topics.length === 0) {
    return (
      <Card className="my-2 rounded-lg">
        <CardContent className="py-6 text-center text-muted-foreground">
          No active topics found.
        </CardContent>
      </Card>
    );
  }

  // Calculate size based on research count
  const maxCount = Math.max(...topics.map((t) => (t.researchCount as number) || 0), 1);

  const getSize = (count: number): string => {
    const ratio = count / maxCount;
    if (ratio > 0.7) return 'text-lg font-semibold';
    if (ratio > 0.4) return 'text-base font-medium';
    return 'text-sm';
  };

  const getVariant = (count: number): 'default' | 'secondary' | 'outline' => {
    const ratio = count / maxCount;
    if (ratio > 0.7) return 'default';
    if (ratio > 0.3) return 'secondary';
    return 'outline';
  };

  return (
    <Card className="my-2 rounded-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
            <Tags className="h-4 w-4 text-muted-foreground" />
          </div>
          <CardTitle className="text-base">Topics</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          {topics.length} active topics with research
        </p>
      </CardHeader>
      <CardContent>
        {/* Cloud view */}
        <div className="flex flex-wrap gap-2 mb-4">
          {topics.map((topic) => {
            const id = topic.id as string;
            const displayName = (topic.displayName as string) || (topic.name as string);
            const researchCount = (topic.researchCount as number) || 0;

            return (
              <Badge
                key={id}
                variant={getVariant(researchCount)}
                className={cn('cursor-default', getSize(researchCount))}
                title={`${researchCount} research items`}
              >
                {displayName}
                <span className="ml-1 opacity-70">({researchCount})</span>
              </Badge>
            );
          })}
        </div>

        {/* List view with descriptions */}
        <div className="space-y-2">
          {topics
            .filter((t) => t.description)
            .slice(0, 5)
            .map((topic) => {
              const id = topic.id as string;
              const displayName = (topic.displayName as string) || (topic.name as string);
              const description = topic.description as string;
              const researchCount = (topic.researchCount as number) || 0;

              return (
                <div key={id} className="p-2 rounded bg-muted/50 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{displayName}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3" />
                      {researchCount}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}
