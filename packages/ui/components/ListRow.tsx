"use client";

import { Fragment } from "react";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

export interface ListRowAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Serializable icon key for actions created by a Server Component. */
  iconName?: "arrow-right";
  onSelect?: () => void;
  href?: string;
  external?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

/** How many actions render as inline buttons before the rest fold into ⋯. */
const INLINE_ACTIONS = 2;

/**
 * The §8 list-surface row group: rows divided by hairlines inside a ListCard.
 */
export function ListRows({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("divide-y", className)} {...props} />;
}

/**
 * The §8 list-surface row. Owns the minimal record anatomy:
 * - identity line: title (link when `href` is given) + optional status badge
 * - meta line UNDER the title: everything measurable — counts, type,
 *   timestamps — dot-separated, never spread across table columns
 * - actions right-aligned as tinted icon-only buttons (label lives in the
 *   tooltip and aria-label): 1–2 render inline; 3+ keep the first inline and
 *   fold the rest into a ⋯ menu (destructive actions last)
 */
export function ListRow({
  id,
  title,
  href,
  external = false,
  badge,
  meta = [],
  leading,
  actions = [],
  className,
}: {
  id?: string;
  title: React.ReactNode;
  href?: string;
  external?: boolean;
  badge?: React.ReactNode;
  meta?: React.ReactNode[];
  leading?: React.ReactNode;
  actions?: ListRowAction[];
  className?: string;
}) {
  const orderedActions = [
    ...actions.filter((action) => !action.destructive),
    ...actions.filter((action) => action.destructive),
  ];
  const inline = orderedActions.length <= INLINE_ACTIONS
    ? orderedActions
    : orderedActions.slice(0, 1);
  const overflow = orderedActions.length <= INLINE_ACTIONS
    ? []
    : orderedActions.slice(1);

  return (
    <li className={cn("flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-accent", className)} id={id}>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <a
              className="rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              href={href}
              rel={external ? "noopener noreferrer" : undefined}
              target={external ? "_blank" : undefined}
            >
              {title}
            </a>
          ) : (
            <span className="text-sm font-medium">{title}</span>
          )}
          {badge}
        </div>
        {meta.length > 0 && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {meta.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                <span className="flex items-center gap-1 tabular-nums">{part}</span>
              </Fragment>
            ))}
          </p>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5">
          {inline.map((action) => {
            const Icon = action.iconName === "arrow-right"
              ? ArrowRight
              : action.icon;
            const content = Icon
              ? <Icon className="h-4 w-4" />
              : <span className="px-1 text-xs">{action.label}</span>;
            return (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={action.label}
                    asChild={Boolean(action.href)}
                    className={
                      action.destructive
                        ? "bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                        : "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                    }
                    onClick={action.onSelect}
                    disabled={action.disabled}
                    size="icon-sm"
                    variant="ghost"
                  >
                    {action.href ? (
                      <a
                        href={action.href}
                        rel={action.external ? "noopener noreferrer" : undefined}
                        target={action.external ? "_blank" : undefined}
                      >
                        {content}
                      </a>
                    ) : content}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{action.label}</TooltipContent>
              </Tooltip>
            );
          })}
          {overflow.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="More actions"
                  className="bg-secondary/60 text-muted-foreground hover:text-foreground"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflow.map((action) => {
                  const Icon = action.iconName === "arrow-right"
                    ? ArrowRight
                    : action.icon;
                  const content = (
                    <>
                      {Icon && <Icon className="h-4 w-4" />} {action.label}
                    </>
                  );
                  return action.href ? (
                    <DropdownMenuItem asChild key={action.label} variant={action.destructive ? "destructive" : "default"}>
                      <a
                        href={action.href}
                        rel={action.external ? "noopener noreferrer" : undefined}
                        target={action.external ? "_blank" : undefined}
                      >
                        {content}
                      </a>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      key={action.label}
                      disabled={action.disabled}
                      onSelect={action.onSelect}
                      variant={action.destructive ? "destructive" : "default"}
                    >
                      {content}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </li>
  );
}
