"use client";

import { useRef, useEffect } from "react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import type { ChatControls } from "@content-automation/platform/intelligence/chat-controls";

interface ChatRuntimeProviderProps {
  children: React.ReactNode;
  controls: ChatControls;
  threadId?: string;
  resourceId: string;
  initialMessages?: UIMessage[];
  initialPrompt?: string;
  initialPromptPath?: string | null;
  onThreadCreated?: (firstMessage: string) => Promise<string | undefined>;
  refreshThreadList?: () => void;
}

export function ChatRuntimeProvider({
  children,
  controls,
  threadId,
  resourceId,
  initialMessages = [],
  initialPrompt,
  initialPromptPath = "/chat",
  onThreadCreated,
  refreshThreadList,
}: ChatRuntimeProviderProps) {
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const initialMessagesRef = useRef(initialMessages);
  const initialPromptSentRef = useRef(false);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const chatHelpers = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      async prepareSendMessagesRequest({ messages }) {
        if (!threadIdRef.current && onThreadCreated) {
          const lastMessage = messages.at(-1);
          const firstMessage = lastMessage?.parts
            ?.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join(" ")
            .trim() || "New conversation";
          threadIdRef.current = await onThreadCreated(firstMessage);
        }
        return {
          body: {
            controls: controlsRef.current,
            messages,
            memory: threadIdRef.current
              ? { thread: threadIdRef.current, resource: resourceId }
              : undefined,
          },
        };
      },
    }),
  });
  const { sendMessage, setMessages, status } = chatHelpers;

  useEffect(() => {
    if (status === "ready" && threadIdRef.current) {
      refreshThreadList?.();
    }
  }, [refreshThreadList, status]);

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (
      !prompt ||
      initialPromptSentRef.current ||
      status !== "ready"
    ) {
      return;
    }
    initialPromptSentRef.current = true;
    if (initialPromptPath) {
      window.history.replaceState(
        window.history.state,
        "",
        initialPromptPath,
      );
    }
    void sendMessage({ text: prompt });
  }, [initialPrompt, initialPromptPath, sendMessage, status]);

  // Set initial messages on mount or when they change
  useEffect(() => {
    // Only set messages if initialMessages actually changed
    if (JSON.stringify(initialMessagesRef.current) !== JSON.stringify(initialMessages)) {
      initialMessagesRef.current = initialMessages;
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  // Set messages on first render if provided
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runtime = useAISDKRuntime(chatHelpers);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
