"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ChevronDown,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { OutreachMessage, OutreachMedium } from "@/products/outreach/domain/types";
import { OUTREACH_MEDIUM_CONFIG, OUTREACH_STATUS_CONFIG } from "@/products/outreach/domain/types";
import { formatOutreachContent } from "@/products/outreach/domain/outreach-format";

interface OutreachHistoryProps {
  messages: OutreachMessage[];
  isLoading: boolean;
  isGenerating: boolean;
  prospectName: string;
  onGenerate: (medium: OutreachMedium) => void;
  onOpenCommentDialog: () => void;
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
  isGenerating,
  prospectName,
  onGenerate,
  onOpenCommentDialog,
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

  const draftAction = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Draft outreach" disabled={isGenerating} size="sm" variant="secondary">
          {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {isGenerating ? "Drafting…" : "Draft outreach"}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={() => onGenerate("inmail")}>
          <Sparkles className="mr-2 size-4" />
          <div>
            <div className="font-medium">Personalized InMail</div>
            <div className="text-xs text-muted-foreground">Custom report and deep research</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onGenerate("inmail_traditional")}>
          <Linkedin className="mr-2 size-4" />
          <div>
            <div className="font-medium">Traditional InMail</div>
            <div className="text-xs text-muted-foreground">A shorter LinkedIn message</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onGenerate("email")}>
          <Mail className="mr-2 size-4" />
          <div>
            <div className="font-medium">Email</div>
            <div className="text-xs text-muted-foreground">Customer-first cold email</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenCommentDialog}>
          <MessageSquare className="mr-2 size-4" />
          <div>
            <div className="font-medium">Content comment</div>
            <div className="text-xs text-muted-foreground">Respond to a post or article</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (isLoading) {
    return (
      <ListCard
        actions={draftAction}
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
        actions={draftAction}
        description="Copy prepared here; delivery happens in your external channel."
        title="Outreach drafts"
      >
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No outreach drafts yet. Choose a format to create the first draft.
          </p>
      </ListCard>
    );
  }

  return (
    <ListCard
      actions={draftAction}
      description={`${messages.length} message${messages.length !== 1 ? "s" : ""}`}
      title="Outreach drafts"
    >
      <ListRows>
        {messages.map((message) => {
          const Icon = MEDIUM_ICONS[message.medium];
          const mediumConfig = OUTREACH_MEDIUM_CONFIG[message.medium];
          const statusConfig = OUTREACH_STATUS_CONFIG[message.status];
          const displayContent = message.status === "draft"
            ? formatOutreachContent(message.content, prospectName, message.medium)
            : message.content;

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
                    void navigator.clipboard.writeText(displayContent);
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
              className="items-start scroll-mt-24 target:bg-primary/10 target:ring-2 target:ring-inset target:ring-primary/30"
              id={`outreach-${message.id}`}
              key={message.id}
              detail={(
                <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                  {displayContent}
                </p>
              )}
              leading={
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
              }
              meta={[
                mediumConfig.label,
                formatDate(message.createdAt),
                message.promptVersion ? `Prompt v${message.promptVersion}` : null,
                message.targetContent
                  ? `Commenting on: ${message.targetContent}`
                  : null,
              ].filter(Boolean)}
              title={message.subject || `${mediumConfig.label} message`}
            />
          );
        })}
      </ListRows>
    </ListCard>
  );
}
