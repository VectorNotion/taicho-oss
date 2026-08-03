'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Button } from '@/components/ui/button';
import { Loader2, Search, FlaskConical } from 'lucide-react';
import type { LeadResearchResult } from '@/products/outreach/domain/research-schema';
import {
  useResearchProgressToast,
  type TopicStatus,
} from './ResearchProgressToast';

interface LeadInfo {
  name: string;
  company: string;
  title?: string;
  location?: string;
}

interface ToolProgressData {
  topic: string;
  status: 'searching' | 'complete';
  query?: string;
  resultCount?: number;
}

interface ResearchMastraProps {
  leadId: string;
  lead: LeadInfo;
  onProgressUpdate?: (topic: string, status: TopicStatus) => void;
  onComplete?: (result: LeadResearchResult) => void;
  onError?: (error: string) => void;
  onStarted?: () => void;
}

export function ResearchMastra({
  leadId,
  lead,
  onProgressUpdate,
  onComplete,
  onError,
  onStarted,
}: ResearchMastraProps) {
  const { showProgress, showSuccess, showError, dismiss } = useResearchProgressToast();
  const progressRef = useRef<Map<string, TopicStatus>>(new Map());
  const hasCompletedRef = useRef(false);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/outreach/research',
      prepareSendMessagesRequest({ messages }) {
        return {
          body: { messages, leadId, leadInfo: lead },
        };
      },
    }),
    onFinish: () => {
      // Final completion handled in useEffect when we get the result
    },
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  // Process messages and extract progress/results
  useEffect(() => {
    let researchData: LeadResearchResult | null = null;
    let researchError: string | null = null;
    const newProgress = new Map<string, TopicStatus>();

    messages.forEach((message) => {
      if (message.role === 'assistant') {
        message.parts?.forEach((part) => {
          const partType = (part as { type: string }).type;

          if (partType === 'data-tool-progress') {
            const data = (part as { data: ToolProgressData }).data;
            newProgress.set(data.topic, data.status as TopicStatus);
            onProgressUpdate?.(data.topic, data.status as TopicStatus);
          } else if (partType === 'data-research-result') {
            researchData = (part as { data: LeadResearchResult }).data;
          } else if (partType === 'data-research-error') {
            researchError = (part as { data: { error: string } }).data.error;
          }
        });
      }
    });

    // Update progress map and show toast
    if (newProgress.size > 0) {
      progressRef.current = newProgress;

      // Check if all 5 topics complete but no result yet = analyzing
      const allComplete = ['company', 'news', 'ai', 'competitors', 'industry'].every(
        (t) => newProgress.get(t) === 'complete'
      );

      showProgress(newProgress, allComplete && !researchData && !researchError);
    }

    // Handle completion
    if (researchData && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      showSuccess();
      onComplete?.(researchData);
    }

    // Handle error
    if (researchError && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      showError(researchError);
      onError?.(researchError);
    }
  }, [messages, onProgressUpdate, onComplete, onError, showProgress, showSuccess, showError]);

  // Handle transport errors
  useEffect(() => {
    if (error) {
      showError(error.message || 'Research failed');
      onError?.(error.message || 'Research failed');
    }
  }, [error, showError, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dismiss();
    };
  }, [dismiss]);

  const startResearch = () => {
    // Reset state for new research
    hasCompletedRef.current = false;
    progressRef.current = new Map();

    // Notify parent that research started
    onStarted?.();

    // Initialize all topics as pending
    const initialProgress = new Map<string, TopicStatus>();
    ['company', 'news', 'ai', 'competitors', 'industry'].forEach((topic) => {
      initialProgress.set(topic, 'pending');
    });
    showProgress(initialProgress);

    sendMessage({
      parts: [
        {
          type: 'text',
          text: `Research ${lead.name} at ${lead.company} (${lead.title || 'Unknown title'}, ${lead.location || 'Unknown location'})`,
        },
      ],
      role: 'user',
    });
  };

  const [isTesting, setIsTesting] = useState(false);

  const testToast = () => {
    if (isTesting) return;
    setIsTesting(true);

    const topics = ['company', 'news', 'ai', 'competitors', 'industry'] as const;
    const progress = new Map<string, TopicStatus>();

    // Initialize all as pending
    topics.forEach((t) => progress.set(t, 'pending'));
    showProgress(new Map(progress));

    // Simulate each topic completing one by one
    topics.forEach((topic, idx) => {
      // Start searching
      setTimeout(() => {
        progress.set(topic, 'searching');
        showProgress(new Map(progress));
      }, idx * 800);

      // Complete
      setTimeout(() => {
        progress.set(topic, 'complete');
        const allDone = topics.every((t) => progress.get(t) === 'complete');
        showProgress(new Map(progress), allDone);
      }, idx * 800 + 400);
    });

    // Dismiss after all done
    setTimeout(() => {
      dismiss();
      setIsTesting(false);
    }, topics.length * 800 + 500);
  };

  return (
    <div className="flex gap-1">
      <Button onClick={startResearch} disabled={isStreaming} size="sm" variant="secondary">
        {isStreaming ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        <span className="ml-1.5 hidden sm:inline">
          {isStreaming ? 'Researching...' : 'Research'}
        </span>
      </Button>
      <Button onClick={testToast} disabled={isTesting} size="sm" variant="ghost" title="Test toast">
        <FlaskConical className="h-4 w-4" />
      </Button>
    </div>
  );
}
