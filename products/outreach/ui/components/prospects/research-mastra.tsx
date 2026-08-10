'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Button } from '@/components/ui/button';
import { Loader2, Search } from 'lucide-react';
import type { ProspectResearchResult } from '@/products/outreach/domain/research-schema';
import type { TopicStatus } from './ResearchProgressToast';

interface ProspectInfo {
  name: string;
  company: string;
  title?: string;
  location?: string;
}

export const RESEARCH_TOPIC_CONFIG = [
  { topic: 'company', label: 'Company overview' },
  { topic: 'news', label: 'Recent news' },
  { topic: 'ai', label: 'AI initiatives' },
  { topic: 'competitors', label: 'Competitive field' },
  { topic: 'industry', label: 'Industry signals' },
] as const;

export type ResearchTopic = (typeof RESEARCH_TOPIC_CONFIG)[number]['topic'];

export interface ResearchSourcePreview {
  title: string;
  url: string;
  publishedDate?: string | null;
}

export interface ResearchTopicProgress {
  topic: ResearchTopic;
  status: TopicStatus;
  query?: string;
  resultCount?: number;
  sources?: ResearchSourcePreview[];
}

export interface ResearchRunState {
  phase: 'searching' | 'synthesizing' | 'complete' | 'error';
  topics: ResearchTopicProgress[];
  error?: string;
}

interface ToolProgressData {
  topic: ResearchTopic;
  status: 'searching' | 'complete';
  query?: string;
  resultCount?: number;
  sources?: ResearchSourcePreview[];
}

interface ResearchMastraProps {
  prospectId: string;
  prospect: ProspectInfo;
  onProgressUpdate?: (topic: string, status: TopicStatus) => void;
  onRunUpdate?: (run: ResearchRunState) => void;
  onComplete?: (result: ProspectResearchResult) => void;
  onError?: (error: string) => void;
  onStarted?: () => void;
}

function initialTopics(): ResearchTopicProgress[] {
  return RESEARCH_TOPIC_CONFIG.map(({ topic }) => ({ topic, status: 'pending' }));
}

export function ResearchMastra({
  prospectId,
  prospect,
  onProgressUpdate,
  onRunUpdate,
  onComplete,
  onError,
  onStarted,
}: ResearchMastraProps) {
  const hasCompletedRef = useRef(false);
  const runMessageOffsetRef = useRef(0);
  const callbacksRef = useRef({ onComplete, onError, onProgressUpdate, onRunUpdate });
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/outreach/research',
    prepareSendMessagesRequest({ messages }) {
      return {
        body: { messages, prospectId, prospectInfo: prospect },
      };
    },
  }), [prospect.company, prospect.location, prospect.name, prospect.title, prospectId]);

  const { messages, sendMessage, status, error } = useChat({ transport });
  const isStreaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    callbacksRef.current = { onComplete, onError, onProgressUpdate, onRunUpdate };
  }, [onComplete, onError, onProgressUpdate, onRunUpdate]);

  useEffect(() => {
    const topics = new Map<ResearchTopic, ResearchTopicProgress>(
      initialTopics().map((topic) => [topic.topic, topic]),
    );
    let phase: ResearchRunState['phase'] = 'searching';
    let researchData: ProspectResearchResult | null = null;
    let researchError: string | null = null;
    let hasRunData = false;

    for (const message of messages.slice(runMessageOffsetRef.current)) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts ?? []) {
        const partType = (part as { type: string }).type;
        if (partType === 'data-tool-progress') {
          const data = (part as { data: ToolProgressData }).data;
          if (!topics.has(data.topic)) continue;
          hasRunData = true;
          topics.set(data.topic, {
            topic: data.topic,
            status: data.status,
            query: data.query,
            resultCount: data.resultCount,
            sources: data.sources,
          });
          callbacksRef.current.onProgressUpdate?.(data.topic, data.status);
        } else if (partType === 'data-research-status') {
          hasRunData = true;
          const data = (part as { data: { phase?: string } }).data;
          if (data.phase === 'synthesizing') phase = 'synthesizing';
        } else if (partType === 'data-research-result') {
          hasRunData = true;
          phase = 'complete';
          researchData = (part as { data: ProspectResearchResult }).data;
        } else if (partType === 'data-research-error') {
          hasRunData = true;
          phase = 'error';
          researchError = (part as { data: { error: string } }).data.error;
        }
      }
    }

    if (!hasRunData) return;
    const run: ResearchRunState = {
      phase,
      topics: [...topics.values()],
      ...(researchError ? { error: researchError } : {}),
    };
    callbacksRef.current.onRunUpdate?.(run);

    if (researchData && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      callbacksRef.current.onComplete?.(researchData);
    } else if (researchError && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      callbacksRef.current.onError?.(researchError);
    }
  }, [messages]);

  useEffect(() => {
    if (!error || hasCompletedRef.current) return;
    const message = error.message || 'Research failed';
    hasCompletedRef.current = true;
    callbacksRef.current.onRunUpdate?.({ phase: 'error', topics: initialTopics(), error: message });
    callbacksRef.current.onError?.(message);
  }, [error]);

  const startResearch = () => {
    hasCompletedRef.current = false;
    runMessageOffsetRef.current = messages.length;
    onStarted?.();
    onRunUpdate?.({ phase: 'searching', topics: initialTopics() });
    void sendMessage({
      parts: [{
        type: 'text',
        text: `Research ${prospect.name} at ${prospect.company} (${prospect.title || 'Unknown title'}, ${prospect.location || 'Unknown location'})`,
      }],
      role: 'user',
    });
  };

  return (
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
  );
}
