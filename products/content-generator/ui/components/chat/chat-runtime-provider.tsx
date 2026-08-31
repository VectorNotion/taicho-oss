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

const interruptedConversationNotice = 'Taicho stopped before completing this response. Retry the message when you are ready.';

interface ChatRuntimeProviderProps {
  children: React.ReactNode;
  controls: ChatControls;
  threadId?: string;
  scope: ChatThreadScope;
  initialMessages?: UIMessage[];
  initialPrompt?: string;
  initialPromptPath?: string | null;
  onNewConversation?: () => void;
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
  conversationError: string | null;
  committedRecovery: boolean;
  retryingConversation: boolean;
  startNewConversation: () => void;
  retryConversation: () => Promise<void>;
  respondToApproval: (approved: boolean) => Promise<void>;
}

const ChatToolApprovalContext = createContext<ChatToolApprovalContextValue>({
  pendingApproval: null,
  responding: false,
  error: null,
  conversationError: null,
  committedRecovery: false,
  retryingConversation: false,
  startNewConversation: () => undefined,
  retryConversation: async () => undefined,
  respondToApproval: async () => undefined,
});

export function useChatToolApproval() {
  return useContext(ChatToolApprovalContext);
}

export function useChatConversationError() {
  const {
    conversationError,
    retryConversation,
    retryingConversation,
    startNewConversation,
  } = useContext(ChatToolApprovalContext);
  return {
    conversationError,
    retryConversation,
    retryingConversation,
    startNewConversation,
  };
}

async function chatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    throw new Error('Your Chat session expired. Sign in again before sending this message.');
  }
  if (response.status === 404) {
    const payload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
    if (payload?.error === 'Conversation not found') {
      throw new Error('This conversation was deleted or is no longer available. Your message remains visible here.');
    }
  }
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null) as {
      detail?: unknown;
      error?: unknown;
    } | null;
    const message = typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.detail === 'string'
        ? payload.detail
        : null;
    if (message) throw new Error(message);
    throw new Error(`Taicho could not complete this response (${response.status}). Retry this message safely.`);
  }
  return response;
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

function approvalRequestFromMessages(messages: UIMessage[]): ChatToolApprovalRequest | null {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== 'data-tool-call-approval') continue;
      const request = approvalRequest(part.data);
      if (request) return request;
    }
  }
  return null;
}

function committedApprovalRequestFromMessages(messages: UIMessage[]): ChatToolApprovalRequest | null {
  for (const message of [...messages].reverse()) {
    const committedRun = message.parts.find((part) => {
      if (part.type !== 'data-tool-side-effect-state') return false;
      const data = part.data as { effectState?: unknown; runId?: unknown };
      return data.effectState === 'committed' && typeof data.runId === 'string';
    });
    const committedRunId = committedRun?.type === 'data-tool-side-effect-state'
      ? (committedRun.data as { runId: string }).runId
      : null;
    if (!committedRunId) continue;
    for (const part of [...message.parts].reverse()) {
      const tool = part as unknown as {
        input?: unknown;
        output?: unknown;
        toolCallId?: unknown;
      };
      if (
        typeof tool.toolCallId !== 'string'
        || !tool.input
        || typeof tool.input !== 'object'
        || Array.isArray(tool.input)
        || !tool.output
        || typeof tool.output !== 'object'
        || (tool.output as { effectState?: unknown }).effectState !== 'committed'
      ) {
        continue;
      }
      return {
        runId: committedRunId,
        toolCallId: tool.toolCallId,
        toolName: 'platform__capability__write',
        args: tool.input as Record<string, unknown>,
      };
    }
  }
  return null;
}

function conversationWasInterrupted(messages: UIMessage[]): boolean {
  return messages.some((message) => message.parts.some((part) => (
    part.type === 'text' && part.text === interruptedConversationNotice
  )));
}

export function ChatRuntimeProvider({
  children,
  controls,
  threadId,
  scope,
  initialMessages = [],
  initialPrompt,
  initialPromptPath = "/chat",
  onNewConversation,
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
  const committedResumeRequestRef = useRef<ChatToolApprovalRequest | null>(
    committedApprovalRequestFromMessages(initialMessages),
  );
  const approvalAttemptRef = useRef<ChatToolApprovalRequest | null>(null);
  const approvalCommittedRef = useRef(false);
  const activeUserMessageRef = useRef<{ id: string; text: string; attemptId: string } | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ChatToolApprovalRequest | null>(null);
  const [responding, setResponding] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [committedRecovery, setCommittedRecovery] = useState(false);
  const [retryingConversation, setRetryingConversation] = useState(false);

  const chatHelpers = useChat({
    onError(error) {
      const approvalAttempt = approvalAttemptRef.current;
      if (approvalAttempt) {
        if (approvalCommittedRef.current) {
          setPendingApproval(null);
          setApprovalError(null);
          setCommittedRecovery(true);
        } else {
          setPendingApproval(approvalAttempt);
          setApprovalError(error.message || 'Taicho could not continue the approved operation.');
        }
        return;
      }
      setConversationError(error.message || 'Taicho could not complete this response.');
    },
    onData(part) {
      if (part.type === "data-tool-side-effect-state") {
        const data = part.data as { effectState?: unknown };
        if (data?.effectState === "committed") approvalCommittedRef.current = true;
        return;
      }
      if (part.type === "data-tool-call-approval") {
        const request = approvalRequest(part.data);
        if (request) {
          setCommittedRecovery(false);
          setApprovalError(null);
          setPendingApproval(request);
        }
      }
    },
    onFinish({ isAbort, isError }) {
      const approvalAttempt = approvalAttemptRef.current;
      if (approvalAttempt) {
        if (!isAbort && !isError) {
          setPendingApproval(null);
          setApprovalError(null);
          setCommittedRecovery(false);
        }
        approvalAttemptRef.current = null;
        approvalCommittedRef.current = false;
        setResponding(false);
      }
      const userMessage = activeUserMessageRef.current;
      activeUserMessageRef.current = null;
      if (!isAbort) return;
      setConversationError(interruptedConversationNotice);
      const activeThreadId = threadIdRef.current;
      if (!activeThreadId || !userMessage) return;
      void fetch('/api/chat/interrupt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          userMessageId: userMessage.id,
          userMessageText: userMessage.text,
          attemptId: userMessage.attemptId,
          scope: scopeRef.current,
        }),
      }).then(async (response) => {
        if (response.ok) return;
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Taicho could not record the interrupted response.');
      }).catch((error: unknown) => {
        setConversationError(error instanceof Error
          ? error.message
          : 'Taicho could not record the interrupted response.');
      });
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: chatFetch,
      async prepareSendMessagesRequest({ messages }) {
        setCommittedRecovery(false);
        setConversationError(null);
        const committedResumeRequest = committedResumeRequestRef.current;
        const resumeRequest = resumeRequestRef.current ?? (committedResumeRequest
          ? {
              runId: committedResumeRequest.runId,
              toolCallId: committedResumeRequest.toolCallId,
              resumeData: { approved: true },
            }
          : null);
        resumeRequestRef.current = null;
        committedResumeRequestRef.current = null;
        if (!threadIdRef.current && onThreadCreated) {
          const lastMessage = messages.at(-1);
          const firstMessage = lastMessage?.parts
            ?.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join(" ")
            .trim() || "New conversation";
          threadIdRef.current = await onThreadCreated(firstMessage);
        }
        const activeUserMessage = [...messages].reverse().find((message) => message.role === 'user');
        const activeUserMessageText = activeUserMessage?.parts
          .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
          .map((part) => part.text)
          .join(' ')
          .trim() ?? '';
        const attemptId = crypto.randomUUID();
        activeUserMessageRef.current = activeUserMessage && activeUserMessageText
          ? { id: activeUserMessage.id, text: activeUserMessageText, attemptId }
          : null;
        return {
          body: {
            attemptId,
            controls: controlsRef.current,
            messages: committedResumeRequest
              ? [
                  ...messages,
                  {
                    id: `${committedResumeRequest.toolCallId}:retry-context`,
                    role: 'assistant' as const,
                    parts: [{
                      type: 'data-tool-call-approval' as const,
                      data: committedResumeRequest,
                    }],
                  },
                ]
              : messages,
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
  const {
    clearError,
    regenerate,
    sendMessage,
    setMessages,
    status,
  } = chatHelpers;

  const retryConversation = useCallback(async () => {
    if (retryingConversation || (status !== 'error' && status !== 'ready')) return;
    setRetryingConversation(true);
    setConversationError(null);
    clearError();
    try {
      await regenerate();
    } catch (error) {
      setConversationError(
        error instanceof Error
          ? error.message
          : 'Taicho could not retry this response.',
      );
    } finally {
      setRetryingConversation(false);
    }
  }, [clearError, regenerate, retryingConversation, status]);

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
    approvalAttemptRef.current = request;
    approvalCommittedRef.current = false;
    setCommittedRecovery(false);
    try {
      await sendMessage();
    } catch (error) {
      resumeRequestRef.current = null;
      approvalAttemptRef.current = null;
      setPendingApproval(request);
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
    conversationError,
    committedRecovery,
    retryingConversation,
    startNewConversation: () => {
      setCommittedRecovery(false);
      setConversationError(null);
      onNewConversation?.();
    },
    retryConversation,
    respondToApproval,
  }), [approvalError, committedRecovery, conversationError, onNewConversation, pendingApproval, responding, respondToApproval, retryConversation, retryingConversation]);

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
      setPendingApproval(approvalRequestFromMessages(initialMessages));
      committedResumeRequestRef.current = committedApprovalRequestFromMessages(initialMessages);
      setApprovalError(null);
      setCommittedRecovery(false);
      setConversationError(
        conversationWasInterrupted(initialMessages)
          ? interruptedConversationNotice
          : null,
      );
    }
  }, [initialMessages, setMessages]);

  // Set messages on first render if provided
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
    setPendingApproval(approvalRequestFromMessages(initialMessages));
    committedResumeRequestRef.current = committedApprovalRequestFromMessages(initialMessages);
    setConversationError(
      conversationWasInterrupted(initialMessages)
        ? interruptedConversationNotice
        : null,
    );
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
