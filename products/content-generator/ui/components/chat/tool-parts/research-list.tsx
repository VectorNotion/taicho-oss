'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, ExternalLink, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ResearchListProps {
  items: Record<string, unknown>[];
  topic?: string | null;
}

export function ResearchList({ items, topic }: ResearchListProps) {
  if (!items || items.length === 0) {
    return (
      <Card className="my-2 rounded-lg" data-component="DATA-07 Empty Result">
        <CardContent className="py-6 text-center text-muted-foreground">
          No research items found{topic ? ` for topic "${topic}"` : ''}.
        </CardContent>
      </Card>
    );
  }

  const priorityColors: Record<string, 'destructive' | 'default' | 'secondary'> = {
    high: 'destructive',
    medium: 'default',
    low: 'secondary',
  };

  return (
    <Card className="my-2 rounded-lg" data-component="DATA-04 Research Result List">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <CardTitle className="text-base">Research Items</CardTitle>
          {topic && (
            <Badge variant="outline" className="text-xs font-normal">
              Topic: {topic}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Found {items.length} research items</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => {
          const id = item.id as string;
          const title = item.title as string;
          const content = item.content as string | null;
          const sourceUrl = item.sourceUrl as string | null;
          const tags = item.tags as string[] | null;
          const priority = item.priority as string | null;
          const createdAt = item.createdAt as string | null;

          return (
            <div
              key={id}
              className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
              data-component="DATA-03 Article Result Card"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h4 className="font-medium text-sm">{title}</h4>
                {priority && (
                  <Badge
                    variant={priorityColors[priority] || 'secondary'}
                    className="text-xs shrink-0"
                  >
                    {priority}
                  </Badge>
                )}
              </div>

              {content && (
                <p className="text-sm text-muted-foreground mb-2 line-clamp-3">{content}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {tags && tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.slice(0, 4).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {tags.length > 4 && (
                      <Badge variant="outline" className="text-xs">
                        +{tags.length - 4}
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex-1" />

                {createdAt && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
                  </span>
                )}

                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    data-component="DATA-06 Source Chip"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Source
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
