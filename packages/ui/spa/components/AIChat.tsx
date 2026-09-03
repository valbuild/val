import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "./designSystem/scroll-area";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";
import {
  Send,
  Square,
  RotateCcw,
  Sparkles,
  Loader2,
  LogIn,
  FileText,
  Pencil,
  XCircle,
  Plus,
  History,
  ChevronLeft,
  Paperclip,
  X,
  AlertTriangle,
} from "lucide-react";
import type { AISession } from "../hooks/useAIWebSocket";
import type { AIContentBlock, AIMessageContent } from "./ValProvider";
import { safeHref } from "../utils/safeHref";
import { useValConfig } from "./ValFieldProvider";
import { useValPortal } from "./ValPortalProvider";
import { urlOf } from "@valbuild/shared/internal";
import { CopyableCodeBlock } from "./designSystem/CopyableCodeBlock";
import { AIChatEditor } from "./AIChatEditor";
import type {
  ChatBlockNode,
  ChatDocument,
  ChatEditorRef,
  ChatInlineNode,
} from "./AIChatEditor";
import {
  chatDocumentToPlainText,
  collectImageKeysFromDoc,
} from "./AIChatEditor";
import { ToolActivities, isPendingQuestion } from "./AIChatToolActivities";
import { decideBubble } from "./aiChatBubble";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ToolActivity,
} from "./AIChatToolActivities";

export type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ToolActivity,
  ToolActivityStatus,
} from "./AIChatToolActivities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessageStatus = "complete" | "streaming" | "error";

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
  /**
   * Something to offer the user about this error, decided by the server.
   *
   * Here rather than derived from `errorCode` because only the server knows
   * where to send them: the admin URL depends on the org and project, which the
   * Studio does not assemble. It replaced a hardcoded "add a data pack" link
   * keyed off a code the server no longer sends.
   */
  errorAction?: { label: string; url: string };
  toolActivities?: ToolActivity[];
  attachments?: ChatMessageAttachment[];
  /**
   * For user messages composed in the rich editor, the original document so
   * the bubble can render inline images / field refs without re-parsing HTML
   * (which would lose `previewUrl`s for image nodes).
   */
  userDoc?: ChatDocument;
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
  errorAssistantMessage: (
    id: string,
    error: string,
    code?: string,
    action?: { label: string; url: string },
  ) => void;
  /** Add a tool call indicator to the current assistant message */
  addToolCall: (
    messageId: string,
    toolCallId: string,
    toolName: string,
    questions?: AskUserQuestionItem[],
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
  /**
   * Stop the running turn. When given, the send button becomes a stop button
   * while the assistant is streaming — the same control, because the two are
   * never both available and one of them is always the thing you want.
   */
  onCancel?: () => void;
  /** Called when the user submits a message (via input or suggestion chip). Returns true if sent successfully. */
  onSendMessage?: (
    content: string | ChatDocument,
    attachments?: ChatMessageAttachment[],
  ) => boolean;
  /** Called to upload a file to the current AI session. Returns the server key. */
  onUploadFile?: (file: File) => Promise<{ key: string }>;
  /** Shared ref to the inner rich text editor (used by Field.tsx to insert field references). */
  chatEditorRef?: RefObject<ChatEditorRef | null>;
  /** Called when the user clicks "New Chat" to start a fresh session */
  onNewSession?: () => void;
  /** Prompt suggestion chips shown on the empty state */
  suggestions?: string[];
  /** Extra class names on the root container */
  className?: string;
  /** Whether the underlying WebSocket connection is ready */
  isConnected: boolean;
  /** Set when /ai/initialize returned 401 — the user needs to authenticate */
  authError: boolean;
  /**
   * Why the assistant cannot be reached, once the studio has stopped retrying.
   *
   * Replaces the composer — and the "Connecting…" strip with it — and nothing
   * else. A composer with nothing listening is an invitation to type a question
   * that goes nowhere, with silence as the only feedback; but the conversation
   * above it is still worth reading, and blanking it is not an improvement on a
   * dead input. `authError` is NOT this: being signed out has its own prompt,
   * which is the only thing that can say how to sign in.
   */
  unavailable?: { message: string; onRetry: () => void };
  /** Val server mode — controls which auth instructions to show on authError */
  mode: "http" | "fs" | "unknown";
  /** List of past sessions (fetched on demand) */
  sessions?: AISession[];
  /** The currently active session ID; null when the session is unborn (no message sent yet). */
  currentSessionId?: string | null;
  /** Called to load a previous session */
  onLoadSession?: (sessionId: string) => void;
  /** Called to trigger a sessions fetch */
  onFetchSessions?: () => void;
  /** Called to rename a session */
  onSetSessionName?: (sessionId: string, name: string) => void;
  /** True while a previous session's messages are being fetched from the server. */
  isLoadingSession?: boolean;
  /** Called when the user submits answers to an ask_user_question tool call */
  onAnswerToolQuestions?: (
    toolCallId: string,
    answers: AskUserQuestionAnswer[],
  ) => void;
  /** Called when the user cancels an ask_user_question tool call */
  onCancelToolQuestion?: (toolCallId: string) => void;
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

// HTML-esque tag set that the rich chat editor produces (see
// chatDocumentToHtmlText). Restored sessions arrive as strings containing
// these tags, so we re-render them as formatted React instead of literal text.
//
// Must stay in sync with the cases renderHtmlNode handles - including the
// b/i/s aliases it accepts for strong/em/del. A tag the renderer supports but
// this gate omits makes the whole message fall through and render its markup
// as literal text.
const USER_HTML_TAG_RE =
  /<\/?(?:p|h[1-3]|blockquote|ul|ol|li|strong|b|em|i|del|s|code|br|img|field)\b/i;

function renderHtmlChildren(nodes: ArrayLike<ChildNode>): React.ReactNode[] {
  return Array.from(nodes).map((n, i) => renderHtmlNode(n, i));
}

function renderHtmlNode(node: ChildNode, key: number): React.ReactNode {
  if (node.nodeType === 3 /* TEXT_NODE */) return node.nodeValue ?? "";
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return null;
  const el = node as Element;
  const children = renderHtmlChildren(el.childNodes);
  switch (el.tagName.toLowerCase()) {
    case "p":
      return (
        <p key={key} className="whitespace-pre-wrap">
          {children}
        </p>
      );
    case "h1":
      return (
        <h1 key={key} className="text-base font-semibold">
          {children}
        </h1>
      );
    case "h2":
      return (
        <h2 key={key} className="text-base font-semibold">
          {children}
        </h2>
      );
    case "h3":
      return (
        <h3 key={key} className="text-sm font-semibold">
          {children}
        </h3>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-border-primary pl-2 italic"
        >
          {children}
        </blockquote>
      );
    case "ul":
      return (
        <ul key={key} className="list-disc pl-5">
          {children}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-decimal pl-5">
          {children}
        </ol>
      );
    case "li":
      return <li key={key}>{children}</li>;
    case "strong":
    case "b":
      return <strong key={key}>{children}</strong>;
    case "em":
    case "i":
      return <em key={key}>{children}</em>;
    case "del":
    case "s":
      return <del key={key}>{children}</del>;
    case "code":
      return (
        <code
          key={key}
          className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[0.85em]"
        >
          {children}
        </code>
      );
    case "br":
      return <br key={key} />;
    case "img": {
      const alt = el.getAttribute("alt");
      return (
        <span key={key} className="italic text-fg-secondary">
          [{alt ? `image: ${alt}` : "image"}]
        </span>
      );
    }
    case "field": {
      const path = el.getAttribute("path") ?? "";
      return (
        <span
          key={key}
          className="rounded bg-bg-tertiary px-1 py-0.5 text-fg-brand-primary"
        >
          @{path}
        </span>
      );
    }
    default:
      // Rendered from renderHtmlChildren's map, so this needs a key like every
      // other branch - a shorthand fragment cannot carry one.
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

function renderUserMessageText(text: string): React.ReactNode {
  if (!USER_HTML_TAG_RE.test(text)) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }
  const doc = new DOMParser().parseFromString(
    `<body>${text}</body>`,
    "text/html",
  );
  return <>{renderHtmlChildren(doc.body.childNodes)}</>;
}

// Render a ChatDocument from the rich editor directly to React. Used for
// freshly-sent user messages so inline images keep their preview blob URLs
// (re-parsing HTML would strip the previewUrl off image nodes).
function ChatDocumentRenderer({
  doc,
}: {
  doc: ChatDocument;
}): React.ReactElement {
  return <>{doc.map((block, i) => renderChatBlock(block, i))}</>;
}

function renderChatBlock(block: ChatBlockNode, key: number): React.ReactNode {
  switch (block.tag) {
    case "p":
      return (
        <p key={key} className="whitespace-pre-wrap">
          {block.children.map((c, i) => renderChatInline(c, i))}
        </p>
      );
    case "h1":
      return (
        <h1 key={key} className="text-base font-semibold">
          {block.children.map((c, i) => renderChatInline(c, i))}
        </h1>
      );
    case "h2":
      return (
        <h2 key={key} className="text-base font-semibold">
          {block.children.map((c, i) => renderChatInline(c, i))}
        </h2>
      );
    case "h3":
      return (
        <h3 key={key} className="text-sm font-semibold">
          {block.children.map((c, i) => renderChatInline(c, i))}
        </h3>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-border-primary pl-2 italic"
        >
          {block.children.map((c, i) => renderChatBlock(c, i))}
        </blockquote>
      );
    case "ul":
      return (
        <ul key={key} className="list-disc pl-5">
          {block.children.map((item, i) => (
            <li key={i}>
              {item.children.map((c, j) => renderChatBlock(c, j))}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-decimal pl-5">
          {block.children.map((item, i) => (
            <li key={i}>
              {item.children.map((c, j) => renderChatBlock(c, j))}
            </li>
          ))}
        </ol>
      );
  }
}

function renderChatInline(node: ChatInlineNode, key: number): React.ReactNode {
  if (typeof node === "string") return node;
  if (node.tag === "br") return <br key={key} />;
  if (node.tag === "span") {
    let el: React.ReactNode = node.children[0];
    for (const style of node.styles) {
      if (style === "bold") el = <strong key={key}>{el}</strong>;
      else if (style === "italic") el = <em key={key}>{el}</em>;
      else if (style === "line-through") el = <del key={key}>{el}</del>;
      else if (style === "code")
        el = (
          <code
            key={key}
            className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[0.85em]"
          >
            {el}
          </code>
        );
    }
    return <React.Fragment key={key}>{el}</React.Fragment>;
  }
  if (node.tag === "img") {
    if (node.previewUrl) {
      return (
        <img
          key={key}
          src={node.previewUrl}
          alt={node.alt ?? ""}
          className="inline-block max-h-16 rounded border border-border-primary align-baseline mx-0.5"
        />
      );
    }
    return (
      <span key={key} className="italic text-fg-secondary">
        [{node.alt ? `image: ${node.alt}` : "image"}]
      </span>
    );
  }
  if (node.tag === "field_ref") {
    return (
      <span
        key={key}
        className="rounded bg-bg-tertiary px-1 py-0.5 text-fg-brand-primary"
      >
        @{node.path}
      </span>
    );
  }
  return null;
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
    onCancel,
    onSendMessage,
    onUploadFile,
    onNewSession,
    suggestions = DEFAULT_SUGGESTIONS,
    className,
    isConnected,
    authError,
    unavailable,
    mode,
    sessions,
    currentSessionId,
    onLoadSession,
    onFetchSessions,
    onSetSessionName,
    isLoadingSession,
    onAnswerToolQuestions,
    onCancelToolQuestion,
    initialMessages,
    chatEditorRef: chatEditorRefProp,
  },
  ref,
) {
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>(
    initialMessages ?? [],
  );
  const [currentMessage, setCurrentMessage] = useState<CurrentMessage | null>(
    null,
  );
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);
  const [hasPendingInlineImage, setHasPendingInlineImage] = useState(false);
  const [isAwaitingAssistant, setIsAwaitingAssistant] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalEditorRef = useRef<ChatEditorRef | null>(null);
  const editorRef = chatEditorRefProp ?? internalEditorRef;
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const config = useValConfig();
  const portalContainer = useValPortal();
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

  // Once the assistant message actually starts streaming, drop the
  // "thinking" placeholder so the StreamingCursor takes over.
  useEffect(() => {
    if (currentMessage) setIsAwaitingAssistant(false);
  }, [currentMessage]);

  // 2-minute timeout for in-progress assistant messages. Suspended while an
  // ask_user_question card is open: that tool sets timeoutMs: null server-side
  // precisely because it blocks on the user, so the client must not time out
  // either. The clock is restarted (startedAt is bumped) once the user submits
  // or cancels, so it measures server time, not thinking time.
  const awaitingUserAnswer = (
    currentMessage?.message.toolActivities ?? []
  ).some(isPendingQuestion);

  /**
   * Move the in-progress message into the finished list. Exactly once.
   *
   * The append has to happen from INSIDE the `setCurrentMessage` updater: the
   * message being retired lives in `currentMessage`, and reading it from the
   * render closure instead would drop a chunk that streamed in the same tick.
   * But React may call an updater more than once — twice under `StrictMode`,
   * which the Studio mounts in — so an unconditional append ran twice and every
   * assistant reply appeared TWICE in dev, tool activity and all. Appending by
   * id is what makes it idempotent.
   *
   * `id` of `null` means "whatever is in progress", which is what the timeout
   * wants: it fires for the message it was scheduled for, not for one named by
   * the server.
   */
  const retireCurrentMessage = useCallback(
    (id: string | null, finish: (message: ChatMessage) => ChatMessage) => {
      setCurrentMessage((prev) => {
        if (!prev) return null;
        if (id !== null && prev.message.id !== id) return prev;
        const finished = finish(prev.message);
        setCompletedMessages((msgs) =>
          msgs.some((msg) => msg.id === finished.id)
            ? msgs
            : [...msgs, finished],
        );
        return null;
      });
    },
    [],
  );
  const timedOut = useCallback(
    (message: ChatMessage): ChatMessage => ({
      ...message,
      status: "error",
      error: "Response timed out",
    }),
    [],
  );
  useEffect(() => {
    if (!currentMessage || awaitingUserAnswer) return;
    const remaining = 2 * 60 * 1000 - (Date.now() - currentMessage.startedAt);
    if (remaining <= 0) {
      retireCurrentMessage(currentMessage.message.id, timedOut);
      return;
    }
    const timer = setTimeout(() => {
      retireCurrentMessage(null, timedOut);
    }, remaining);
    return () => clearTimeout(timer);
  }, [currentMessage, awaitingUserAnswer, retireCurrentMessage, timedOut]);

  // ---- Local state mutators (shared by imperative handle and inline UI) ----

  const updateToolActivity = useCallback(
    (
      messageId: string,
      toolCallId: string,
      update: (activity: ToolActivity) => ToolActivity,
    ) => {
      const mapMessage = (msg: ChatMessage): ChatMessage => ({
        ...msg,
        toolActivities: (msg.toolActivities ?? []).map((t) =>
          t.toolCallId === toolCallId ? update(t) : t,
        ),
      });
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== messageId) return prev;
        // Restart the in-progress timeout window from the moment the user
        // acted — see the timeout effect above.
        return { message: mapMessage(prev.message), startedAt: Date.now() };
      });
      // The message may already have been moved to completedMessages (e.g. by
      // an ai_error) while the question card was still open, in which case the
      // card renders from there and needs the same update.
      setCompletedMessages((prev) =>
        prev.some((m) => m.id === messageId)
          ? prev.map((m) => (m.id === messageId ? mapMessage(m) : m))
          : prev,
      );
    },
    [],
  );

  const recordAnswersInState = useCallback(
    (
      messageId: string,
      toolCallId: string,
      answers: AskUserQuestionAnswer[],
    ) => {
      updateToolActivity(messageId, toolCallId, (t) => ({
        ...t,
        status: "complete",
        answers,
      }));
    },
    [updateToolActivity],
  );

  const recordCancelInState = useCallback(
    (messageId: string, toolCallId: string) => {
      updateToolActivity(messageId, toolCallId, (t) => ({
        ...t,
        status: "error",
        cancelled: true,
      }));
    },
    [updateToolActivity],
  );

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
      retireCurrentMessage(id, (message) => ({
        ...message,
        status: "complete",
      }));
    },
    errorAssistantMessage(
      id: string,
      error: string,
      code?: string,
      action?: { label: string; url: string },
    ) {
      retireCurrentMessage(id, (message) => ({
        ...message,
        status: "error",
        error,
        errorAction: action,
        errorCode: code,
      }));
    },
    addToolCall(
      messageId: string,
      toolCallId: string,
      toolName: string,
      questions?: AskUserQuestionItem[],
    ) {
      const activity: ToolActivity = {
        toolCallId,
        name: toolName,
        status: "pending",
        ...(questions ? { questions } : {}),
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
            .catch((err) => {
              console.error("Failed to upload file", {
                fileName: entry.file.name,
                error: err,
              });
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
    (suggestion?: string) => {
      if (isStreaming) return;

      let outgoing: string | ChatDocument;
      let displayText: string;
      let outgoingDoc: ChatDocument | undefined;
      if (suggestion !== undefined) {
        const trimmed = suggestion.trim();
        if (!trimmed) return;
        outgoing = trimmed;
        displayText = trimmed;
      } else {
        const editor = editorRef.current;
        if (!editor || editor.isEmpty()) return;
        const doc = editor.getDocument();
        if (
          collectImageKeysFromDoc(doc).some((k) => k.startsWith("pending:"))
        ) {
          // Image still uploading — Send button should already be disabled,
          // but bail out defensively so a stale pending key never reaches the
          // server (it would 404 when the AI tries to use it).
          return;
        }
        outgoing = doc;
        outgoingDoc = doc;
        displayText = chatDocumentToPlainText(doc);
      }

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

      attachedFiles.forEach((f) => {
        if (f.previewUrl && f.status !== "done")
          URL.revokeObjectURL(f.previewUrl);
      });
      setAttachedFiles([]);

      const msgId = nextId();
      const userMsg: ChatMessage = {
        id: msgId,
        role: "user",
        content: displayText,
        status: "complete",
        attachments: doneAttachments.length > 0 ? doneAttachments : undefined,
        userDoc: outgoingDoc,
      };
      setCompletedMessages((prev) => [...prev, userMsg]);

      if (suggestion === undefined) {
        editorRef.current?.clear();
        setIsEditorEmpty(true);
      }

      const sent = onSendMessage
        ? onSendMessage(
            outgoing,
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
      } else {
        setIsAwaitingAssistant(true);
      }

      requestAnimationFrame(() => editorRef.current?.focus());
    },
    [isStreaming, attachedFiles, onSendMessage, editorRef],
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
        const retryPayload: string | ChatDocument =
          errorMsg.userDoc ?? getTextContent(errorMsg.content);
        const sent = onSendMessage
          ? onSendMessage(retryPayload, errorMsg.attachments)
          : true;
        if (!sent) {
          setCompletedMessages((prev) =>
            prev.map((m) =>
              m.id === errorMsgId
                ? { ...m, status: "error", error: "Failed to send" }
                : m,
            ),
          );
        } else {
          setIsAwaitingAssistant(true);
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
      const retryPayload: string | ChatDocument =
        prevUserMsg.userDoc ?? getTextContent(prevUserMsg.content);
      const sent =
        onSendMessage?.(retryPayload, prevUserMsg.attachments) ?? true;
      if (sent) setIsAwaitingAssistant(true);
    },
    [messages, onSendMessage],
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
                className="text-xs touch:text-sm gap-1"
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
                className="text-xs touch:text-sm gap-1"
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
                className="text-xs touch:text-sm gap-1"
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
                          className="flex-1 text-sm bg-bg-primary border border-border-primary rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-border-focus"
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
        <div className="flex flex-col gap-4 p-4 min-w-0 max-w-full">
          {authError ? (
            <AuthPrompt mode={mode} />
          ) : isLoadingSession && isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-fg-secondary">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading conversation…</span>
            </div>
          ) : isEmpty ? (
            <EmptyState
              suggestions={effectiveSuggestions}
              title={emptyTitle}
              description={emptyDescription}
              onSelect={(s) => handleSend(s)}
            />
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onRetry={handleRetry}
                onSubmitToolAnswers={(toolCallId, answers) => {
                  recordAnswersInState(msg.id, toolCallId, answers);
                  onAnswerToolQuestions?.(toolCallId, answers);
                }}
                onCancelToolQuestion={(toolCallId) => {
                  recordCancelInState(msg.id, toolCallId);
                  onCancelToolQuestion?.(toolCallId);
                }}
              />
            ))
          )}
          {isAwaitingAssistant && !currentMessage && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="shrink-0 border-t border-border-primary bg-bg-primary p-3">
        {unavailable && !authError ? (
          <AIUnavailable {...unavailable} />
        ) : (
          <>
            {!isConnected && !authError && (
              <div className="mb-2 flex items-center justify-center gap-1.5 rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs touch:text-sm text-fg-secondary">
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
                    className="relative flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-secondary px-2 py-1 text-xs touch:text-sm text-fg-primary"
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
                    <span className="max-w-[120px] truncate">
                      {f.file.name}
                    </span>
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
            <div
              className={cn(
                "flex flex-col rounded-md border border-border-primary bg-bg-primary",
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-border-focus",
              )}
            >
              <AIChatEditor
                ref={editorRef}
                disabled={authError || !isConnected || isStreaming}
                placeholder={isConnected && !authError ? "Ask something…" : ""}
                onSubmit={() => handleSend()}
                onUploadAiImage={onUploadFile}
                getPortalContainer={() => portalContainer}
                onChange={(doc) => {
                  const empty =
                    doc.length === 0 ||
                    (doc.length === 1 &&
                      doc[0].tag === "p" &&
                      doc[0].children.length === 0);
                  setIsEditorEmpty(empty);
                  const keys = collectImageKeysFromDoc(doc);
                  setHasPendingInlineImage(
                    keys.some((k) => k.startsWith("pending:")),
                  );
                }}
                className={cn(
                  "max-h-[18rem] overflow-y-auto px-3 pt-3 pb-1",
                  "text-fg-primary text-base",
                )}
              />
              <div className="flex items-center border-t border-border-primary px-2 py-1.5">
                {onUploadFile && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!isConnected || isStreaming || authError}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach files"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                )}
                {isStreaming && onCancel ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onCancel}
                    aria-label="Stop generating"
                    title="Stop generating"
                    className="ml-auto"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={
                      !isConnected ||
                      isStreaming ||
                      isUploading ||
                      hasPendingInlineImage ||
                      authError ||
                      isEditorEmpty
                    }
                    onClick={() => handleSend()}
                    aria-label="Send message"
                    className="ml-auto"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

/**
 * The assistant is not there, and this is what is known about why.
 *
 * The retry matters more than the message: the usual causes are a key missing
 * from the server's config or the AI service being down, both of which can be
 * fixed in another window while this is on screen — and without a button the
 * only way to find out is to reload the studio.
 */
function AIUnavailable({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-md border border-border-primary bg-bg-secondary p-2.5">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-error-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-primary">
            The assistant is unavailable
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-fg-secondary">{message}</p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-2 text-xs"
      >
        Try again
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AuthPrompt({ mode }: { mode: "http" | "fs" | "unknown" }) {
  const isFs = mode === "fs";
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="rounded-full bg-bg-secondary p-3">
        <LogIn className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-fg-primary">
          Login to use AI chat
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          {isFs
            ? "Val is running in development mode. Run this command in your project root to create a personal access token, then refresh:"
            : "Your session has expired. Sign in again to continue."}
        </p>
      </div>
      {isFs ? (
        <div className="w-full text-left">
          <CopyableCodeBlock code="npx -p @valbuild/cli val login" />
        </div>
      ) : (
        <Button asChild variant="default" size="sm">
          <a
            href={urlOf("/api/val/authorize", {
              redirect_to: window.location.href,
            })}
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign in
          </a>
        </Button>
      )}
    </div>
  );
}

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
  onSubmitToolAnswers,
  onCancelToolQuestion,
}: {
  message: ChatMessage;
  onRetry: (id: string) => void;
  onSubmitToolAnswers: (
    toolCallId: string,
    answers: AskUserQuestionAnswer[],
  ) => void;
  onCancelToolQuestion: (toolCallId: string) => void;
}) {
  const isUser = message.role === "user";
  const isError = message.status === "error";
  const isStreamingMsg = message.status === "streaming";
  const activities = message.toolActivities ?? [];
  const hasPendingQuestion = activities.some(isPendingQuestion);
  const hasRunningTool = activities.some(
    (a) => a.status === "pending" && a.questions === undefined,
  );
  const textContent = getTextContent(message.content);
  const fileUrls = getImageUrls(message.content);
  // See aiChatBubble.ts - the rule is subtler than it looks.
  const { hasBubble, showCursor } = decideBubble({
    isUser,
    isError,
    isStreaming: isStreamingMsg,
    hasText: textContent.length > 0,
    hasFiles: fileUrls.length > 0,
    hasRunningTool,
    hasPendingQuestion,
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 min-w-0",
        isUser ? "items-end" : "items-stretch",
      )}
    >
      {/* Tool calls are a row of their own, above the answer - see
          ToolActivities. */}
      {!isUser && activities.length > 0 && (
        <ToolActivities
          activities={activities}
          onSubmitAnswers={onSubmitToolAnswers}
          onCancel={onCancelToolQuestion}
        />
      )}
      {hasBubble && (
        <div
          className={cn(
            "min-w-0 overflow-hidden rounded-lg px-4 py-2.5 text-sm touch:text-base leading-relaxed",
            "[overflow-wrap:anywhere]",
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
              {message.userDoc ? (
                <ChatDocumentRenderer doc={message.userDoc} />
              ) : (
                textContent && renderUserMessageText(textContent)
              )}
            </>
          ) : (
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "[&_pre]:overflow-x-auto [&_pre]:max-w-full",
                "[&_code]:break-words",
                "[&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full",
                "[&_a]:break-all",
              )}
            >
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
              ) : isStreamingMsg ||
                isError ||
                fileUrls.length > 0 ||
                hasPendingQuestion ? null : (
                <p className="text-fg-secondary italic">Empty response</p>
              )}
              {showCursor && <StreamingCursor />}
            </div>
          )}

          {isError && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-fg-error-primary">
                  {message.error ?? "Something went wrong"}
                </p>
                {message.errorAction && safeHref(message.errorAction.url) && (
                  <a
                    href={safeHref(message.errorAction.url)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-fg-brand-primary underline"
                  >
                    {message.errorAction.label}
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
      )}
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

function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary px-4 py-3">
        <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse" />
        <span
          className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse"
          style={{ animationDelay: "300ms" }}
        />
      </div>
    </div>
  );
}
