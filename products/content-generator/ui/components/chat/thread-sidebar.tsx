"use client";

import { Plus, Trash2, MessageSquare, PanelRightClose, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ChatThread {
  id: string;
  resourceId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

interface ThreadSidebarProps {
  threads: ChatThread[];
  currentThreadId?: string;
  isLoading?: boolean;
  deletingThreadId?: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onDeleteThread: (e: React.MouseEvent, threadId: string) => void;
  onClose?: () => void;
}

export function ThreadSidebar({
  threads,
  currentThreadId,
  isLoading = false,
  deletingThreadId = null,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onClose,
}: ThreadSidebarProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden border-l bg-background">
      <div className="flex items-center justify-between px-3 pt-4 pb-2 shrink-0">
        <h2 className="text-sm font-semibold">Chat History</h2>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="px-3 pb-3 shrink-0">
        <Button
          onClick={onNewThread}
          className="w-full justify-start gap-2"
          variant="outline"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs">Start a new chat to begin</p>
            </div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-colors group",
                  "hover:bg-muted/50",
                  currentThreadId === thread.id && "bg-muted"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {thread.title || "New Chat"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(thread.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
                      "hover:bg-destructive/10 hover:text-destructive"
                    )}
                    onClick={(e) => onDeleteThread(e, thread.id)}
                    disabled={deletingThreadId === thread.id}
                  >
                    {deletingThreadId === thread.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
