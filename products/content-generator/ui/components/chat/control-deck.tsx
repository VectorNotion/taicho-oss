"use client";

import {
  BrainCircuitIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  GaugeIcon,
  Globe2Icon,
  LockKeyholeIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserRoundSearchIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import type {
  ChatContactTarget,
  ChatContext,
  ChatControlAvailability,
  ChatControls,
  ChatDepth,
  ChatPermission,
  ChatSource,
} from "@content-automation/platform/intelligence/chat-controls";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

type ControlOption = {
  value: string;
  label: string;
  description: string;
  icon: typeof SearchIcon;
  disabled?: boolean;
  disabledReason?: string;
};

export type ChatStarterIcon =
  | "plan"
  | "content"
  | "outreach"
  | "brain"
  | "automation"
  | "nurture"
  | "research";

const starterIcons: Record<
  ChatStarterIcon,
  { icon: typeof SearchIcon; tone: string }
> = {
  plan: { icon: WorkflowIcon, tone: "bg-primary/10 text-primary" },
  content: { icon: FilePenLineIcon, tone: "bg-chart-1/10 text-chart-1" },
  outreach: {
    icon: UserRoundSearchIcon,
    tone: "bg-chart-2/10 text-chart-2",
  },
  brain: { icon: BrainCircuitIcon, tone: "bg-chart-3/10 text-chart-3" },
  automation: { icon: ZapIcon, tone: "bg-chart-4/10 text-chart-4" },
  nurture: { icon: WorkflowIcon, tone: "bg-chart-5/10 text-chart-5" },
  research: { icon: SearchIcon, tone: "bg-primary/10 text-primary" },
};

const sourceOptions: ControlOption[] = [
  {
    value: "auto",
    label: "Auto sources",
    description: "Choose the smallest useful connected toolset",
    icon: SparklesIcon,
  },
  {
    value: "workspace",
    label: "Workspace",
    description: "Projects, prospects, research, and history",
    icon: SearchIcon,
  },
  {
    value: "brain",
    label: "Brain",
    description: "Relationships, topics, and knowledge gaps",
    icon: BrainCircuitIcon,
  },
  {
    value: "web",
    label: "Current web",
    description: "Fresh external evidence and sources",
    icon: Globe2Icon,
  },
  {
    value: "funnels",
    label: "Funnels",
    description: "Funnel membership, stages, and next-touch context",
    icon: WorkflowIcon,
  },
];

const depthOptions: ControlOption[] = [
  {
    value: "quick",
    label: "Quick",
    description: "Direct answer with minimal tool use",
    icon: ZapIcon,
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Use the relevant workflow capabilities when useful",
    icon: GaugeIcon,
  },
  {
    value: "deep",
    label: "Deep",
    description: "Broader evidence and deeper workflow execution",
    icon: BrainCircuitIcon,
  },
];

const permissionOptions: ControlOption[] = [
  {
    value: "read-only",
    label: "Read only",
    description: "Search and draft; never change records",
    icon: LockKeyholeIcon,
  },
  {
    value: "ask",
    label: "Ask before acting",
    description: "Propose changes; an allow mode is required to run them",
    icon: MessageSquareTextIcon,
  },
  {
    value: "workspace-edits",
    label: "Allow workspace edits",
    description: "Save notes, drafts, and record updates",
    icon: FilePenLineIcon,
  },
  {
    value: "allow-all",
    label: "Allow All",
    description: "Use every permitted action in this chat",
    icon: ShieldCheckIcon,
  },
];

const contextOptions: Array<{ label: ChatContext; icon: typeof SearchIcon }> = [
  { label: "Projects", icon: WorkflowIcon },
  { label: "Topics", icon: BrainCircuitIcon },
];

function MenuOption({ option }: { option: ControlOption }) {
  const Icon = option.icon;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5" />
        <span className="text-xs font-medium">{option.label}</span>
      </div>
      <p className="mt-0.5 pl-5.5 text-[10px] leading-4 text-muted-foreground">
        {option.description}
      </p>
      {option.disabledReason && (
        <Badge className="ml-5.5 mt-1 text-[9px]" variant="outline">
          {option.disabledReason}
        </Badge>
      )}
    </div>
  );
}

function RadioControl({
  ariaLabel,
  icon: Icon,
  value,
  options,
  onValueChange,
  emphasized,
}: {
  ariaLabel: string;
  icon: typeof SearchIcon;
  value: string;
  options: ControlOption[];
  onValueChange: (value: string) => void;
  emphasized?: boolean;
}) {
  const current = options.find((option) => option.value === value) ?? options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`${ariaLabel}: ${current.label}`}
          className={cn(
            "h-8 gap-1.5 px-2 text-xs",
            emphasized &&
              "bg-primary/10 text-violet-300 hover:bg-primary/15 hover:text-violet-200",
          )}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icon className="size-3.5" />
          <span className="max-w-28 truncate">{current.label}</span>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          <p className="text-xs">{ariaLabel}</p>
          <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
            Applied to the next request.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup onValueChange={onValueChange} value={value}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              className="items-start py-2"
              disabled={option.disabled}
              key={option.value}
              value={option.value}
            >
              <MenuOption option={option} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {ariaLabel === "Permission" && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-start gap-2 px-2 py-2 text-[10px] leading-4 text-muted-foreground">
              <LockKeyholeIcon className="mt-0.5 size-3 shrink-0" />
              Platform permissions and destructive-action safeguards always
              apply.
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ComposerControlDock({
  availability,
  className,
  contactTargets,
  contactLocked = false,
  controls,
  disabled,
  onControlsChange,
}: {
  availability: ChatControlAvailability;
  className?: string;
  contactTargets?: ChatContactTarget[];
  contactLocked?: boolean;
  controls: ChatControls;
  disabled?: boolean;
  onControlsChange: (controls: ChatControls) => void;
}) {
  function toggleContext(label: ChatContext) {
    onControlsChange({
      ...controls,
      contexts: controls.contexts.includes(label)
        ? controls.contexts.filter((item) => item !== label)
        : [...controls.contexts, label],
    });
  }

  return (
    <fieldset
      className={cn(
        "flex min-w-0 flex-1 flex-wrap items-center gap-0.5",
        className,
      )}
      data-chat-controls="operational"
      disabled={disabled}
    >
      <legend className="sr-only">Chat controls</legend>
      {availability.contacts && contactTargets !== undefined && contactLocked ? (
        <Badge
          aria-label={`Pinned contact: ${controls.contact?.label ?? "None"}`}
          className="h-8 max-w-40 gap-1.5 px-2 text-xs font-normal"
          title="This conversation stays in the current prospect context"
          variant="outline"
        >
          <LockKeyholeIcon className="size-3.5" />
          <span className="truncate">{controls.contact?.label ?? "Contact"}</span>
        </Badge>
      ) : availability.contacts && contactTargets !== undefined ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Contact: ${controls.contact?.label ?? "None"}`}
              className="h-8 gap-1.5 px-2 text-xs"
              size="sm"
              type="button"
              variant="ghost"
            >
              <UserRoundSearchIcon className="size-3.5" />
              <span className="max-w-28 truncate">
                {controls.contact?.label ?? "Contact"}
              </span>
              <ChevronDownIcon className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>
              <p className="text-xs">Contact</p>
              <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
                Focus this request on a canonical workspace Contact. Outreach
                target and Nurture subscriber roles remain separate.
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              onValueChange={(id) =>
                onControlsChange({
                  ...controls,
                  contact:
                    contactTargets.find((target) => target.id === id) ?? null,
                })
              }
              value={controls.contact?.id ?? "none"}
            >
              <DropdownMenuRadioItem value="none">
                No contact selected
              </DropdownMenuRadioItem>
              {contactTargets.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Add a workspace Contact to make it available here.
                </div>
              ) : null}
              {contactTargets.map((target) => (
                <DropdownMenuRadioItem
                  className="items-start py-2"
                  key={target.id}
                  value={target.id}
                >
                  <div>
                    <p className="text-xs font-medium">{target.label}</p>
                    {target.detail ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {target.detail}
                      </p>
                    ) : null}
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
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
            {controls.contexts.length > 0 && (
              <Badge className="px-1.5 py-0 text-[9px]" variant="secondary">
                {controls.contexts.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>
            <p className="text-xs">Focus context</p>
            <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">
              Choose workspace context for the next request.
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {contextOptions.map(({ label, icon: Icon }) => (
            <DropdownMenuCheckboxItem
              checked={controls.contexts.includes(label)}
              disabled={!availability.contexts[label as keyof typeof availability.contexts]}
              key={label}
              onCheckedChange={() => toggleContext(label)}
            >
              <Icon className="size-3.5" />
              {label}
              {!availability.contexts[label as keyof typeof availability.contexts] ? (
                <Badge className="ml-auto text-[9px]" variant="outline">
                  Context not enabled
                </Badge>
              ) : null}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <RadioControl
        ariaLabel="Sources"
        icon={SearchIcon}
        onValueChange={(source) =>
          onControlsChange({ ...controls, source: source as ChatSource })
        }
        options={sourceOptions.map((option) => ({
          ...option,
          disabled:
            !availability.sources[
              option.value as keyof typeof availability.sources
            ],
          disabledReason:
            availability.sources[
              option.value as keyof typeof availability.sources
            ]
              ? undefined
              : "Source not enabled",
        }))}
        value={controls.source}
      />
      <RadioControl
        ariaLabel="Depth"
        icon={GaugeIcon}
        onValueChange={(depth) =>
          onControlsChange({ ...controls, depth: depth as ChatDepth })
        }
        options={depthOptions}
        value={controls.depth}
      />
      <RadioControl
        ariaLabel="Permission"
        emphasized
        icon={ShieldCheckIcon}
        onValueChange={(permission) =>
          onControlsChange({
            ...controls,
            permission: permission as ChatPermission,
          })
        }
        options={permissionOptions.map((option) => ({
          ...option,
          disabled:
            !availability.permissions[
              option.value as keyof typeof availability.permissions
            ],
          disabledReason:
            availability.permissions[
              option.value as keyof typeof availability.permissions
            ]
              ? undefined
              : "Not permitted by your role",
        }))}
        value={controls.permission}
      />
    </fieldset>
  );
}

export function ChatStarterVisual({
  icon,
  title,
  description,
  service,
  showService = true,
}: {
  icon: ChatStarterIcon;
  title: string;
  description?: string;
  service?: string;
  showService?: boolean;
}) {
  const config = starterIcons[icon];
  const Icon = config.icon;
  return (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          config.tone,
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium leading-5">{title}</span>
          {service && showService && (
            <Badge className="hidden text-[9px] xl:inline-flex" variant="outline">
              {service}
            </Badge>
          )}
        </span>
        {description && (
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </>
  );
}
