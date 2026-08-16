"use client";

import type { FC } from "react";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartStatus,
} from "@assistant-ui/react";

import { TooltipIconButton } from "@/components/chat/tooltip-icon-button";
import { MarkdownText } from "@/components/chat/markdown-text";
import { ToolFallback } from "@/components/chat/tool-fallback";
import { cn } from "@/lib/utils";

// Import existing tool UI components
import { SearchResultsCard } from "@/components/chat/tool-parts/search-results-card";
import { ProjectCard } from "@/components/chat/tool-parts/project-card";
import { ProspectCard } from "@/components/chat/tool-parts/prospect-card";
import { ResearchList } from "@/components/chat/tool-parts/research-list";
import { TopicCloud } from "@/components/chat/tool-parts/topic-cloud";
import { ToolProgress } from "@/components/chat/tool-parts/tool-progress";
import { EmptyState } from "@/components/chat/tool-parts/empty-state";
import { AnimatedTool, AnimatedList, AnimatedProgress } from "@/components/chat/tool-parts/animated-tool";
import { TopicMapResult } from "@/components/chat/tool-parts/topic-map-result";
import { ArticleResults } from "@/components/chat/tool-parts/article-results";
import { ToolRecoveryCard } from "@/components/chat/tool-parts/tool-recovery-card";
import {
  AssistantStartingState,
  GenerativeMessageSurface,
  HiddenReasoning,
} from "@/components/chat/generative-message-surface";

// Tool components wrapper to match assistant-ui interface
// status.type can be: "requires-action" | "running" | "complete" | "incomplete"
function renderToolRecovery(
  toolName: string,
  status: ToolCallMessagePartStatus,
  result: unknown,
  isError?: boolean,
) {
  if (!isError && status.type !== "incomplete") return null;
  return <ToolRecoveryCard toolName={toolName} status={status} isError={isError} partialResult={isError ? undefined : result} />;
}

const SearchKnowledgeTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Searching knowledge base..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  return (
    <AnimatedTool>
      <SearchResultsCard data={result as Record<string, unknown>} />
    </AnimatedTool>
  );
};

const GetProjectTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Loading project..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const data = result as Record<string, unknown>;
  if (data.found && data.project) {
    return (
      <AnimatedTool>
        <ProjectCard project={data.project as Record<string, unknown>} />
      </AnimatedTool>
    );
  }
  return (
    <AnimatedTool>
      <EmptyState type="projects" message="Project not found" />
    </AnimatedTool>
  );
};

const ListProjectsTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Listing projects..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const data = result as Record<string, unknown>;
  const projects = data.projects as Record<string, unknown>[] | undefined;
  if (!projects || projects.length === 0) {
    return (
      <AnimatedTool>
        <EmptyState type="projects" />
      </AnimatedTool>
    );
  }
  return (
    <AnimatedList>
      {projects.map((p) => (
        <ProjectCard key={p.id as string} project={p} compact />
      ))}
    </AnimatedList>
  );
};

const GetProspectTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Loading prospect..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const data = result as Record<string, unknown>;
  if (data.found && data.prospect) {
    return (
      <AnimatedTool>
        <ProspectCard prospect={data.prospect as Record<string, unknown>} />
      </AnimatedTool>
    );
  }
  return (
    <AnimatedTool>
      <EmptyState type="prospects" message="Prospect not found" />
    </AnimatedTool>
  );
};

const FindProspectContextTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return <AnimatedProgress><ToolProgress tool={toolName} status="searching" message="Searching prospects and relationship history..." /></AnimatedProgress>;
  }
  if (!result) return null;
  const data = result as { found?: boolean; prospect?: Record<string, unknown> | null };
  if (data.found && data.prospect) return <AnimatedTool><ProspectCard prospect={data.prospect} /></AnimatedTool>;
  return <AnimatedTool><EmptyState type="prospects" message="No matching person in this workspace" /></AnimatedTool>;
};

const ListProspectsTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Listing prospects..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const data = result as Record<string, unknown>;
  const prospects = data.prospects as Record<string, unknown>[] | undefined;
  if (!prospects || prospects.length === 0) {
    return (
      <AnimatedTool>
        <EmptyState type="prospects" />
      </AnimatedTool>
    );
  }
  return (
    <AnimatedList>
      {prospects.map((l) => (
        <ProspectCard key={l.id as string} prospect={l} compact />
      ))}
    </AnimatedList>
  );
};

const GetResearchTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Fetching research..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const data = result as Record<string, unknown>;
  return (
    <AnimatedTool>
      <ResearchList
        items={data.items as Record<string, unknown>[]}
        topic={data.filterTopic as string | null}
      />
    </AnimatedTool>
  );
};

const ListTopicsTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Loading topics..." />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const data = result as Record<string, unknown>;
  return (
    <AnimatedTool>
      <TopicCloud topics={data.topics as Record<string, unknown>[]} />
    </AnimatedTool>
  );
};

const GetTopicMapTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return <AnimatedProgress><ToolProgress tool={toolName} status="searching" message="Mapping Brain connections..." /></AnimatedProgress>;
  }
  if (!result) return null;
  return <AnimatedTool><TopicMapResult data={result as Parameters<typeof TopicMapResult>[0]["data"]} /></AnimatedTool>;
};

const TavilySearchTool: ToolCallMessagePartComponent = ({ args, result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return <AnimatedProgress><ToolProgress tool={toolName} status="searching" message="Searching current sources..." /></AnimatedProgress>;
  }
  if (!result) return null;
  const data = result as { topic?: string; results?: Array<{ title: string; url: string; content: string }> };
  return <AnimatedTool><ArticleResults query={(args as { query?: string })?.query} topic={data.topic} results={data.results ?? []} /></AnimatedTool>;
};

const WorkflowArtifactTool: ToolCallMessagePartComponent = ({ result, status, toolName, isError }) => {
  const recovery = renderToolRecovery(toolName, status, result, isError);
  if (recovery) return recovery;
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <AnimatedProgress>
        <ToolProgress tool={toolName} status="searching" message="Running intelligence workflow…" />
      </AnimatedProgress>
    );
  }
  if (!result) return null;
  const artifact = (result as { artifact?: Record<string, unknown> }).artifact;
  if (!artifact) return null;
  const content = artifact.content as Record<string, unknown> | undefined;
  const body = typeof content?.message === "string" ? content.message : null;
  const subject = typeof content?.subject === "string" ? content.subject : null;
  return (
    <AnimatedTool>
      <div className="my-3 overflow-hidden rounded-xl border border-primary/25 bg-card">
        <div className="border-b bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-primary">
            <span>{String(artifact.kind ?? "artifact").replaceAll("_", " ")}</span>
            <span>·</span>
            <span>{String(artifact.status ?? "ready")}</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{String(artifact.title ?? "Intelligence artifact")}</p>
          {artifact.summary ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{String(artifact.summary)}</p>
          ) : null}
        </div>
        {subject || body ? (
          <div className="space-y-2 px-4 py-3">
            {subject ? <p className="text-xs font-medium">{subject}</p> : null}
            {body ? <p className="whitespace-pre-wrap text-xs leading-5 text-foreground/85">{body}</p> : null}
          </div>
        ) : null}
        <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">
          Artifact ID · {String(artifact.id ?? "pending")}
        </div>
      </div>
    </AnimatedTool>
  );
};

export const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root asChild>
      <div
        className="relative mx-auto w-full max-w-3xl animate-in py-4 duration-150 ease-out fade-in slide-in-from-bottom-1 last:mb-24"
        data-role="assistant"
      >
        <div className="mx-2 text-sm leading-relaxed wrap-break-word text-foreground">
          <GenerativeMessageSurface />
          <MessagePrimitive.Parts
            components={{
              Empty: AssistantStartingState,
              Text: MarkdownText,
              Reasoning: HiddenReasoning,
              tools: {
                by_name: {
                  searchKnowledgeTool: SearchKnowledgeTool,
                  getProjectTool: GetProjectTool,
                  listProjectsTool: ListProjectsTool,
                  getProspectTool: GetProspectTool,
                  findProspectContextTool: FindProspectContextTool,
                  listProspectsTool: ListProspectsTool,
                  getResearchTool: GetResearchTool,
                  listTopicsTool: ListTopicsTool,
                  getTopicMapTool: GetTopicMapTool,
                  tavilySearchTool: TavilySearchTool,
                  runProspectIntelligenceTool: WorkflowArtifactTool,
                  runOutreachIntelligenceTool: WorkflowArtifactTool,
                },
                Fallback: ToolFallback,
              },
            }}
          />
          <MessageError />
        </div>

        <div className="mt-2 ml-2 flex">
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "mr-2 -ml-2 inline-flex items-center text-xs text-muted-foreground",
        className
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <span className="text-xs">←</span>
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <span className="text-xs">→</span>
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
