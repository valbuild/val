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
import { Send, RotateCcw, Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessageStatus = "complete" | "streaming" | "error";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessageStatus;
  error?: string;
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
};

export type AIChatProps = {
  /** Called when the user submits a message (via input or suggestion chip) */
  onSendMessage?: (text: string) => void;
  /** Prompt suggestion chips shown on the empty state */
  suggestions?: string[];
  /** Extra class names on the root container */
  className?: string;
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
    initialMessages,
  },
  ref,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages ?? [],
  );
  const [inputValue, setInputValue] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    const el = viewportRef.current;
    if (el) {
      // requestAnimationFrame so the DOM has rendered the new content
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  // ---- Imperative handle for WebSocket layer ----

  useImperativeHandle(ref, () => ({
    startAssistantMessage(id: string) {
      setMessages((prev) => [
        ...prev,
        { id, role: "assistant", content: "", status: "streaming" },
      ]);
    },
    appendAssistantChunk(id: string, chunk: string) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, content: m.content + chunk } : m,
        ),
      );
    },
    completeAssistantMessage(id: string) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, status: "complete" as const } : m,
        ),
      );
    },
    errorAssistantMessage(id: string, error: string) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, status: "error" as const, error } : m,
        ),
      );
    },
  }));

  // ---- Derived state ----

  const isStreaming = messages.some((m) => m.status === "streaming");
  const isEmpty = messages.length === 0;

  // ---- Handlers ----

  const handleSend = useCallback(
    (text?: string) => {
      const content = (text ?? inputValue).trim();
      if (!content || isStreaming) return;

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content,
        status: "complete",
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputValue("");
      onSendMessage?.(content);

      // Refocus textarea after send
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [inputValue, isStreaming, onSendMessage],
  );

  const handleRetry = useCallback(
    (errorMsgId: string) => {
      // Find the user message right before the errored assistant message
      const idx = messages.findIndex((m) => m.id === errorMsgId);
      if (idx <= 0) return;

      const prevUserMsg = messages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUserMsg) return;

      // Remove the errored assistant message
      setMessages((prev) => prev.filter((m) => m.id !== errorMsgId));
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
      <ScrollArea className="flex-1 min-h-0" innerRef={viewportRef}>
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
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="shrink-0 border-t border-border-primary bg-bg-primary p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 grid">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask something…"
              disabled={isStreaming}
              rows={1}
              className={cn(
                "resize-none overflow-hidden",
                "flex rounded-md border border-border-primary bg-bg-primary px-3 py-2",
                "text-sm text-fg-primary",
                "ring-offset-background placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
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
            disabled={isStreaming || !inputValue.trim()}
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
            ? "bg-accent text-accent-foreground max-w-[80%]"
            : "bg-bg-secondary text-fg-primary w-full max-w-full",
          isError && "border border-bg-error-primary",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
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
