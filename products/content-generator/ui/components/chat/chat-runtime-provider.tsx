"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import type { ChatControls } from "@content-automation/platform/intelligence/chat-controls";
import type { ChatThreadScope } from "@content-automation/platform/intelligence/chat-thread-scope";

interface ChatRuntimeProviderProps {
  children: React.ReactNode;
  controls: ChatControls;
  threadId?: string;
  scope: ChatThreadScope;
  initialMessages?: UIMessage[];
  initialPrompt?: string;
  initialPromptPath?: string | null;
  onThreadCreated?: (firstMessage: string) => Promise<string | undefined>;
  refreshThreadList?: () => void;
}

export interface ChatToolApprovalRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ChatToolApprovalContextValue {
  pendingApproval: ChatToolApprovalRequest | null;
  responding: boolean;
  error: string | null;
  respondToApproval: (approved: boolean) => Promise<void>;
}

const ChatToolApprovalContext = createContext<ChatToolApprovalContextValue>({
  pendingApproval: null,
  responding: false,
  error: null,
  respondToApproval: async () => undefined,
});

export function useChatToolApproval() {
  return useContext(ChatToolApprovalContext);
}

function approvalRequest(value: unknown): ChatToolApprovalRequest | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.runId !== "string"
    || typeof data.toolCallId !== "string"
    || typeof data.toolName !== "string"
    || !data.args
    || typeof data.args !== "object"
    || Array.isArray(data.args)
  ) {
    return null;
  }
  return {
    runId: data.runId,
    toolCallId: data.toolCallId,
    toolName: data.toolName,
    args: data.args as Record<string, unknown>,
  };
}

export function ChatRuntimeProvider({
  children,
  controls,
  threadId,
  scope,
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
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const resumeRequestRef = useRef<{
    runId: string;
    toolCallId: string;
    resumeData: { approved: boolean };
  } | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ChatToolApprovalRequest | null>(null);
  const [responding, setResponding] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const chatHelpers = useChat({
    onData(part) {
      if (part.type !== "data-tool-call-approval") return;
      const request = approvalRequest(part.data);
      if (request) {
        setApprovalError(null);
        setPendingApproval(request);
      }
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      async prepareSendMessagesRequest({ messages }) {
        const resumeRequest = resumeRequestRef.current;
        resumeRequestRef.current = null;
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
            scope: scopeRef.current,
            memory: threadIdRef.current
              ? { thread: threadIdRef.current }
              : undefined,
            ...(resumeRequest ?? {}),
          },
        };
      },
    }),
  });
  const { sendMessage, setMessages, status } = chatHelpers;

  const respondToApproval = useCallback(async (approved: boolean) => {
    if (!pendingApproval || responding) return;
    const request = pendingApproval;
    setResponding(true);
    setApprovalError(null);
    resumeRequestRef.current = {
      runId: request.runId,
      toolCallId: request.toolCallId,
      resumeData: { approved },
    };
    try {
      await sendMessage();
      setPendingApproval(null);
    } catch (error) {
      resumeRequestRef.current = null;
      setApprovalError(
        error instanceof Error
          ? error.message
          : "Taicho could not continue the approved operation.",
      );
      throw error;
    } finally {
      setResponding(false);
    }
  }, [pendingApproval, responding, sendMessage]);

  const approvalContext = useMemo(() => ({
    pendingApproval,
    responding,
    error: approvalError,
    respondToApproval,
  }), [approvalError, pendingApproval, responding, respondToApproval]);

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
    <ChatToolApprovalContext.Provider value={approvalContext}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ChatToolApprovalContext.Provider>
  );
}
