"use client";

import {
  BotIcon,
  ChevronDownIcon,
  ImageIcon,
  SparklesIcon,
  VideoIcon,
  ZapIcon,
} from "lucide-react";
import {
  AUTO_MODEL_KEY,
  getModelDefinition,
  listModelOptions,
  type ModelCapability,
  type PublicModelDefinition,
  type ModelSelectionKey,
  type ModelSurface,
} from "@content-automation/platform/models/catalog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "../lib/utils";

function ModelIcon({
  kind,
  className,
}: {
  kind: PublicModelDefinition["kind"] | "auto";
  className?: string;
}) {
  const Icon = kind === "image"
    ? ImageIcon
    : kind === "video"
      ? VideoIcon
      : kind === "auto"
        ? SparklesIcon
        : BotIcon;
  return <Icon className={className} />;
}

function costLabel(multiplier: number) {
  return `${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}× credits`;
}

export function ModelPicker({
  allowedModelKeys,
  className,
  compact = false,
  disabled,
  includeAuto = true,
  models,
  onValueChange,
  requiredCapabilities,
  surface,
  value,
}: {
  allowedModelKeys?: readonly string[];
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  includeAuto?: boolean;
  models: readonly PublicModelDefinition[];
  onValueChange: (value: ModelSelectionKey) => void;
  requiredCapabilities?: readonly ModelCapability[];
  surface: ModelSurface;
  value: ModelSelectionKey;
}) {
  const options = listModelOptions(models, {
    surface,
    requiredCapabilities,
    allowedModelKeys,
  });
  const selected = value === AUTO_MODEL_KEY
    ? null
    : getModelDefinition(models, value);
  const unavailable = value !== AUTO_MODEL_KEY && !selected;
  const currentLabel = unavailable ? "Model unavailable" : selected?.name ?? "Auto";
  const currentKind = unavailable ? "language" : selected?.kind ?? "auto";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Model: ${currentLabel}`}
          className={cn(
            "gap-1.5",
            compact ? "h-8 px-2 text-xs" : "h-10 justify-between px-3",
            className,
          )}
          disabled={disabled}
          size={compact ? "sm" : "default"}
          type="button"
          variant={compact ? "ghost" : "outline"}
        >
          <ModelIcon className="size-3.5" kind={currentKind} />
          <span className={cn("truncate", compact ? "max-w-28" : "max-w-52")}>
            {currentLabel}
          </span>
          {selected?.recommended && compact ? (
            <span className="size-1.5 rounded-full bg-emerald-400" />
          ) : null}
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>
          <p className="text-xs">Model</p>
          <p className="mt-0.5 text-[10px] font-normal leading-4 text-muted-foreground">
            Only models compatible with this action are shown.
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(next) =>
            onValueChange(next as ModelSelectionKey)
          }
          value={value}
        >
          {includeAuto ? (
            <DropdownMenuRadioItem
              className="items-start py-2.5"
              value={AUTO_MODEL_KEY}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SparklesIcon className="size-3.5 text-primary" />
                  <span className="text-xs font-medium">Auto</span>
                  <Badge className="text-[9px]" variant="tint">
                    Recommended
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Uses the workspace default and an approved fallback if needed.
                </p>
              </div>
            </DropdownMenuRadioItem>
          ) : null}
          {includeAuto ? <DropdownMenuSeparator /> : null}
          {options.map((model) => (
            <DropdownMenuRadioItem
              className="items-start py-2.5"
              key={model.key}
              value={model.key}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <ModelIcon
                    className="size-3.5 text-muted-foreground"
                    kind={model.kind}
                  />
                  <span className="truncate text-xs font-medium">
                    {model.name}
                  </span>
                  {model.status === "preview" ? (
                    <Badge className="text-[9px]" variant="outline">
                      Preview
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  {model.description}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge className="text-[9px]" variant="secondary">
                    {model.family}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                    <ZapIcon className="size-2.5" />
                    {model.speed}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {costLabel(model.creditMultiplier)}
                  </span>
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {options.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No enabled model supports this action.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
