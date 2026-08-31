"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleStopIcon,
  FilePenLineIcon,
  FileTextIcon,
  GaugeIcon,
  Globe2Icon,
  Link2Icon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  MessageSquareTextIcon,
  PaperclipIcon,
  PencilLineIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserRoundSearchIcon,
  UsersRoundIcon,
  WorkflowIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

type PreviewStage = "compose" | "working" | "approval" | "complete";
type SourceId =
  | "auto"
  | "workspace"
  | "brain"
  | "web"
  | "outreach"
  | "content"
  | "nurture";
type DepthId = "quick" | "balanced" | "deep";
type TeamId =
  | "auto"
  | "taicho"
  | "scout"
  | "cartographer"
  | "muse"
  | "scribe";
type PermissionId = "read-only" | "ask" | "workspace-edits" | "allow-all";
type ContextId = "project" | "prospect" | "topic" | "file" | "url" | "page";

interface Option<T extends string> {
  id: T;
  label: string;
  description: string;
  icon: typeof SearchIcon;
}

const sourceOptions: Array<
  Option<Exclude<SourceId, "auto">> & { available?: boolean; reason?: string }
> = [
  {
    id: "workspace",
    label: "Workspace",
    description: "Projects, prospects, research, and history",
    icon: SearchIcon,
  },
  {
    id: "brain",
    label: "Brain",
    description: "Relationships, topics, and knowledge gaps",
    icon: BrainCircuitIcon,
  },
  {
    id: "web",
    label: "Current web",
    description: "Fresh external evidence and sources",
    icon: Globe2Icon,
  },
  {
    id: "outreach",
    label: "Outreach",
    description: "People, qualification, and conversations",
    icon: UserRoundSearchIcon,
  },
  {
    id: "content",
    label: "Content",
    description: "Projects, drafts, channels, and research",
    icon: FilePenLineIcon,
  },
  {
    id: "nurture",
    label: "Nurture",
    description: "Journeys and relationship sequences",
    icon: WorkflowIcon,
    available: false,
    reason: "Package not connected",
  },
];

const depthOptions: Array<Option<DepthId>> = [
  {
    id: "quick",
    label: "Quick",
    description: "Direct answer with minimal tool use",
    icon: ZapIcon,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Use tools and specialists when useful",
    icon: GaugeIcon,
  },
  {
    id: "deep",
    label: "Deep",
    description: "Broader evidence and multi-step delegation",
    icon: BrainCircuitIcon,
  },
];

const teamOptions: Array<Option<TeamId>> = [
  {
    id: "auto",
    label: "Auto team",
    description: "Taicho chooses the right specialists",
    icon: SparklesIcon,
  },
  {
    id: "taicho",
    label: "Taicho only",
    description: "Keep the work in one model",
    icon: BotIcon,
  },
  {
    id: "scout",
    label: "Scout",
    description: "Person and company research",
    icon: UserRoundSearchIcon,
  },
  {
    id: "cartographer",
    label: "Cartographer",
    description: "Knowledge mapping and gaps",
    icon: BrainCircuitIcon,
  },
  {
    id: "muse",
    label: "Muse",
    description: "Grounded angles and creative direction",
    icon: SparklesIcon,
  },
  {
    id: "scribe",
    label: "Scribe",
    description: "Structured, publishable drafts",
    icon: FilePenLineIcon,
  },
];

const permissionOptions: Array<Option<PermissionId>> = [
  {
    id: "read-only",
    label: "Read only",
    description: "Search and draft in chat; never change records",
    icon: LockKeyholeIcon,
  },
  {
    id: "ask",
    label: "Ask before acting",
    description: "Confirm every workspace change",
    icon: MessageSquareTextIcon,
  },
  {
    id: "workspace-edits",
    label: "Allow workspace edits",
    description: "Save notes, drafts, and record updates",
    icon: PencilLineIcon,
  },
  {
    id: "allow-all",
    label: "Allow All",
    description: "Use every permitted action in this chat",
    icon: ShieldCheckIcon,
  },
];

const contextOptions: Array<Option<ContextId>> = [
  {
    id: "project",
    label: "Project",
    description: "Attach a project and its knowledge",
    icon: FileTextIcon,
  },
  {
    id: "prospect",
    label: "Prospect",
    description: "Attach a person and relationship history",
    icon: UserRoundSearchIcon,
  },
  {
    id: "topic",
    label: "Topic",
    description: "Attach a Brain topic or entity",
    icon: BrainCircuitIcon,
  },
  {
    id: "file",
    label: "File",
    description: "Document, PDF, image, audio, or video",
    icon: PaperclipIcon,
  },
  {
    id: "url",
    label: "URL",
    description: "Bring a current page into context",
    icon: Link2Icon,
  },
  {
    id: "page",
    label: "Current page",
    description: "Use the product page you came from",
    icon: Globe2Icon,
  },
];

const starters = [
  {
    title: "Plan today",
    description: "Coordinate priorities with the squad",
    service: "Workspace + Squad",
    prompt:
      "Review the workspace and help me choose the most valuable work to move forward today.",
    icon: WorkflowIcon,
    tone: "bg-primary/10 text-primary",
  },
  {
    title: "Find a content opportunity",
    description: "Research, angle, and opening",
    service: "Content + Research",
    prompt:
      "Find a strong content opportunity from our projects, research, and current context.",
    icon: FilePenLineIcon,
    tone: "bg-chart-1/10 text-chart-1",
  },
  {
    title: "Prepare outreach",
    description: "Research and qualify a prospect",
    service: "Outreach + Web",
    prompt:
      "Review the outreach pipeline and prepare a thoughtful angle for the best conversation.",
    icon: UserRoundSearchIcon,
    tone: "bg-chart-2/10 text-chart-2",
  },
  {
    title: "Organize the Brain",
    description: "Find gaps and useful connections",
    service: "Brain + Cartographer",
    prompt:
      "Map the most important knowledge gaps and connections in the Brain.",
    icon: BrainCircuitIcon,
    tone: "bg-chart-3/10 text-chart-3",
  },
];

const stageOptions: Array<{ id: PreviewStage; label: string }> = [
  { id: "compose", label: "Compose" },
  { id: "working", label: "Working" },
  { id: "approval", label: "Approval" },
  { id: "complete", label: "Complete" },
];

function selectedOption<T extends string>(
  options: Array<Option<T>>,
  id: T,
): Option<T> {
  return options.find((option) => option.id === id) ?? options[0]!;
}

function MenuOption({
  icon: Icon,
  label,
  description,
}: {
  icon: typeof SearchIcon;
  label: string;
  description: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-0.5 pl-5.5 text-[10px] leading-4 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function ControlButton({
  icon: Icon,
  value,
  label,
  emphasized,
}: {
  icon: typeof SearchIcon;
  value: string;
  label: string;
  emphasized?: boolean;
}) {
  return (
    <Button
      className={cn(
        "h-8 gap-1.5 px-2 text-xs",
        emphasized && "bg-primary/10 text-primary hover:bg-primary/15",
      )}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon className="size-3.5" />
      <span className="sr-only">{label}</span>
      <span className="max-w-28 truncate">{value}</span>
      <ChevronDownIcon className="size-3 text-muted-foreground" />
    </Button>
  );
}

function ContextPicker({
  selected,
  onToggle,
}: {
  selected: ContextId[];
  onToggle: (id: ContextId) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 gap-1.5 px-2 text-xs"
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon className="size-3.5" />
          Add
          {selected.length > 0 && (
            <Badge className="ml-0.5 px-1.5 py-0 text-[9px]" variant="secondary">
              {selected.length}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          <p className="text-xs">Add context</p>
          <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
            Taicho will use this context for the next request.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {contextOptions.map((option) => (
          <DropdownMenuCheckboxItem
            checked={selected.includes(option.id)}
            className="items-start py-2"
            key={option.id}
            onCheckedChange={() => onToggle(option.id)}
          >
            <MenuOption {...option} />
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourcePicker({
  selected,
  onChange,
}: {
  selected: SourceId[];
  onChange: (sources: SourceId[]) => void;
}) {
  const auto = selected.includes("auto");
  const label = auto
    ? "Auto sources"
    : selected.length === 1
      ? sourceOptions.find((option) => option.id === selected[0])?.label ??
        "Sources"
      : `${selected.length} sources`;

  function toggle(id: SourceId) {
    const next = selected.includes(id)
      ? selected.filter((source) => source !== id)
      : [...selected.filter((source) => source !== "auto"), id];
    onChange(next.length > 0 ? next : ["auto"]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span>
          <ControlButton icon={SearchIcon} label="Sources" value={label} />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>
          <p className="text-xs">Sources and services</p>
          <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
            Auto uses only connected and permitted services.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={auto}
          className="items-start py-2"
          onCheckedChange={() => onChange(["auto"])}
        >
          <MenuOption
            description="Let Taicho choose the smallest useful toolset"
            icon={SparklesIcon}
            label="Auto"
          />
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {sourceOptions.map((option) => (
          <DropdownMenuCheckboxItem
            checked={
              option.available !== false &&
              !auto &&
              selected.includes(option.id)
            }
            className="items-start py-2"
            disabled={option.available === false}
            key={option.label}
            onCheckedChange={() => toggle(option.id)}
          >
            <div className="min-w-0 flex-1">
              <MenuOption {...option} />
              {option.reason && (
                <Badge className="ml-5.5 mt-1 text-[9px]" variant="outline">
                  {option.reason}
                </Badge>
              )}
            </div>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DepthPicker({
  value,
  onChange,
}: {
  value: DepthId;
  onChange: (value: DepthId) => void;
}) {
  const current = selectedOption(depthOptions, value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span>
          <ControlButton
            icon={current.icon}
            label="Depth"
            value={current.label}
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          <p className="text-xs">Work depth</p>
          <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
            Controls research breadth and specialist involvement.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(next) => onChange(next as DepthId)}
          value={value}
        >
          {depthOptions.map((option) => (
            <DropdownMenuRadioItem
              className="items-start py-2"
              key={option.id}
              value={option.id}
            >
              <MenuOption {...option} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TeamPicker({
  value,
  onChange,
}: {
  value: TeamId;
  onChange: (value: TeamId) => void;
}) {
  const current = selectedOption(teamOptions, value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span>
          <ControlButton
            icon={current.icon}
            label="Team"
            value={current.label}
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          <p className="text-xs">Team routing</p>
          <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
            Choose who may contribute to the next request.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(next) => onChange(next as TeamId)}
          value={value}
        >
          {teamOptions.map((option) => (
            <DropdownMenuRadioItem
              className="items-start py-2"
              key={option.id}
              value={option.id}
            >
              <MenuOption {...option} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PermissionPicker({
  value,
  onChange,
}: {
  value: PermissionId;
  onChange: (value: PermissionId) => void;
}) {
  const current = selectedOption(permissionOptions, value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span>
          <ControlButton
            emphasized
            icon={current.icon}
            label="Permission"
            value={current.label}
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>
          <p className="text-xs">Approval policy</p>
          <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
            Applies to this conversation. Platform permissions always win.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(next) => onChange(next as PermissionId)}
          value={value}
        >
          {permissionOptions.map((option) => (
            <DropdownMenuRadioItem
              className="items-start py-2"
              key={option.id}
              value={option.id}
            >
              <MenuOption {...option} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <div className="flex items-start gap-2 px-2 py-2 text-[10px] leading-4 text-muted-foreground">
          <LockKeyholeIcon className="mt-0.5 size-3 shrink-0" />
          Destructive actions always require confirmation.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ComposerDeckProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  contexts: ContextId[];
  onContextToggle: (id: ContextId) => void;
  sources: SourceId[];
  onSourcesChange: (sources: SourceId[]) => void;
  depth: DepthId;
  onDepthChange: (depth: DepthId) => void;
  team: TeamId;
  onTeamChange: (team: TeamId) => void;
  permission: PermissionId;
  onPermissionChange: (permission: PermissionId) => void;
  running?: boolean;
  onStop?: () => void;
}

function ComposerDeck({
  prompt,
  onPromptChange,
  onSubmit,
  contexts,
  onContextToggle,
  sources,
  onSourcesChange,
  depth,
  onDepthChange,
  team,
  onTeamChange,
  permission,
  onPermissionChange,
  running,
  onStop,
}: ComposerDeckProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!running && prompt.trim()) onSubmit();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (!running && prompt.trim()) onSubmit();
  }

  return (
    <form className="w-full" onSubmit={submit}>
      <InputGroup className="overflow-visible rounded-2xl border-primary/30 bg-card shadow-lg shadow-primary/5">
        {contexts.length > 0 && (
          <InputGroupAddon
            align="block-start"
            className="flex-wrap gap-1.5 border-b px-3 py-2.5"
          >
            {contexts.map((id) => {
              const option = contextOptions.find((item) => item.id === id)!;
              const Icon = option.icon;
              return (
                <Badge
                  className="gap-1 py-1 pr-1"
                  key={id}
                  variant="secondary"
                >
                  <Icon className="size-3" />
                  {option.label}
                  <button
                    aria-label={`Remove ${option.label} context`}
                    className="ml-0.5 rounded-sm p-0.5 hover:bg-background/70"
                    onClick={() => onContextToggle(id)}
                    type="button"
                  >
                    <XIcon className="size-2.5" />
                  </button>
                </Badge>
              );
            })}
          </InputGroupAddon>
        )}

        <InputGroupTextarea
          aria-label="Ask Taicho"
          className="max-h-72 min-h-32 px-4 py-4 text-base"
          disabled={running}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={keyDown}
          placeholder="Ask Taicho anything…"
          rows={4}
          value={prompt}
        />

        <InputGroupAddon
          align="block-end"
          className="items-end gap-2 border-t px-2 py-2"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            <ContextPicker onToggle={onContextToggle} selected={contexts} />
            <SourcePicker onChange={onSourcesChange} selected={sources} />
            <DepthPicker onChange={onDepthChange} value={depth} />
            <TeamPicker onChange={onTeamChange} value={team} />
            <PermissionPicker
              onChange={onPermissionChange}
              value={permission}
            />
          </div>

          {running ? (
            <InputGroupButton
              aria-label="Stop all work"
              className="shrink-0 rounded-full"
              onClick={onStop}
              size="icon-sm"
              type="button"
              variant="default"
            >
              <CircleStopIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              aria-label="Send prompt"
              className="shrink-0 rounded-full"
              disabled={!prompt.trim()}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function StarterCards({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {starters.map((starter) => {
        const Icon = starter.icon;
        return (
          <button
            className="group flex min-h-24 items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/5 hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            key={starter.title}
            onClick={() => onSelect(starter.prompt)}
            type="button"
          >
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl",
                starter.tone,
              )}
            >
              <Icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{starter.title}</span>
                <Badge className="hidden text-[9px] lg:inline-flex" variant="outline">
                  {starter.service}
                </Badge>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {starter.description}
              </span>
            </span>
            <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        );
      })}
    </div>
  );
}

function UserRequest({ prompt }: { prompt: string }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6" data-component="CHAT-03 User Request">
      {prompt}
    </div>
  );
}

function WorkingSurface({
  step,
  team,
  webSkipped,
  onSkipWeb,
  onStop,
  onRedirect,
}: {
  step: number;
  team: TeamId;
  webSkipped: boolean;
  onSkipWeb: () => void;
  onStop: () => void;
  onRedirect: () => void;
}) {
  const specialist =
    team === "taicho"
      ? null
      : team === "auto"
        ? "Scout + Cartographer"
        : selectedOption(teamOptions, team).label;
  const activities = [
    {
      label: "Workspace knowledge",
      detail: "Projects, priorities, and recent activity",
      icon: SearchIcon,
    },
    {
      label: webSkipped ? "Current web skipped" : "Current evidence",
      detail: webSkipped ? "Continuing with workspace sources" : "Fresh signals and citations",
      icon: Globe2Icon,
    },
    {
      label: specialist ? `${specialist} contributing` : "Taicho synthesis",
      detail: specialist ? "Bounded specialist assignments" : "Preparing the answer directly",
      icon: specialist ? UsersRoundIcon : BotIcon,
    },
  ];

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <SparklesIcon className="size-4" />
        </span>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
            Plan the highest-value work
          </p>
          <p className="mt-1 text-sm leading-6">
            I’ll combine the workspace context with the smallest useful team.
          </p>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden border-primary/20 bg-card/70 py-0">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <span className="relative grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <WorkflowIcon className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Working across your context</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Meaningful activity only · private reasoning stays private
            </p>
          </div>
          <Badge variant="secondary">Live</Badge>
        </div>
        <CardContent className="space-y-1 p-3">
          {activities.map((activity, index) => {
            const active = index === Math.min(step, activities.length - 1);
            const complete = index < step;
            const Icon = activity.icon;
            return (
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
                  active && "bg-primary/5",
                )}
                key={activity.label}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border",
                    complete &&
                      "border-primary/25 bg-primary/10 text-primary",
                    active &&
                      "border-primary/40 bg-primary/10 text-primary",
                  )}
                >
                  {complete ? (
                    <CheckIcon className="size-3.5" />
                  ) : active ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Icon className="size-3.5 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{activity.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {activity.detail}
                  </p>
                </div>
                <span className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                  {complete ? "complete" : active ? "running" : "queued"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onStop} size="sm" type="button" variant="outline">
          <CircleStopIcon className="size-3.5" />
          Stop all
        </Button>
        <Button
          disabled={webSkipped}
          onClick={onSkipWeb}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Globe2Icon className="size-3.5" />
          {webSkipped ? "Web skipped" : "Skip web"}
        </Button>
        <Button onClick={onRedirect} size="sm" type="button" variant="ghost">
          <PencilLineIcon className="size-3.5" />
          Change direction
        </Button>
      </div>
    </div>
  );
}

function ApprovalSurface({
  permission,
  onApprove,
  onDecline,
  onEdit,
}: {
  permission: PermissionId;
  onApprove: () => void;
  onDecline: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-primary" />
        Research and planning complete
      </div>
      <Card className="gap-0 overflow-hidden border-primary/25 bg-primary/5 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-primary/15 px-4 py-3">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Create today’s operating plan?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              3 assignments · Workspace tasks · visible to the squad
            </p>
          </div>
          <Badge variant="outline">
            {selectedOption(permissionOptions, permission).label}
          </Badge>
        </div>
        <CardContent className="space-y-3 p-4">
          {[
            ["Scout", "Verify the two highest-value outreach opportunities"],
            ["Muse", "Develop the strongest content angle from current research"],
            ["Taicho", "Review the automation exception before noon"],
          ].map(([owner, action]) => (
            <div
              className="flex items-start gap-3 rounded-lg border bg-background/60 px-3 py-2.5"
              key={owner}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-[10px] font-semibold text-primary">
                {owner.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {owner}
                </p>
                <p className="mt-0.5 text-xs">{action}</p>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button onClick={onApprove} size="sm" type="button">
              <CheckIcon className="size-3.5" />
              Approve plan
            </Button>
            <Button onClick={onEdit} size="sm" type="button" variant="outline">
              <PencilLineIcon className="size-3.5" />
              Edit
            </Button>
            <Button onClick={onDecline} size="sm" type="button" variant="ghost">
              Decline
            </Button>
            <p className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <LockKeyholeIcon className="size-3" />
              Exact preview before execution
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CompleteSurface({
  stopped,
  onReset,
}: {
  stopped: boolean;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          {stopped ? (
            <CircleStopIcon className="size-4" />
          ) : (
            <CheckIcon className="size-4" />
          )}
        </span>
        <div>
          <p className="text-sm font-semibold">
            {stopped ? "Work stopped safely" : "Today’s plan is ready"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {stopped
              ? "Completed evidence was retained. Nothing was changed in the workspace."
              : "Three priorities are ordered, owners are clear, and the first two assignments are ready."}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ["3", "priorities", WorkflowIcon],
          ["8", "records read", SearchIcon],
          ["2", "specialists", UsersRoundIcon],
        ].map(([value, label, Icon]) => (
          <div className="rounded-xl border bg-card p-3" key={String(label)}>
            <Icon className="size-3.5 text-primary" />
            <p className="mt-3 text-xl font-semibold tabular-nums">{String(value)}</p>
            <p className="text-[10px] text-muted-foreground">{String(label)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {!stopped && (
          <>
            <Button size="sm" type="button">
              <WorkflowIcon className="size-3.5" />
              Open plan
            </Button>
            <Button size="sm" type="button" variant="outline">
              <SparklesIcon className="size-3.5" />
              Start first task
            </Button>
          </>
        )}
        <Button onClick={onReset} size="sm" type="button" variant="ghost">
          <RotateCcwIcon className="size-3.5" />
          New request
        </Button>
      </div>
    </div>
  );
}

export function ControlDeckPrototype() {
  const [stage, setStage] = useState<PreviewStage>("compose");
  const [prompt, setPrompt] = useState("");
  const [activePrompt, setActivePrompt] = useState(
    "Review the workspace and help me choose the most valuable work to move forward today.",
  );
  const [contexts, setContexts] = useState<ContextId[]>([]);
  const [sources, setSources] = useState<SourceId[]>(["auto"]);
  const [depth, setDepth] = useState<DepthId>("balanced");
  const [team, setTeam] = useState<TeamId>("auto");
  const [permission, setPermission] = useState<PermissionId>("allow-all");
  const [workStep, setWorkStep] = useState(0);
  const [webSkipped, setWebSkipped] = useState(false);
  const [stopped, setStopped] = useState(false);
  const autoRunRef = useRef(false);

  useEffect(() => {
    if (stage !== "working" || !autoRunRef.current) return;
    const stepOne = window.setTimeout(() => setWorkStep(1), 700);
    const stepTwo = window.setTimeout(() => setWorkStep(2), 1_500);
    const finish = window.setTimeout(() => {
      autoRunRef.current = false;
      setStage(
        permission === "ask" || permission === "workspace-edits"
          ? "approval"
          : "complete",
      );
    }, 2_800);
    return () => {
      window.clearTimeout(stepOne);
      window.clearTimeout(stepTwo);
      window.clearTimeout(finish);
    };
  }, [permission, stage]);

  function toggleContext(id: ContextId) {
    setContexts((current) =>
      current.includes(id)
        ? current.filter((context) => context !== id)
        : [...current, id],
    );
  }

  function run(nextPrompt = prompt) {
    const value = nextPrompt.trim();
    if (!value) return;
    setPrompt(value);
    setActivePrompt(value);
    setStopped(false);
    setWebSkipped(false);
    setWorkStep(0);
    autoRunRef.current = true;
    setStage("working");
  }

  function reset() {
    autoRunRef.current = false;
    setPrompt("");
    setStopped(false);
    setWorkStep(0);
    setStage("compose");
  }

  function stop() {
    autoRunRef.current = false;
    setStopped(true);
    setStage("complete");
  }

  function preview(next: PreviewStage) {
    autoRunRef.current = false;
    setStopped(false);
    setWorkStep(next === "working" ? 1 : 2);
    setStage(next);
  }

  return (
    <div className="space-y-3" data-component="CHAT-08 Control Deck Prototype">
      <div className="flex flex-col gap-3 rounded-xl border bg-muted/15 p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Interactive prototype state</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Use the controls or jump between states for review.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-lg border bg-background p-1">
          {stageOptions.map((option) => (
            <Button
              className="h-7 px-2 text-[10px]"
              key={option.id}
              onClick={() => preview(option.id)}
              size="sm"
              type="button"
              variant={stage === option.id ? "default" : "ghost"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative min-h-[720px] overflow-hidden rounded-3xl border bg-background shadow-2xl shadow-primary/5">
        <div className="pointer-events-none absolute left-1/2 top-0 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-primary/7 blur-3xl" />

        <header className="relative flex min-h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-5">
          <span className="relative grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <BotIcon className="size-4.5" />
            <i className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-background bg-primary" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Taicho</p>
              <Badge className="hidden sm:inline-flex" variant="outline">
                Control deck
              </Badge>
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              Workspace tools · coordinated specialists · visible permissions
            </p>
          </div>
          <div className="ml-auto hidden items-center gap-1.5 md:flex">
            <Badge variant="secondary">
              {selectedOption(depthOptions, depth).label}
            </Badge>
            <Badge variant="secondary">
              {selectedOption(teamOptions, team).label}
            </Badge>
            <Badge className="gap-1" variant="outline">
              <ShieldCheckIcon className="size-3" />
              {selectedOption(permissionOptions, permission).label}
            </Badge>
          </div>
          <Button
            aria-label="Reset prototype"
            className="ml-auto md:ml-1"
            onClick={reset}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </header>

        <div className="relative flex min-h-[655px] flex-col px-3 sm:px-6">
          {stage === "compose" ? (
            <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-10">
              <Badge className="gap-1.5" variant="secondary">
                <SparklesIcon className="size-3.5 text-primary" />
                Taicho control deck
              </Badge>
              <h3 className="mt-5 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
                What should we move forward?
              </h3>
              <p className="mt-3 max-w-xl text-center text-sm leading-6 text-muted-foreground">
                Start with an outcome. Shape the scope, depth, team, and
                permissions only when they matter.
              </p>

              <div className="mt-8 w-full max-w-3xl">
                <ComposerDeck
                  contexts={contexts}
                  depth={depth}
                  onContextToggle={toggleContext}
                  onDepthChange={setDepth}
                  onPermissionChange={setPermission}
                  onPromptChange={setPrompt}
                  onSourcesChange={setSources}
                  onSubmit={() => run()}
                  onTeamChange={setTeam}
                  permission={permission}
                  prompt={prompt}
                  sources={sources}
                  team={team}
                />
                <div className="mt-3">
                  <StarterCards onSelect={run} />
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
              <div className="flex-1 space-y-5 py-7 sm:py-10">
                <UserRequest prompt={activePrompt} />

                {stage === "working" && (
                  <WorkingSurface
                    onRedirect={() => {
                      autoRunRef.current = false;
                      setPrompt(activePrompt);
                      setStage("compose");
                    }}
                    onSkipWeb={() => setWebSkipped(true)}
                    onStop={stop}
                    step={workStep}
                    team={team}
                    webSkipped={webSkipped}
                  />
                )}

                {stage === "approval" && (
                  <ApprovalSurface
                    onApprove={() => setStage("complete")}
                    onDecline={() => {
                      setStopped(true);
                      setStage("complete");
                    }}
                    onEdit={() => {
                      setPrompt(activePrompt);
                      setStage("compose");
                    }}
                    permission={permission}
                  />
                )}

                {stage === "complete" && (
                  <CompleteSurface onReset={reset} stopped={stopped} />
                )}
              </div>

              <div className="sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent pb-4 pt-6">
                <ComposerDeck
                  contexts={contexts}
                  depth={depth}
                  onContextToggle={toggleContext}
                  onDepthChange={setDepth}
                  onPermissionChange={setPermission}
                  onPromptChange={setPrompt}
                  onSourcesChange={setSources}
                  onStop={stop}
                  onSubmit={() => run()}
                  onTeamChange={setTeam}
                  permission={permission}
                  prompt={prompt}
                  running={stage === "working"}
                  sources={sources}
                  team={team}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
