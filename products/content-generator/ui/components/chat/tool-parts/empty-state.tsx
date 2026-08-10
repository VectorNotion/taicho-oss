'use client';

import { Card, CardContent } from '@/components/ui/card';
import { SearchX, Users, Database, FileText, Tags } from 'lucide-react';

type EmptyStateType = 'prospects' | 'projects' | 'research' | 'topics' | 'search';

interface EmptyStateProps {
  type: EmptyStateType;
  message?: string;
  suggestion?: string;
}

const config: Record<EmptyStateType, {
  icon: typeof SearchX;
  defaultMessage: string;
  defaultSuggestion: string;
}> = {
  prospects: {
    icon: Users,
    defaultMessage: 'No prospects found',
    defaultSuggestion: 'Try adjusting your search or add new prospects',
  },
  projects: {
    icon: Database,
    defaultMessage: 'No projects found',
    defaultSuggestion: 'Create a new project to get started',
  },
  research: {
    icon: FileText,
    defaultMessage: 'No research items found',
    defaultSuggestion: 'Run research on a topic to populate this',
  },
  topics: {
    icon: Tags,
    defaultMessage: 'No topics found',
    defaultSuggestion: 'Topics are extracted from your projects',
  },
  search: {
    icon: SearchX,
    defaultMessage: 'No results found',
    defaultSuggestion: 'Try different keywords',
  },
};

export function EmptyState({ type, message, suggestion }: EmptyStateProps) {
  const { icon: Icon, defaultMessage, defaultSuggestion } = config[type];

  return (
    <Card className="my-2 rounded-lg" data-component="DATA-07 Empty Result">
      <CardContent className="flex flex-col items-center justify-center py-6 px-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-muted mb-3">
          <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          {message || defaultMessage}
        </p>
        <p className="text-xs text-muted-foreground text-center">
          {suggestion || defaultSuggestion}
        </p>
      </CardContent>
    </Card>
  );
}
