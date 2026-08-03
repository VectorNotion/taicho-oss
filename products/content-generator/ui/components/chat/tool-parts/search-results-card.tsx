'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Database, Users, FileText, Tags } from 'lucide-react';

interface SearchResultsCardProps {
  data: Record<string, unknown>;
}

export function SearchResultsCard({ data }: SearchResultsCardProps) {
  const query = data.query as string;
  const projects = (data.projects as Record<string, unknown>[]) || [];
  const leads = (data.leads as Record<string, unknown>[]) || [];
  const research = (data.research as Record<string, unknown>[]) || [];
  const topics = (data.topics as Record<string, unknown>[]) || [];

  const totalResults = projects.length + leads.length + research.length + topics.length;

  return (
    <Card className="my-2 rounded-lg" data-component="DATA-04 Research Result List">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <CardTitle className="text-base">Search: &quot;{query}&quot;</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Found {totalResults} results across all categories
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Projects */}
        {projects.length > 0 && (
          <ResultSection icon={<Database className="h-4 w-4 text-muted-foreground" />} title="Projects" count={projects.length}>
            {projects.map((p) => (
              <ResultItem
                key={p.id as string}
                title={p.title as string}
                subtitle={p.description as string}
                badge={p.status as string}
              />
            ))}
          </ResultSection>
        )}

        {/* Leads */}
        {leads.length > 0 && (
          <ResultSection icon={<Users className="h-4 w-4 text-muted-foreground" />} title="Leads" count={leads.length}>
            {leads.map((l) => (
              <ResultItem
                key={l.id as string}
                title={l.name as string}
                subtitle={`${l.company || 'Unknown company'} - ${l.title || 'Unknown title'}`}
                badge={l.status as string}
                badgeVariant={(l.hasResearch as boolean) ? 'default' : 'outline'}
              />
            ))}
          </ResultSection>
        )}

        {/* Research */}
        {research.length > 0 && (
          <ResultSection icon={<FileText className="h-4 w-4 text-muted-foreground" />} title="Research" count={research.length}>
            {research.map((r) => (
              <ResultItem
                key={r.id as string}
                title={r.title as string}
                subtitle={truncate(r.content as string, 100)}
                badge={r.priority as string}
                tags={r.tags as string[]}
              />
            ))}
          </ResultSection>
        )}

        {/* Topics */}
        {topics.length > 0 && (
          <ResultSection icon={<Tags className="h-4 w-4 text-muted-foreground" />} title="Topics" count={topics.length}>
            {topics.map((t) => (
              <ResultItem
                key={t.id as string}
                title={(t.displayName as string) || (t.name as string)}
                subtitle={t.description as string}
                badge={`${t.researchCount || 0} items`}
              />
            ))}
          </ResultSection>
        )}

        {totalResults === 0 && (
          <p className="text-center text-muted-foreground py-4" data-component="DATA-07 Empty Result">No results found for this search.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ResultSection({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
          {icon}
        </div>
        <span className="font-medium text-sm">{title}</span>
        <Badge variant="secondary" className="text-xs ml-auto">
          {count}
        </Badge>
      </div>
      <div className="space-y-2 ml-9">{children}</div>
    </div>
  );
}

function ResultItem({
  title,
  subtitle,
  badge,
  badgeVariant = 'secondary',
  tags,
}: {
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  badgeVariant?: 'default' | 'secondary' | 'outline';
  tags?: string[] | null;
}) {
  return (
    <div className="p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {badge && (
          <Badge variant={badgeVariant} className="text-xs shrink-0">
            {badge}
          </Badge>
        )}
      </div>
    </div>
  );
}

function truncate(str: string | null | undefined, length: number): string {
  if (!str) return '';
  return str.length > length ? str.slice(0, length) + '...' : str;
}
