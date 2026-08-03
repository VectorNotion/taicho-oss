"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import {
  Linkedin,
  Mail,
  MessageSquare,
  Trash2,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import type { OutreachMessage, OutreachMedium } from "@/products/outreach/domain/types";
import { OUTREACH_MEDIUM_CONFIG, OUTREACH_STATUS_CONFIG } from "@/products/outreach/domain/types";

interface OutreachHistoryProps {
  messages: OutreachMessage[];
  isLoading: boolean;
  onToggleStatus: (message: OutreachMessage) => void;
  onDelete: (messageId: string) => void;
}

const MEDIUM_ICONS: Record<OutreachMedium, React.ComponentType<{ className?: string }>> = {
  inmail: Linkedin,
  inmail_traditional: Linkedin,
  email: Mail,
  content_comment: MessageSquare,
};

export function OutreachHistory({
  messages,
  isLoading,
  onToggleStatus,
  onDelete,
}: OutreachHistoryProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <ListCard
        description="Copy prepared here; delivery happens in your external channel."
        title="Outreach drafts"
      >
        <div className="divide-y">
          {[1, 2].map((i) => (
            <div className="flex items-center gap-3 px-6 py-3.5" key={i}>
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-52 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </ListCard>
    );
  }

  if (messages.length === 0) {
    return (
      <ListCard
        description="Copy prepared here; delivery happens in your external channel."
        title="Outreach drafts"
      >
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No outreach drafts yet. Create one using the buttons above.
          </p>
      </ListCard>
    );
  }

  return (
    <ListCard
      description={`${messages.length} message${messages.length !== 1 ? "s" : ""}`}
      title="Outreach drafts"
    >
      <ListRows>
        {messages.map((message) => {
          const Icon = MEDIUM_ICONS[message.medium];
          const mediumConfig = OUTREACH_MEDIUM_CONFIG[message.medium];
          const statusConfig = OUTREACH_STATUS_CONFIG[message.status];

          return (
            <ListRow
              actions={[
                {
                  icon: Check,
                  label:
                    message.status === "draft"
                      ? "Mark as sent externally"
                      : "Move back to drafts",
                  onSelect: () => onToggleStatus(message),
                },
                {
                  icon: copiedId === message.id ? Check : Copy,
                  label: copiedId === message.id ? "Copied" : "Copy message",
                  onSelect: () => {
                    void navigator.clipboard.writeText(message.content);
                    setCopiedId(message.id);
                    window.setTimeout(() => setCopiedId(null), 2_000);
                  },
                },
                ...(message.landingPageUrl
                  ? [{
                      external: true,
                      href: message.landingPageUrl,
                      icon: ExternalLink,
                      label: "Open landing page",
                    }]
                  : []),
                ...(message.linkedContentUrl
                  ? [{
                      external: true,
                      href: message.linkedContentUrl,
                      icon: ExternalLink,
                      label: "Open related content",
                    }]
                  : []),
                {
                  destructive: true,
                  icon: Trash2,
                  label: "Delete outreach draft",
                  onSelect: () => onDelete(message.id),
                },
              ]}
              badge={<Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>}
              key={message.id}
              leading={
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
              }
              meta={[
                mediumConfig.label,
                formatDate(message.createdAt),
                message.targetContent
                  ? `Commenting on: ${message.targetContent}`
                  : message.content,
              ]}
              title={message.subject || `${mediumConfig.label} message`}
            />
          );
        })}
      </ListRows>
    </ListCard>
  );
}
