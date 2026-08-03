'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, Check, Tag, FileText, Layers } from 'lucide-react';

interface ProjectCardProps {
  project: Record<string, unknown>;
  compact?: boolean;
}

export function ProjectCard({ project, compact = false }: ProjectCardProps) {
  const title = project.title as string;
  const description = project.description as string | null;
  const status = project.status as string | null;
  const processed = project.processed as boolean | null;
  const tags = project.tags as string[] | null;
  const entities = project.entities as Array<{ type: string; name: string; relationship: string }> | null;
  const relatedResearch = project.relatedResearch as Array<{ id: string; title: string; priority?: string }> | null;

  if (compact) {
    return (
      <div className="p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-component="DATA-02 Project Result Card">

        <div className="flex items-center gap-2.5">
          {/* Gradient icon */}
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
            <Database className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{title}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{description}</p>
            )}
          </div>

          {status && (
            <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
              {status}
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="my-2 rounded-lg" data-component="DATA-02 Project Result Card">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted shrink-0">
              <Database className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">{title}</CardTitle>
                {processed && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Check className="h-3 w-3" />
                    Processed
                  </Badge>
                )}
                {status && (
                  <Badge variant={status === 'active' ? 'default' : 'secondary'} className="text-xs">
                    {status}
                  </Badge>
                )}
              </div>
              {description && (
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Tags */}
          {tags && tags.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">Tags</span>
              </div>
              <div className="flex flex-wrap gap-1.5 ml-9">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Entities */}
          {entities && entities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">Entities</span>
                <Badge variant="secondary" className="text-xs ml-auto">
                  {entities.length}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 ml-9">
                {entities.map((entity, idx) => (
                  <Badge
                    key={idx}
                    variant="secondary"
                    className="text-xs"
                    title={`${entity.relationship}: ${entity.type}`}
                  >
                    {entity.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Related Research */}
          {relatedResearch && relatedResearch.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">Related Research</span>
                <Badge variant="secondary" className="text-xs ml-auto">
                  {relatedResearch.length}
                </Badge>
              </div>
              <div className="space-y-1.5 ml-9">
                {relatedResearch.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-sm"
                  >
                    <span className="truncate">{item.title}</span>
                    {item.priority && (
                      <Badge
                        variant={
                          item.priority === 'high'
                            ? 'destructive'
                            : item.priority === 'medium'
                            ? 'default'
                            : 'secondary'
                        }
                        className="text-xs ml-2 shrink-0"
                      >
                        {item.priority}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
  );
}
