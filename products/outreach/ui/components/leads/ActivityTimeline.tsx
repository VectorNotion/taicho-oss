"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import {
  Mail,
  Phone,
  MessageSquare,
  Eye,
  Search,
  FileText,
  ArrowRight,
  Plus,
  Calendar,
  GitBranch,
  Pencil,
  Trash2,
} from "lucide-react";
import type { LeadActivity, LeadActivityType } from "@/products/outreach/domain/types";

// This is display normalization, not HTML sanitization: React renders the
// returned value as an escaped text node.
function stripHtml(html: string): string {
  let text = "";
  let insideTag = false;
  for (const character of html) {
    if (character === "<") {
      insideTag = true;
    } else if (character === ">") {
      insideTag = false;
    } else if (!insideTag) {
      text += character;
    }
  }
  return text.trim();
}

// Re-export types for backward compatibility
export type ActivityType = LeadActivityType;
export type Activity = LeadActivity;

interface ActivityTimelineProps {
  activities?: Activity[];
  isLoading?: boolean;
  onAddActivity?: () => void;
  onEditActivity?: (activity: Activity) => void;
  onDeleteActivity?: (activityId: string) => void;
}

export const ACTIVITY_CONFIG: Record<
  ActivityType,
  { icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string; label: string }
> = {
  outreach_sent: { icon: Mail, color: "text-muted-foreground", bgColor: "bg-muted", label: "Outreach sent" },
  reply_received: { icon: MessageSquare, color: "text-chart-2", bgColor: "bg-chart-2/10", label: "Reply received" },
  call: { icon: Phone, color: "text-muted-foreground", bgColor: "bg-muted", label: "Call" },
  meeting: { icon: Calendar, color: "text-muted-foreground", bgColor: "bg-muted", label: "Meeting" },
  observation: { icon: Eye, color: "text-muted-foreground", bgColor: "bg-muted", label: "Observation" },
  enrichment: { icon: Search, color: "text-muted-foreground", bgColor: "bg-muted", label: "Research" },
  nurture_enrolled: { icon: GitBranch, color: "text-chart-2", bgColor: "bg-chart-2/10", label: "Added to funnel" },
  note: { icon: FileText, color: "text-muted-foreground", bgColor: "bg-muted", label: "Note" },
  status_change: { icon: ArrowRight, color: "text-muted-foreground", bgColor: "bg-muted", label: "Status change" },
};

function formatRelativeDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

export function ActivityTimeline({
  activities = [],
  isLoading = false,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
}: ActivityTimelineProps) {
  const hasActivities = activities.length > 0;

  return (
    <ListCard
      actions={
        onAddActivity ? (
          <Button variant="outline" size="sm" onClick={onAddActivity} className="h-7">
            <Plus className="h-3 w-3 mr-1" />
            <span className="text-xs">Add</span>
          </Button>
        ) : null
      }
      description="Calls, observations, research, and status changes."
      title="Activity"
    >
        {isLoading ? (
          <div className="divide-y">
            {[1, 2, 3].map((i) => (
              <div className="flex items-center gap-3 px-6 py-3.5" key={i}>
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : hasActivities ? (
          <ListRows>
            {activities.map((activity) => {
              const config =
                ACTIVITY_CONFIG[activity.type] ?? ACTIVITY_CONFIG.note;
              const Icon = config.icon;
              return (
              <ListRow
                actions={[
                  ...(onEditActivity
                    ? [{
                        icon: Pencil,
                        label: "Edit activity",
                        onSelect: () => onEditActivity(activity),
                      }]
                    : []),
                  ...(activity.metadata?.postUrl
                    ? [{
                        external: true,
                        href: activity.metadata.postUrl,
                        icon: ArrowRight,
                        label: "View post",
                      }]
                    : []),
                  ...(onDeleteActivity
                    ? [{
                        destructive: true,
                        icon: Trash2,
                        label: "Delete activity",
                        onSelect: () => onDeleteActivity(activity.id),
                      }]
                    : []),
                ]}
                key={activity.id}
                leading={
                  <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                }
                meta={[
                  config.label,
                  <time dateTime={activity.createdAt} key="date">
                    {formatRelativeDate(activity.createdAt)}
                  </time>,
                  ...(activity.notes ? [stripHtml(activity.notes)] : []),
                ]}
                title={activity.title}
              />
              );
            })}
          </ListRows>
        ) : (
          <div className="px-6 py-10 text-center text-muted-foreground">
            <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-1">
              Track calls, observations, and interactions here
            </p>
          </div>
        )}
    </ListCard>
  );
}
