"use client";

import type { FC } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";
import { ThreadPrimitive } from "@assistant-ui/react";
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/chat/composer";
import { ChatToolApprovalCard } from "@/components/chat/tool-approval-card";
import { ChatConversationErrorCard } from "@/components/chat/conversation-error-card";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { UserMessage, EditComposer } from "@/components/chat/user-message";
import {
  ChatStarterVisual,
  type ChatStarterIcon,
} from "@/components/chat/control-deck";
import type {
  ChatContactTarget,
  ChatControlAvailability,
  ChatControls,
} from "@content-automation/platform/intelligence/chat-controls";

interface ThreadSuggestionsProps {
  suggestions?: {
    title: string;
    label?: string;
    icon?: ChatStarterIcon;
    prompt: string;
    service?: string;
  }[];
}

interface ThreadProps extends ThreadSuggestionsProps {
  availability: ChatControlAvailability;
  disabled?: boolean;
  welcome?: string;
  agentName?: string;
  contactTargets?: ChatContactTarget[];
  contactLocked?: boolean;
  compact?: boolean;
  controls: ChatControls;
  onControlsChange: (controls: ChatControls) => void;
}

export const Thread: FC<ThreadProps> = ({
  suggestions = defaultSuggestions,
  availability,
  disabled = false,
  welcome = "How can I help you today?",
  agentName,
  contactTargets,
  contactLocked = false,
  compact = false,
  controls,
  onControlsChange,
}) => {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <ThreadPrimitive.Root
          className="flex h-full flex-col bg-background"
          style={{
            ["--thread-max-width" as string]: "48rem",
          }}
        >
          <ThreadPrimitive.Viewport className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 sm:px-4">
            <ThreadPrimitive.If empty>
              <ThreadWelcome
                disabled={disabled}
                suggestions={suggestions}
                welcome={welcome}
                agentName={agentName}
                compact={compact}
              />
            </ThreadPrimitive.If>

            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                EditComposer,
                AssistantMessage,
              }}
            />

            <ThreadPrimitive.If empty={false}>
              <div className="min-h-8 grow" />
            </ThreadPrimitive.If>

            <ChatToolApprovalCard />
            <ChatConversationErrorCard />

            <Composer
              availability={availability}
              contactTargets={contactTargets}
              contactLocked={contactLocked}
              controls={controls}
              disabled={disabled}
              onControlsChange={onControlsChange}
              autoFocus={!compact}
            />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </MotionConfig>
    </LazyMotion>
  );
};

interface ThreadWelcomeProps extends ThreadSuggestionsProps {
  disabled?: boolean;
  welcome: string;
  agentName?: string;
  compact?: boolean;
}

const ThreadWelcome: FC<ThreadWelcomeProps> = ({
  suggestions,
  disabled = false,
  welcome,
  agentName,
  compact = false,
}) => {
  return (
    <div className="mx-auto my-auto flex w-full max-w-3xl grow flex-col">
      <div className="flex w-full grow flex-col items-center justify-center">
        <div className="flex size-full flex-col items-center justify-center px-2 py-6 text-center sm:px-6">
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <Badge className="gap-1.5" variant="secondary">
              <SparklesIcon className="size-3.5 text-primary" />
              {agentName ?? "Assistant"}
            </Badge>
          </m.div>
          <m.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ delay: 0.05 }}
            className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {welcome}
          </m.h1>
          <m.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ delay: 0.1 }}
            className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground"
          >
            Start with an outcome. Taicho can inspect live workspace context,
            use the available capabilities, and keep working until the job is done.
          </m.p>
        </div>
      </div>
      <ThreadSuggestions compact={compact} disabled={disabled} suggestions={suggestions} />
    </div>
  );
};

const ThreadSuggestions: FC<ThreadSuggestionsProps & { compact?: boolean; disabled?: boolean }> = ({
  compact = false,
  disabled = false,
  suggestions,
}) => {
  return (
    <div className="grid w-full gap-2 pb-4 md:grid-cols-2 [@media(max-height:640px)]:hidden">
      {suggestions?.map((suggestedAction, index) => (
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          className="nth-[n+3]:hidden md:nth-[n+3]:block"
        >
          <ThreadPrimitive.Suggestion
            prompt={suggestedAction.prompt}
            send
            asChild
          >
            <Button
              variant="outline"
              className="group min-h-24 w-full justify-start gap-3 whitespace-normal bg-card p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/5 hover:shadow-md"
              aria-label={suggestedAction.prompt}
              disabled={disabled}
            >
              <ChatStarterVisual
                description={suggestedAction.label ?? suggestedAction.prompt}
                icon={suggestedAction.icon ?? "research"}
                service={suggestedAction.service ?? "Workspace"}
                showService={!compact}
                title={suggestedAction.title}
              />
              <ArrowUpRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Button>
          </ThreadPrimitive.Suggestion>
        </m.div>
      ))}
    </div>
  );
};

const defaultSuggestions: ThreadSuggestionsProps["suggestions"] = [
  {
    title: "Search knowledge",
    label: "across projects and prospects",
    icon: "research",
    prompt: "Search for AI-related projects and prospects",
    service: "Workspace",
  },
  {
    title: "List my projects",
    label: "with their status",
    icon: "plan",
    prompt: "List all my projects and their current status",
    service: "Projects",
  },
  {
    title: "Show recent research",
    label: "from the last week",
    icon: "content",
    prompt: "Show me recent research items from the past week",
    service: "Research",
  },
  {
    title: "List active topics",
    label: "with research counts",
    icon: "brain",
    prompt: "What topics have the most research?",
    service: "Brain",
  },
];
