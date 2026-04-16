import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "./designSystem/scroll-area";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";
import {
  Send,
  RotateCcw,
  Sparkles,
  Check,
  Loader2,
  Search,
  FileText,
  Database,
  ShieldCheck,
  Pencil,
  CheckCircle2,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessageStatus = "complete" | "streaming" | "error";

export type ToolActivityStatus = "pending" | "complete" | "error";

export type ToolActivity = {
  toolCallId: string;
  name: string;
  status: ToolActivityStatus;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessageStatus;
  error?: string;
  toolActivities?: ToolActivity[];
};

type CurrentMessage = {
  message: ChatMessage;
  startedAt: number;
};

export type AIChatHandle = {
  /** Create a new empty assistant message in streaming state */
  startAssistantMessage: (id: string) => void;
  /** Append a token/chunk to the assistant message with the given id */
  appendAssistantChunk: (id: string, chunk: string) => void;
  /** Mark the assistant message as complete */
  completeAssistantMessage: (id: string) => void;
  /** Mark the assistant message as errored */
  errorAssistantMessage: (id: string, error: string) => void;
  /** Add a tool call indicator to the current assistant message */
  addToolCall: (
    messageId: string,
    toolCallId: string,
    toolName: string,
  ) => void;
  /** Mark a tool call as complete */
  completeToolCall: (messageId: string, toolCallId: string) => void;
  /** Mark a tool call as errored */
  errorToolCall: (messageId: string, toolCallId: string) => void;
};

export type AIChatProps = {
  /** Called when the user submits a message (via input or suggestion chip). Returns true if sent successfully. */
  onSendMessage?: (text: string) => boolean;
  /** Prompt suggestion chips shown on the empty state */
  suggestions?: string[];
  /** Extra class names on the root container */
  className?: string;
  /** Whether the underlying WebSocket connection is ready */
  isConnected: boolean;
  /**
   * @internal – seed messages for Storybook / testing only.
   * Not part of the public API.
   */
  initialMessages?: ChatMessage[];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SUGGESTIONS = [
  "Summarize recent changes",
  "Help me write content",
  "Explain this schema",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _msgId = 0;
function nextId(): string {
  return `chat-${++_msgId}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AIChat = forwardRef<AIChatHandle, AIChatProps>(function AIChat(
  {
    onSendMessage,
    suggestions = DEFAULT_SUGGESTIONS,
    className,
    isConnected,
    initialMessages,
  },
  ref,
) {
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>(
    initialMessages ?? [],
  );
  const [currentMessage, setCurrentMessage] = useState<CurrentMessage | null>(
    null,
  );
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Derive combined list for rendering
  const messages: ChatMessage[] = currentMessage
    ? [...completedMessages, currentMessage.message]
    : completedMessages;

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, [messages]);

  // 2-minute timeout for in-progress assistant messages
  useEffect(() => {
    if (!currentMessage) return;
    const remaining = 2 * 60 * 1000 - (Date.now() - currentMessage.startedAt);
    if (remaining <= 0) {
      setCompletedMessages((prev) => [
        ...prev,
        {
          ...currentMessage.message,
          status: "error",
          error: "Response timed out",
        },
      ]);
      setCurrentMessage(null);
      return;
    }
    const timer = setTimeout(() => {
      setCurrentMessage((prev) => {
        if (!prev) return null;
        setCompletedMessages((msgs) => [
          ...msgs,
          { ...prev.message, status: "error", error: "Response timed out" },
        ]);
        return null;
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [currentMessage]);

  // ---- Imperative handle for WebSocket layer ----

  useImperativeHandle(ref, () => ({
    startAssistantMessage(id: string) {
      console.log("Starting assistant message with id", id);
      setCurrentMessage({
        message: { id, role: "assistant", content: "", status: "streaming" },
        startedAt: Date.now(),
      });
    },
    appendAssistantChunk(id: string, chunk: string) {
      console.log(
        "Appending chunk to assistant message with id",
        id,
        "chunk:",
        chunk,
      );
      setCurrentMessage((prev) =>
        prev?.message.id === id
          ? {
              ...prev,
              message: {
                ...prev.message,
                content: prev.message.content + chunk,
              },
            }
          : prev,
      );
    },
    completeAssistantMessage(id: string) {
      console.log("Completing assistant message with id", id);
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== id) return prev;
        setCompletedMessages((msgs) => [
          ...msgs,
          { ...prev.message, status: "complete" },
        ]);
        return null;
      });
    },
    errorAssistantMessage(id: string, error: string) {
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== id) return prev;
        setCompletedMessages((msgs) => [
          ...msgs,
          { ...prev.message, status: "error", error },
        ]);
        return null;
      });
    },
    addToolCall(messageId: string, toolCallId: string, toolName: string) {
      const activity: ToolActivity = {
        toolCallId,
        name: toolName,
        status: "pending",
      };
      setCurrentMessage((prev) => {
        if (prev && prev.message.id === messageId) {
          return {
            ...prev,
            message: {
              ...prev.message,
              toolActivities: [
                ...(prev.message.toolActivities ?? []),
                activity,
              ],
            },
          };
        }
        return prev;
      });
    },
    completeToolCall(messageId: string, toolCallId: string) {
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== messageId) return prev;
        return {
          ...prev,
          message: {
            ...prev.message,
            toolActivities: (prev.message.toolActivities ?? []).map((t) =>
              t.toolCallId === toolCallId
                ? { ...t, status: "complete" as const }
                : t,
            ),
          },
        };
      });
    },
    errorToolCall(messageId: string, toolCallId: string) {
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== messageId) return prev;
        return {
          ...prev,
          message: {
            ...prev.message,
            toolActivities: (prev.message.toolActivities ?? []).map((t) =>
              t.toolCallId === toolCallId
                ? { ...t, status: "error" as const }
                : t,
            ),
          },
        };
      });
    },
  }));

  // ---- Derived state ----

  const isStreaming = currentMessage !== null;
  const isEmpty = messages.length === 0;

  // ---- Handlers ----

  const handleSend = useCallback(
    (text?: string) => {
      const content = (text ?? inputValue).trim();
      if (!content || isStreaming) return;

      const msgId = nextId();
      const userMsg: ChatMessage = {
        id: msgId,
        role: "user",
        content,
        status: "complete",
      };
      setCompletedMessages((prev) => [...prev, userMsg]);
      setInputValue("");

      const sent = onSendMessage ? onSendMessage(content) : true;
      if (!sent) {
        setCompletedMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, status: "error", error: "Failed to send" }
              : m,
          ),
        );
      }

      // Refocus textarea after send
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [inputValue, isStreaming, onSendMessage],
  );

  const handleRetry = useCallback(
    (errorMsgId: string) => {
      const errorMsg = messages.find((m) => m.id === errorMsgId);

      // Retry a failed user message (WebSocket send error)
      if (errorMsg?.role === "user") {
        setCompletedMessages((prev) =>
          prev.map((m) =>
            m.id === errorMsgId
              ? { ...m, status: "complete", error: undefined }
              : m,
          ),
        );
        const sent = onSendMessage ? onSendMessage(errorMsg.content) : true;
        if (!sent) {
          setCompletedMessages((prev) =>
            prev.map((m) =>
              m.id === errorMsgId
                ? { ...m, status: "error", error: "Failed to send" }
                : m,
            ),
          );
        }
        return;
      }

      // Find the user message right before the errored assistant message
      const idx = messages.findIndex((m) => m.id === errorMsgId);
      if (idx <= 0) return;

      const prevUserMsg = messages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUserMsg) return;

      // Remove the errored assistant message
      setCompletedMessages((prev) => prev.filter((m) => m.id !== errorMsgId));
      onSendMessage?.(prevUserMsg.content);
    },
    [messages, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ---- Render ----

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full bg-bg-primary text-fg-primary",
        className,
      )}
    >
      {/* Message list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 p-4">
          {isEmpty ? (
            <EmptyState
              suggestions={suggestions}
              onSelect={(s) => handleSend(s)}
            />
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onRetry={handleRetry} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="shrink-0 border-t border-border-primary bg-bg-primary p-3">
        {!isConnected && (
          <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-fg-secondary justify-center absolute top-0 left-0 right-0">
            <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse" />
            Connecting…
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 grid">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isConnected ? "Ask something…" : ""}
              rows={1}
              className={cn(
                "resize-none overflow-hidden",
                "flex rounded-md border border-border-primary bg-bg-primary px-3 py-2",
                "text-fg-primary",
                "ring-offset-background placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
              style={{ gridArea: "1 / 1 / 2 / 2" }}
            />
            {/* Hidden mirror for auto-grow */}
            <div
              className={cn(
                "whitespace-pre-wrap invisible",
                "flex rounded-md border border-border-primary bg-bg-primary px-3 py-2",
                "text-sm",
              )}
              style={{ gridArea: "1 / 1 / 2 / 2" }}
            >
              {inputValue + " "}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!isConnected || isStreaming || !inputValue.trim()}
            onClick={() => handleSend()}
            aria-label="Send message"
            className="mb-1"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="rounded-full bg-bg-brand-primary/10 p-3">
        <Sparkles className="h-8 w-8 text-fg-brand-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-fg-primary">
          How can I help?
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Ask me anything or pick a suggestion below
        </p>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              onClick={() => onSelect(s)}
              className="text-sm"
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry: (id: string) => void;
}) {
  const isUser = message.role === "user";
  const isError = message.status === "error";
  const isStreamingMsg = message.status === "streaming";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-bg-secondary text-fg-primary max-w-[80%]"
            : "bg-bg-tertiary text-fg-primary w-full max-w-full",
          isError && "border border-border-error-primary",
        )}
      >
        {isUser ? (
          <>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.status === "complete" && (
              <div className="mt-1 flex justify-end">
                <span className="flex items-center gap-0.5 text-[10px] text-fg-secondary">
                  <Check className="h-2.5 w-2.5" />
                  Sent
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {message.toolActivities && message.toolActivities.length > 0 && (
              <ToolActivitiesIndicator activities={message.toolActivities} />
            )}
            {message.content ? (
              <ReactMarkdown>{message.content}</ReactMarkdown>
            ) : isStreamingMsg ? null : (
              <p className="text-fg-secondary italic">Empty response</p>
            )}
            {isStreamingMsg && <StreamingCursor />}
          </div>
        )}

        {isError && (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-xs text-fg-error-primary">
              {message.error ?? "Something went wrong"}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onRetry(message.id)}
              aria-label="Retry"
              className="h-6 w-6"
            >
              <RotateCcw className="h-3.5 w-3.5 text-fg-error-primary" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
      <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse" />
      <span
        className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tool activity display
// ---------------------------------------------------------------------------

const TOOL_DISPLAY: Record<string, { label: string; icon: React.ReactNode }> = {
  get_all_schema: {
    label: "Reading schemas",
    icon: <Database className="h-3 w-3" />,
  },
  get_source: {
    label: "Reading content",
    icon: <FileText className="h-3 w-3" />,
  },
  search_content: { label: "Searching", icon: <Search className="h-3 w-3" /> },
  validate_content: {
    label: "Validating",
    icon: <ShieldCheck className="h-3 w-3" />,
  },
  create_patch: {
    label: "Updating content",
    icon: <Pencil className="h-3 w-3" />,
  },
};

function ToolActivitiesIndicator({
  activities,
}: {
  activities: ToolActivity[];
}) {
  return (
    <div className="not-prose flex flex-col gap-1 mb-2">
      {activities.map((activity) => {
        const display = TOOL_DISPLAY[activity.name] ?? {
          label: activity.name,
          icon: <Loader2 className="h-3 w-3" />,
        };
        const isPending = activity.status === "pending";
        const isError = activity.status === "error";
        return (
          <div
            key={activity.toolCallId}
            className={cn(
              "flex items-center gap-1.5 text-xs py-0.5",
              isPending
                ? "text-fg-secondary"
                : isError
                  ? "text-fg-error-primary"
                  : "text-fg-secondary",
            )}
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isError ? (
              <XCircle className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-fg-success" />
            )}
            <span className="flex items-center gap-1">
              {display.icon}
              <span>
                {display.label}
                {isPending ? "…" : ""}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
