"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { cn } from "../lib/utils";

/**
 * The §8 stat row: KPI tiles that carry information, not just a number.
 * Each tile is label + value + delta chip (icon + ink, never color alone)
 * + an optional sparkline with an emphasized endpoint. At most one tile
 * per row is `featured` — it takes the resting primary tint.
 *
 * Direction has three states, and "flat" is deliberately quiet: a stat that
 * isn't moving gets muted ink and a muted sparkline — it shouldn't ask for
 * attention. A stat with no `delta` renders no chip at all (no honest
 * comparison period → nothing to claim).
 */
export interface Stat {
  label: string;
  value: string;
  /** Omit when the product has no honest comparison period. */
  delta?: string;
  /** Movement sentiment: "up" positive, "down" negative, "flat" unchanged. */
  direction?: "up" | "down" | "flat";
  /** @deprecated use `direction`. Kept for existing call sites. */
  up?: boolean;
  /** Supporting context for totals that do not have a comparison period. */
  description?: React.ReactNode;
  /** Optional compact supporting visualization, such as a quota progress bar. */
  footer?: React.ReactNode;
  /** 6–10 points of recent history. */
  trend?: number[];
  featured?: boolean;
}

const TONE = {
  up: { ink: "text-chart-2", stroke: "var(--chart-2)", icon: TrendingUp },
  down: { ink: "text-destructive", stroke: "var(--destructive)", icon: TrendingDown },
  flat: { ink: "text-muted-foreground", stroke: "var(--muted-foreground)", icon: Minus },
} as const;

function resolveDirection(stat: Stat): "up" | "down" | "flat" {
  if (stat.direction) return stat.direction;
  if (stat.up === undefined) return "flat";
  return stat.up ? "up" : "down";
}

function Sparkline({ points, direction }: { points: number[]; direction: "up" | "down" | "flat" }) {
  const data = points.map((value, index) => ({ index, value }));
  const { stroke } = TONE[direction];
  const id = `spark-${direction}-${points.join("-")}`;
  const last = points.length - 1;
  return (
    <div aria-hidden className="h-10 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={direction === "flat" ? 0.15 : 0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            dataKey="value"
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === last ? (
                <circle cx={props.cx} cy={props.cy} fill={stroke} key="end" r={2.5} stroke="var(--card)" strokeWidth={1.5} />
              ) : (
                <g key={props.index} />
              )
            }
            fill={`url(#${id})`}
            isAnimationActive={false}
            stroke={stroke}
            strokeOpacity={direction === "flat" ? 0.6 : 1}
            strokeWidth={1.5}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatRow({
  stats,
  isLoading = false,
  className,
}: {
  stats: Stat[];
  isLoading?: boolean;
  className?: string;
}) {
  const columns = stats.length === 1
    ? "grid-cols-1"
    : stats.length === 2
      ? "sm:grid-cols-2"
      : stats.length === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className={cn("grid gap-4", columns, className)}>
      {stats.map((stat, index) => {
        const direction = resolveDirection(stat);
        const tone = TONE[direction];
        const Icon = tone.icon;
        return (
          <Card
            className={`animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none ${stat.featured ? "border-primary/25 bg-primary/5" : ""}`}
            key={stat.label}
            style={{ animationDelay: `${index * 75}ms`, animationFillMode: "both" }}
          >
            <CardContent className="p-6 pb-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              {isLoading ? (
                <Skeleton className="mt-2 h-9 w-20" />
              ) : (
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <p className="text-3xl font-bold tabular-nums">{stat.value}</p>
                  {stat.delta ? (
                    <span className={`flex items-center gap-1 text-xs tabular-nums ${tone.ink}`}>
                      <Icon className="size-3.5" />
                      {stat.delta}
                    </span>
                  ) : null}
                </div>
              )}
              {!isLoading && stat.description ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {stat.description}
                </p>
              ) : null}
              {!isLoading && stat.trend && (
                <div className="mt-3">
                  <Sparkline direction={direction} points={stat.trend} />
                </div>
              )}
              {!isLoading && stat.footer ? (
                <div className="mt-3">{stat.footer}</div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
