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
  XCircle,
  Plus,
  Navigation,
  User,
  Clock,
  History,
  ChevronLeft,
  Tag,
  Paperclip,
  X,
} from "lucide-react";
import type { AISession } from "../hooks/useAIWebSocket";
import type { AIContentBlock, AIMessageContent } from "./ValProvider";
import { ToolName } from "../utils/toolNames";
import { useValConfig } from "./ValFieldProvider";
import { DEFAULT_APP_HOST } from "@valbuild/core";

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

export type ChatMessageAttachment = {
  key: string;
  name: string;
  mimeType?: string;
  previewUrl?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: AIMessageContent;
  status: ChatMessageStatus;
  error?: string;
  errorCode?: string;
  toolActivities?: ToolActivity[];
  attachments?: ChatMessageAttachment[];
};

type AttachedFile = {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  key?: string;
  previewUrl?: string;
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
  errorAssistantMessage: (id: string, error: string, code?: string) => void;
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
  /** Clear all messages (used when starting a new session) */
  clearMessages: () => void;
  /** Bulk-load historical messages (e.g. when restoring a session) */
  loadMessages: (messages: ChatMessage[]) => void;
};

export type AIChatProps = {
  /** Called when the user submits a message (via input or suggestion chip). Returns true if sent successfully. */
  onSendMessage?: (
    text: string,
    attachments?: ChatMessageAttachment[],
  ) => boolean;
  /** Called to upload a file to the current AI session. Returns the server key. */
  onUploadFile?: (file: File) => Promise<{ key: string }>;
  /** Called when the user clicks "New Chat" to start a fresh session */
  onNewSession?: () => void;
  /** Prompt suggestion chips shown on the empty state */
  suggestions?: string[];
  /** Extra class names on the root container */
  className?: string;
  /** Whether the underlying WebSocket connection is ready */
  isConnected: boolean;
  /** List of past sessions (fetched on demand) */
  sessions?: AISession[];
  /** The currently active session ID */
  currentSessionId?: string;
  /** Called to load a previous session */
  onLoadSession?: (sessionId: string) => void;
  /** Called to trigger a sessions fetch */
  onFetchSessions?: () => void;
  /** Called to rename a session */
  onSetSessionName?: (sessionId: string, name: string) => void;
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
  "What am I looking at?",
  "Fix typos",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _msgId = 0;
function nextId(): string {
  return `chat-${++_msgId}-${Date.now()}`;
}

function getTextContent(content: AIMessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter(
      (block): block is Extract<AIContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n\n");
}

function getImageUrls(content: AIMessageContent): string[] {
  if (typeof content === "string") {
    return [];
  }
  return content
    .filter(
      (block): block is Extract<AIContentBlock, { type: "image_url" }> =>
        block.type === "image_url",
    )
    .map((block) => block.url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AIChat = forwardRef<AIChatHandle, AIChatProps>(function AIChat(
  {
    onSendMessage,
    onUploadFile,
    onNewSession,
    suggestions = DEFAULT_SUGGESTIONS,
    className,
    isConnected,
    sessions,
    currentSessionId,
    onLoadSession,
    onFetchSessions,
    onSetSessionName,
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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const config = useValConfig();
  const effectiveSuggestions = config?.ai?.chat?.suggestions ?? suggestions;
  const emptyTitle = config?.ai?.chat?.title;
  const emptyDescription = config?.ai?.chat?.description;

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
      setCurrentMessage({
        message: { id, role: "assistant", content: "", status: "streaming" },
        startedAt: Date.now(),
      });
    },
    appendAssistantChunk(id: string, chunk: string) {
      setCurrentMessage((prev) =>
        prev?.message.id === id
          ? {
              ...prev,
              message: {
                ...prev.message,
                content: getTextContent(prev.message.content) + chunk,
              },
            }
          : prev,
      );
    },
    completeAssistantMessage(id: string) {
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== id) return prev;
        setCompletedMessages((msgs) => [
          ...msgs,
          { ...prev.message, status: "complete" },
        ]);
        return null;
      });
    },
    errorAssistantMessage(id: string, error: string, code?: string) {
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== id) return prev;
        setCompletedMessages((msgs) => [
          ...msgs,
          { ...prev.message, status: "error", error, errorCode: code },
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
    clearMessages() {
      setCompletedMessages([]);
      setCurrentMessage(null);
    },
    loadMessages(messages: ChatMessage[]) {
      setCurrentMessage(null);
      setCompletedMessages(messages);
    },
  }));

  // ---- Derived state ----

  const isStreaming = currentMessage !== null;
  const isUploading = attachedFiles.some((f) => f.status === "uploading");
  const isEmpty = messages.length === 0;

  // ---- Handlers ----

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      // Reset input so the same file can be re-selected
      e.target.value = "";

      const newEntries: AttachedFile[] = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "uploading" as const,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      }));

      setAttachedFiles((prev) => [...prev, ...newEntries]);

      if (onUploadFile) {
        newEntries.forEach((entry) => {
          onUploadFile(entry.file)
            .then(({ key }) => {
              setAttachedFiles((prev) =>
                prev.map((f) =>
                  f.id === entry.id ? { ...f, status: "done", key } : f,
                ),
              );
            })
            .catch(() => {
              setAttachedFiles((prev) =>
                prev.map((f) =>
                  f.id === entry.id ? { ...f, status: "error" } : f,
                ),
              );
            });
        });
      }
    },
    [onUploadFile],
  );

  const removeAttachedFile = useCallback((id: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const handleSend = useCallback(
    (text?: string) => {
      const content = (text ?? inputValue).trim();
      if (!content || isStreaming) return;

      const doneAttachments: ChatMessageAttachment[] = attachedFiles
        .filter(
          (f): f is AttachedFile & { key: string } =>
            f.status === "done" && f.key !== undefined,
        )
        .map((f) => ({
          key: f.key,
          name: f.file.name,
          mimeType: f.file.type || undefined,
          previewUrl: f.previewUrl,
        }));

      // Revoke object URLs for files we're sending (they'll be in the message)
      attachedFiles.forEach((f) => {
        if (f.previewUrl && f.status !== "done")
          URL.revokeObjectURL(f.previewUrl);
      });
      setAttachedFiles([]);

      const msgId = nextId();
      const userMsg: ChatMessage = {
        id: msgId,
        role: "user",
        content,
        status: "complete",
        attachments: doneAttachments.length > 0 ? doneAttachments : undefined,
      };
      setCompletedMessages((prev) => [...prev, userMsg]);
      setInputValue("");

      const sent = onSendMessage
        ? onSendMessage(
            content,
            doneAttachments.length > 0 ? doneAttachments : undefined,
          )
        : true;
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
    [inputValue, isStreaming, attachedFiles, onSendMessage],
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
        const retryText = getTextContent(errorMsg.content);
        const sent = onSendMessage
          ? onSendMessage(retryText, errorMsg.attachments)
          : true;
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
      onSendMessage?.(
        getTextContent(prevUserMsg.content),
        prevUserMsg.attachments,
      );
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
        "flex flex-col h-full w-full bg-bg-primary text-fg-primary relative overflow-hidden",
        className,
      )}
    >
      {/* Header with New Chat + History buttons */}
      {(!isEmpty || onFetchSessions) && (
        <div className="shrink-0 flex justify-between items-center p-2 border-b border-border-primary">
          <div>
            {onFetchSessions && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onFetchSessions();
                  setShowSessions(true);
                }}
                className="text-xs gap-1"
              >
                <History className="h-3 w-3" />
                History
              </Button>
            )}
          </div>
          <div>
            {!isEmpty && onNewSession && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onNewSession}
                disabled={isStreaming}
                className="text-xs gap-1"
              >
                <Plus className="h-3 w-3" />
                New chat
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Sessions panel overlay */}
      {showSessions && (
        <div className="absolute inset-0 z-overlay flex flex-col bg-bg-primary">
          <div className="shrink-0 flex items-center gap-2 p-2 border-b border-border-primary">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setShowSessions(false);
                setRenamingSessionId(null);
              }}
              aria-label="Back to chat"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium flex-1">Chat history</span>
            {onNewSession && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onNewSession();
                  setShowSessions(false);
                }}
                className="text-xs gap-1"
              >
                <Plus className="h-3 w-3" />
                New chat
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1 min-h-0">
            {!sessions || sessions.length === 0 ? (
              <div className="p-6 text-center text-sm text-fg-secondary">
                No previous sessions
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border-primary">
                {sessions.map((session) => {
                  const isActive = session.id === currentSessionId;
                  const isRenaming = renamingSessionId === session.id;
                  const displayName =
                    session.name ??
                    `Chat, ${new Date(session.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
                  return (
                    <div
                      key={session.id}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 group",
                        isActive && "bg-bg-secondary",
                      )}
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          className="flex-1 text-sm bg-bg-primary border border-border-primary rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const trimmed = renameValue.trim();
                              if (trimmed && onSetSessionName) {
                                onSetSessionName(session.id, trimmed);
                              }
                              setRenamingSessionId(null);
                            } else if (e.key === "Escape") {
                              setRenamingSessionId(null);
                            }
                          }}
                          onBlur={() => {
                            const trimmed = renameValue.trim();
                            if (trimmed && onSetSessionName) {
                              onSetSessionName(session.id, trimmed);
                            }
                            setRenamingSessionId(null);
                          }}
                        />
                      ) : (
                        <button
                          className="flex-1 text-left text-sm truncate"
                          onClick={() => {
                            onLoadSession?.(session.id);
                            setShowSessions(false);
                          }}
                        >
                          {displayName}
                        </button>
                      )}
                      {!isRenaming && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 group-hover:opacity-100 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameValue(session.name ?? "");
                            setRenamingSessionId(session.id);
                          }}
                          aria-label="Rename session"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Message list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 p-4">
          {isEmpty ? (
            <EmptyState
              suggestions={effectiveSuggestions}
              title={emptyTitle}
              description={emptyDescription}
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
          <div className="mb-2 flex items-center justify-center gap-1.5 rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs text-fg-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse" />
            Connecting…
          </div>
        )}
        {/* Attached file previews */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachedFiles.map((f) => (
              <div
                key={f.id}
                className="relative flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-secondary px-2 py-1 text-xs text-fg-primary"
              >
                {f.previewUrl ? (
                  <img
                    src={f.previewUrl}
                    alt={f.file.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-fg-secondary" />
                )}
                <span className="max-w-[120px] truncate">{f.file.name}</span>
                {f.status === "uploading" && (
                  <Loader2 className="h-3 w-3 animate-spin text-fg-secondary" />
                )}
                {f.status === "error" && (
                  <XCircle className="h-3 w-3 text-fg-error-primary" />
                )}
                <button
                  type="button"
                  onClick={() => removeAttachedFile(f.id)}
                  className="ml-0.5 text-fg-secondary hover:text-fg-primary"
                  aria-label={`Remove ${f.file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {onUploadFile && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            accept="image/*"
          />
        )}
        <div className="flex items-end gap-2">
          {onUploadFile && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!isConnected || isStreaming}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
              className="mb-1"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          )}
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
            disabled={
              !isConnected || isStreaming || isUploading || !inputValue.trim()
            }
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
  title,
  description,
  onSelect,
}: {
  suggestions: string[];
  title?: string;
  description?: string;
  onSelect: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="rounded-full  p-3">
        <Sparkles className="h-8 w-8" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-fg-primary">
          {title ?? "How can I help?"}
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          {description ?? "Ask me anything or pick a suggestion below"}
        </p>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <Button
              key={s}
              variant="secondary"
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
  const config = useValConfig();
  const appHostUrl = config?.appHost || DEFAULT_APP_HOST;
  const project = config?.project;
  const org = project?.split("/")[0];

  const isUser = message.role === "user";
  const isError = message.status === "error";
  const isStreamingMsg = message.status === "streaming";
  const textContent = getTextContent(message.content);
  const fileUrls = getImageUrls(message.content);

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
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {message.attachments.map((a) =>
                  a.mimeType?.startsWith("image/") && a.previewUrl ? (
                    <img
                      key={a.key}
                      src={a.previewUrl}
                      alt={a.name}
                      className="h-16 w-16 rounded object-cover"
                    />
                  ) : (
                    <div
                      key={a.key}
                      className="flex items-center gap-1 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-fg-secondary"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="max-w-[120px] truncate">{a.name}</span>
                    </div>
                  ),
                )}
              </div>
            )}
            {fileUrls.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {fileUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt="Session attachment"
                    className="max-h-48 rounded object-contain"
                  />
                ))}
              </div>
            )}
            {textContent && (
              <p className="whitespace-pre-wrap">{textContent}</p>
            )}
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
            {fileUrls.length > 0 && (
              <div className="not-prose mb-3 flex flex-wrap gap-2">
                {fileUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt="AI session image"
                    className="max-h-64 rounded border border-border-primary object-contain"
                  />
                ))}
              </div>
            )}
            {textContent ? (
              <ReactMarkdown>{textContent}</ReactMarkdown>
            ) : isStreamingMsg || isError || fileUrls.length > 0 ? null : (
              <p className="text-fg-secondary italic">Empty response</p>
            )}
            {isStreamingMsg && <StreamingCursor />}
          </div>
        )}

        {isError && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-fg-error-primary">
                {message.error ?? "Something went wrong"}
              </p>
              {message.errorCode === "token_limit_reached" && (
                <a
                  href={
                    org
                      ? `${appHostUrl}/manage-subscription/${org}`
                      : appHostUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-fg-brand-primary underline"
                >
                  Add a data pack to continue using AI
                </a>
              )}
            </div>
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

const TOOL_DISPLAY: Record<ToolName, { label: string; icon: React.ReactNode }> =
  {
    get_all_schema: {
      label: "Reading schemas",
      icon: <Database className="h-3 w-3" />,
    },
    get_source: {
      label: "Reading content",
      icon: <FileText className="h-3 w-3" />,
    },
    search_content: {
      label: "Searching",
      icon: <Search className="h-3 w-3" />,
    },
    validate_content: {
      label: "Validating",
      icon: <ShieldCheck className="h-3 w-3" />,
    },
    create_patch: {
      label: "Updating content",
      icon: <Pencil className="h-3 w-3" />,
    },
    convert_session_image_to_patch: {
      label: "Adding image",
      icon: <Paperclip className="h-3 w-3" />,
    },
    navigate_to: {
      label: "Navigating to content",
      icon: <Navigation className="h-3 w-3" />,
    },
    get_patches: {
      label: "Loading changes",
      icon: <Clock className="h-3 w-3" />,
    },
    get_source_path_from_route: {
      label: "Resolving route",
      icon: <Navigation className="h-3 w-3" />,
    },
    get_current_context: {
      label: "Gathering context",
      icon: <User className="h-3 w-3" />,
    },
    set_session_name: {
      label: "Naming session",
      icon: <Tag className="h-3 w-3" />,
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
        const display = TOOL_DISPLAY[activity.name as ToolName] ?? {
          label: activity.name,
          icon: <Loader2 className="h-3 w-3" />,
        };
        const isPending = activity.status === "pending";
        const isError = activity.status === "error";
        console.log(activity);
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
              <></>
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
