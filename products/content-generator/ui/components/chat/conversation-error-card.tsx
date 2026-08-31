"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatConversationError } from "@/components/chat/chat-runtime-provider";

export function ChatConversationErrorCard() {
  const {
    conversationError,
    retryConversation,
    retryingConversation,
    startNewConversation,
  } = useChatConversationError();
  if (!conversationError) return null;
  const stopped = conversationError.startsWith('Taicho stopped before completing this response.');
  return (
    <div
      className="mx-auto mb-3 flex w-full max-w-3xl items-start gap-3 rounded-xl border border-destructive/35 bg-destructive/5 p-3 text-sm"
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{stopped ? 'Response stopped' : 'Taicho could not continue this conversation'}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{conversationError}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={retryingConversation}
            onClick={() => void retryConversation()}
            size="sm"
          >
            {retryingConversation ? 'Retrying…' : 'Retry response'}
          </Button>
          {!stopped ? (
            <Button onClick={startNewConversation} size="sm" variant="outline">
              Start a new conversation
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
