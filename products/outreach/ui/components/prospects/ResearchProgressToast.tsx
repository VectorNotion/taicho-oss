'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Building2, Newspaper, Brain, Users, TrendingUp, Check, Loader2, Circle } from 'lucide-react';

export type TopicStatus = 'pending' | 'searching' | 'complete';

export interface ProgressUpdate {
  topic: string;
  status: TopicStatus;
}

const RESEARCH_STEPS = [
  { topic: 'company', label: 'Company overview', icon: Building2 },
  { topic: 'news', label: 'Recent news', icon: Newspaper },
  { topic: 'ai', label: 'AI initiatives', icon: Brain },
  { topic: 'competitors', label: 'Competitors', icon: Users },
  { topic: 'industry', label: 'Industry trends', icon: TrendingUp },
] as const;

interface ResearchProgressToastProps {
  progress: Map<string, TopicStatus>;
  isAnalyzing?: boolean;
}

function ProgressContent({ progress, isAnalyzing }: ResearchProgressToastProps) {
  return (
    <div className="flex flex-col gap-2 min-w-[240px] bg-card text-card-foreground border rounded-lg p-4 shadow-lg">
      {RESEARCH_STEPS.map(({ topic, label, icon: Icon }) => {
        const status = progress.get(topic) || 'pending';
        return (
          <div key={topic} className="flex items-center gap-2 text-sm">
            {status === 'complete' ? (
              <Check className="h-4 w-4 text-chart-2" />
            ) : status === 'searching' ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className={status === 'complete' ? 'text-muted-foreground' : ''}>
              {label}
            </span>
          </div>
        );
      })}
      {isAnalyzing && (
        <div className="flex items-center gap-2 text-sm mt-2 pt-2 border-t">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span>Analyzing results...</span>
        </div>
      )}
    </div>
  );
}

export function useResearchProgressToast() {
  const toastId = useRef<string | number | null>(null);

  const showProgress = useCallback((progress: Map<string, TopicStatus>, isAnalyzing = false) => {
    const allComplete = RESEARCH_STEPS.every(
      (step) => progress.get(step.topic) === 'complete'
    );

    if (toastId.current === null) {
      toastId.current = toast.custom(
        () => <ProgressContent progress={progress} isAnalyzing={isAnalyzing} />,
        {
          duration: Infinity,
          id: 'research-progress',
        }
      );
    } else {
      toast.custom(
        () => <ProgressContent progress={progress} isAnalyzing={isAnalyzing} />,
        {
          id: 'research-progress',
          duration: allComplete && !isAnalyzing ? 2000 : Infinity,
        }
      );
    }
  }, []);

  const showSuccess = useCallback(() => {
    toast.success('Research complete', {
      id: 'research-progress',
      duration: 2000,
    });
    toastId.current = null;
  }, []);

  const showError = useCallback((error: string) => {
    toast.error(error, {
      id: 'research-progress',
      duration: 4000,
    });
    toastId.current = null;
  }, []);

  const dismiss = useCallback(() => {
    toast.dismiss('research-progress');
    toastId.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (toastId.current !== null) {
        toast.dismiss('research-progress');
      }
    };
  }, []);

  return { showProgress, showSuccess, showError, dismiss };
}
