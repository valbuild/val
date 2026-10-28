import { Internal } from "@valbuild/core";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type RefObject,
  type ReactNode,
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
  ArrowUp,
  Clock,
} from "lucide-react";
import type { AISession } from "../hooks/useAIWebSocket";
import type { AIContentBlock, AIMessageContent } from "./ValProvider";
import { safeHref } from "../utils/safeHref";
import { randomUUID } from "../utils/randomUUID";
import { useComposerFocusRestore } from "./useComposerFocusRestore";
import type { AIModel, AIModelInfo } from "../hooks/useAIWebSocket";
import { useValPortal } from "./ValPortalProvider";
import { urlOf, type PickedElement } from "@valbuild/shared/internal";
import { CopyableCodeBlock } from "./designSystem/CopyableCodeBlock";
import { AIChatEditor } from "./AIChatEditor";
import { AIChatModelPicker } from "./AIChatModelPicker";
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
import { TurnStatsLine } from "./AIChatTurnStats";
import {
  addStreamedText,
  endTurn,
  reportOutputTokens,
  startTurn,
  syncPause,
  turnPhaseOf,
  type TurnStats,
} from "./aiTurnStats";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ToolActivity,
} from "./AIChatToolActivities";
import { Spinner } from "./designSystem/spinner";
import { Avatar } from "./Avatar";
import { PeopleStack } from "./proposals/PeopleStack";
import type { ProposalParticipant } from "./proposals/types";

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
  /**
   * What the provider said, verbatim. Behind a disclosure because it is for
   * whoever is going to do something about it, and reads as noise to everyone
   * else — but findable without a server log, which is the whole point.
   */
  errorDetails?: string;
  toolActivities?: ToolActivity[];
  attachments?: ChatMessageAttachment[];
  /**
   * For user messages composed in the rich editor, the original document so
   * the bubble can render inline images / field refs without re-parsing HTML
   * (which would lose `previewUrl`s for image nodes).
   */
  userDoc?: ChatDocument;
  /**
   * The timer and output tokens shown under an assistant reply. Only on turns
   * this chat watched happen: a restored session's messages have none, and
   * show none.
   */
  turnStats?: TurnStats;
  /**
   * Who wrote a user message, in a chat several people write in. See
   * `AIChatTogether`.
   */
  author?: ProposalParticipant;
};

/**
 * A chat that belongs to a proposal, which everyone on the project can read
 * and continue. valbuild/home `docs/proposals.md`, Flow H.
 *
 * Optional, and nothing changes without it: a chat on the site is the
 * editor's own, and only gets `header` (Work together).
 */
export type AIChatTogether = {
  /** The person looking: their messages say "You". */
  viewerId: string;
  /**
   * The people in this chat. With more than one, user messages are named.
   */
  people: ProposalParticipant[];
  /**
   * Beside "New chat": `ProposalPeopleButton` in a proposal,
   * `WorkTogetherButton` on the site.
   */
  header?: ReactNode;
  /**
   * Who asked the turn that is running, while one is. Someone else's turn
   * cannot be stopped from here, and a message written meanwhile waits in
   * this tab until it is done: a chat has one model conversation, so one
   * question runs at a time.
   */
  turnBy?: ProposalParticipant | null;
  /**
   * In place of the composer, when the chat can be read and not continued: a
   * merged or closed proposal's chats stay with it.
   */
  readOnly?: { message: string; action?: ReactNode };
  /** The chat list, in a proposal: its chats, everyone's. */
  sessionList?: {
    title: string;
    /** By session id. */
    people: Record<string, ProposalParticipant[]>;
    /** Session ids with a turn running now. */
    live?: string[];
    /** Under the list: the way to the editor's own chats on the site. */
    footer?: ReactNode;
  };
};

type AttachedFile = {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  key?: string;
  previewUrl?: string;
};

/**
 * A message on its way: sent now, or held in this tab until someone else's
 * turn ends. `files` are the composer's own attachments, kept as they were so
 * "Don't send" can put everything back; a retry has none to put back.
 */
type QueuedMessage = {
  /** Stable across edits of the queue, for its rows' keys. */
  id: string;
  outgoing: string | ChatDocument;
  displayText: string;
  doc?: ChatDocument;
  attachments?: ChatMessageAttachment[];
  files: (AttachedFile & { key: string })[];
  /**
   * What was taken with it when it was written (`onCaptureSendContext`): the
   * element picked then, not whatever is picked when it is sent.
   */
  context?: SendContext;
};

/**
 * What a message carries besides its text, taken when it is written: the
 * design tab's picked element. `pointedAt: null` sends none, even if
 * something is picked by the time it goes.
 */
export type SendContext = { pointedAt: PickedElement | null };

type CurrentMessage = {
  message: ChatMessage;
  /**
   * The last time anything happened on this turn — a chunk, a tool call or
   * result, a usage report. The timeout counts from here, so it fires on a
   * turn that has gone quiet, not on one that is merely long.
   */
  lastActivityAt: number;
};

export type AIChatHandle = {
  /** Create a new empty assistant message in streaming state */
  startAssistantMessage: (id: string) => void;
  /**
   * Append a token/chunk to the assistant message with the given id.
   * `fromModel: false` is text the Studio writes itself ("Stopped."), which
   * must not be counted as output tokens.
   */
  appendAssistantChunk: (
    id: string,
    chunk: string,
    options?: { fromModel?: boolean },
  ) => void;
  /**
   * Mark the assistant message as complete. `outputTokens` is the server's
   * exact count for the turn; `stopped` says the user ended it.
   */
  completeAssistantMessage: (
    id: string,
    outcome?: { outputTokens?: number; stopped?: boolean },
  ) => void;
  /**
   * The server's output-token count for the turn so far — exact after each
   * model step, or its own running estimate in between.
   */
  reportOutputTokens: (
    id: string,
    outputTokens: number,
    exact: boolean,
  ) => void;
  /** Mark the assistant message as errored */
  errorAssistantMessage: (
    id: string,
    error: string,
    code?: string,
    action?: { label: string; url: string },
    details?: string,
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
  /**
   * Add a finished message to the end of the transcript: someone else's
   * question in a shared chat, as it is asked (see `AIChatTogether`).
   */
  appendMessage: (message: ChatMessage) => void;
};

export type AIChatProps = {
  /**
   * Stop the running turn. When given, the send button becomes a stop button
   * while the assistant is streaming — the same control, because the two are
   * never both available and one of them is always the thing you want.
   */
  onCancel?: () => void;
  /**
   * The models this project's keys can actually reach, as the providers report
   * them. Empty hides the picker: with nothing to choose between, a control
   * that shows one option is noise.
   */
  models?: AIModelInfo[];
  selectedModel?: AIModel | null;
  onSelectModel?: (model: AIModel) => void;
  /**
   * The open chat has started, so `selectedModel` is the model it keeps: shown,
   * not offered. A new chat is where another model is picked.
   */
  modelLocked?: boolean;
  /** Called when the user submits a message (via input or suggestion chip). Returns true if sent successfully. */
  onSendMessage?: (
    content: string | ChatDocument,
    attachments?: ChatMessageAttachment[],
    context?: SendContext,
  ) => boolean;
  /**
   * Take what goes with a message that is QUEUED rather than sent -- the
   * design tab's picked element -- so it goes with that message when it is
   * sent, not with whichever message is sent next.
   */
  onCaptureSendContext?: () => SendContext;
  /** Called to upload a file to the current AI session. Returns the server key. */
  onUploadFile?: (file: File) => Promise<{ key: string }>;
  /** Shared ref to the inner rich text editor (used by Field.tsx to insert field references). */
  chatEditorRef?: RefObject<ChatEditorRef | null>;
  /** Called when the user clicks "New Chat" to start a fresh session */
  onNewSession?: () => void;
  /** Prompt suggestion chips shown on the empty state */
  suggestions?: string[];
  /**
   * Shown instead of the empty state, when there is something to do before
   * a conversation can start — no AI key, and the AI setup to add one.
   */
  emptyStateOverride?: ReactNode;
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
  /** A chat several people work in: see `AIChatTogether`. */
  together?: AIChatTogether;
  /**
   * @internal – seed messages for Storybook / testing only.
   * Not part of the public API.
   */
  initialMessages?: ChatMessage[];
  /**
   * @internal – open on the chat list, for Storybook / testing only.
   */
  initialShowSessions?: boolean;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** How long a turn may go without any activity before it is given up on. */
const TURN_TIMEOUT_MS = 2 * 60 * 1000;

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
    models,
    selectedModel,
    onSelectModel,
    modelLocked,
    onSendMessage,
    onCaptureSendContext,
    onUploadFile,
    onNewSession,
    suggestions = DEFAULT_SUGGESTIONS,
    emptyStateOverride,
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
    initialShowSessions = false,
    together,
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
  /**
   * When the prompt now waiting for its first reply was sent, or `null`.
   *
   * A time rather than a flag because the turn's clock starts here, at send,
   * not when the server's first message arrives — the wait for that first
   * message is exactly the "Thinking…" time worth showing. The ref is for the
   * imperative handle, which must not read it from a stale render.
   */
  const [awaitingSince, setAwaitingSinceState] = useState<number | null>(null);
  const awaitingSinceRef = useRef<number | null>(null);
  const setAwaitingSince = useCallback((since: number | null) => {
    awaitingSinceRef.current = since;
    setAwaitingSinceState(since);
  }, []);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalEditorRef = useRef<ChatEditorRef | null>(null);
  const editorRef = chatEditorRefProp ?? internalEditorRef;
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showSessions, setShowSessions] = useState(initialShowSessions);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const portalContainer = useValPortal();

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

  // Once the assistant message exists, its own status line takes over from
  // the placeholder one, carrying the same start time.
  useEffect(() => {
    if (currentMessage) setAwaitingSince(null);
  }, [currentMessage, setAwaitingSince]);

  // 2-minute INACTIVITY timeout for in-progress assistant messages: it counts
  // from the turn's last activity, so a long turn that keeps streaming, calling
  // tools or reporting usage is never cut off — only one that has gone silent.
  // It used to count from the start of the turn, which ended every turn longer
  // than two minutes with "Response timed out" and dropped the reply that
  // arrived after. Suspended while an ask_user_question card is open: that tool
  // sets timeoutMs: null server-side precisely because it blocks on the user,
  // so the client must not time out either.
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
        const now = Date.now();
        const settled = finish(prev.message);
        // Every way out stops the clock — the timeout and an error as much as
        // a reply. `finish` may already have ended it with a count, and
        // `endTurn` leaves an ended turn alone.
        const finished: ChatMessage = settled.turnStats
          ? { ...settled, turnStats: endTurn(settled.turnStats, now) }
          : settled;
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
    const remaining =
      TURN_TIMEOUT_MS - (Date.now() - currentMessage.lastActivityAt);
    if (remaining <= 0) {
      retireCurrentMessage(currentMessage.message.id, timedOut);
      return;
    }
    const timer = setTimeout(() => {
      retireCurrentMessage(null, timedOut);
    }, remaining);
    return () => clearTimeout(timer);
  }, [currentMessage, awaitingUserAnswer, retireCurrentMessage, timedOut]);

  // The same timeout for a turn the server has not answered at all. Until its
  // first message there is no current message for the effect above to watch,
  // so a prompt met with silence used to wait forever — with the status line
  // counting "Thinking…" up the whole time. It settles as a failed turn of its
  // own; a reply that does turn up later still starts a message, as one
  // arriving after the timeout above does.
  useEffect(() => {
    if (awaitingSince === null || currentMessage) return;
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setAwaitingSince(null);
        setCompletedMessages((msgs) => [
          ...msgs,
          {
            id: randomUUID(),
            role: "assistant",
            content: "",
            status: "error",
            error: "Response timed out",
            turnStats: endTurn(startTurn(awaitingSince), now),
          },
        ]);
      },
      Math.max(0, TURN_TIMEOUT_MS - (Date.now() - awaitingSince)),
    );
    return () => clearTimeout(timer);
  }, [awaitingSince, currentMessage, setAwaitingSince]);

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
        const now = Date.now();
        return {
          message: withPauseSynced(mapMessage(prev.message), now),
          lastActivityAt: now,
        };
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
      const now = Date.now();
      setCurrentMessage({
        message: {
          id,
          role: "assistant",
          content: "",
          status: "streaming",
          turnStats: startTurn(awaitingSinceRef.current ?? now),
        },
        lastActivityAt: now,
      });
    },
    appendAssistantChunk(
      id: string,
      chunk: string,
      options?: { fromModel?: boolean },
    ) {
      const fromModel = options?.fromModel ?? true;
      setCurrentMessage((prev) =>
        prev?.message.id === id
          ? {
              lastActivityAt: Date.now(),
              message: {
                ...prev.message,
                content: getTextContent(prev.message.content) + chunk,
                turnStats:
                  prev.message.turnStats && fromModel
                    ? addStreamedText(prev.message.turnStats, chunk)
                    : prev.message.turnStats,
              },
            }
          : prev,
      );
    },
    completeAssistantMessage(
      id: string,
      outcome?: { outputTokens?: number; stopped?: boolean },
    ) {
      retireCurrentMessage(id, (message) => ({
        ...message,
        status: "complete",
        turnStats:
          message.turnStats && endTurn(message.turnStats, Date.now(), outcome),
      }));
    },
    reportOutputTokens(id: string, outputTokens: number, exact: boolean) {
      setCurrentMessage((prev) =>
        prev?.message.id === id && prev.message.turnStats
          ? {
              lastActivityAt: Date.now(),
              message: {
                ...prev.message,
                turnStats: reportOutputTokens(
                  prev.message.turnStats,
                  outputTokens,
                  exact,
                ),
              },
            }
          : prev,
      );
    },
    errorAssistantMessage(
      id: string,
      error: string,
      code?: string,
      action?: { label: string; url: string },
      details?: string,
    ) {
      retireCurrentMessage(id, (message) => ({
        ...message,
        status: "error",
        error,
        errorAction: action,
        errorCode: code,
        errorDetails: details,
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
            lastActivityAt: Date.now(),
            message: withPauseSynced(
              {
                ...prev.message,
                toolActivities: [
                  ...(prev.message.toolActivities ?? []),
                  activity,
                ],
              },
              Date.now(),
            ),
          };
        }
        return prev;
      });
    },
    completeToolCall(messageId: string, toolCallId: string) {
      setCurrentMessage((prev) => {
        if (!prev || prev.message.id !== messageId) return prev;
        return {
          lastActivityAt: Date.now(),
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
          lastActivityAt: Date.now(),
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
    appendMessage(message: ChatMessage) {
      setCompletedMessages((prev) => [...prev, message]);
    },
  }));

  // ---- Derived state ----

  const isStreaming = currentMessage !== null;
  const isUploading = attachedFiles.some((f) => f.status === "uploading");
  const isEmpty = messages.length === 0;
  const viewerId = together?.viewerId ?? null;
  const viewer = together?.people.find((p) => p.id === viewerId) ?? null;
  const turnBy = together?.turnBy ?? null;
  /**
   * Someone else asked the turn that is running. It streams here as it does
   * for them, but it is not this tab's to stop, and writing is not blocked by
   * it: what is sent waits for it (`queued`).
   */
  const othersTurn = turnBy !== null && turnBy.id !== viewerId;
  /** Names on messages only once there is more than one person to tell apart. */
  const showAuthors = (together?.people.length ?? 0) > 1;
  /** This tab's own turn is the one running. */
  const ownTurnRunning = isStreaming && !othersTurn;
  /**
   * What was written while a turn ran: sent one per turn, in order, once the
   * turn before has ended. Writing is never blocked by a turn.
   */
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  /**
   * The queue waits for the person: they pressed Stop, or the turn before
   * failed. Sending the next one into whatever went wrong would only repeat
   * it, so they choose (`Send next`, `Clear`).
   */
  const [queueStopped, setQueueStopped] = useState(false);
  const composerDisabled = authError || !isConnected;

  const focusComposer = useCallback(() => {
    editorRef.current?.focus();
  }, [editorRef]);
  // The caret goes back into the composer when the answer lands - see
  // `useComposerFocusRestore` for why it is armed at send time.
  const { armForSend } = useComposerFocusRestore(
    composerDisabled,
    focusComposer,
  );

  // ---- Handlers ----

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      // Reset input so the same file can be re-selected
      e.target.value = "";

      const newEntries: AttachedFile[] = files.map((file) => ({
        id: randomUUID(),
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
              Internal.log.error("Failed to upload file", {
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

  /**
   * Put a message in the transcript and send it. From `handleSend`, or from
   * the queue once someone else's turn has ended.
   */
  const deliver = useCallback(
    (message: QueuedMessage) => {
      const { attachments } = message;
      const msgId = nextId();
      const userMsg: ChatMessage = {
        id: msgId,
        role: "user",
        content: message.displayText,
        status: "complete",
        attachments,
        userDoc: message.doc,
        ...(viewer ? { author: viewer } : {}),
      };
      setCompletedMessages((prev) => [...prev, userMsg]);

      const sent = onSendMessage
        ? message.context !== undefined
          ? onSendMessage(message.outgoing, attachments, message.context)
          : onSendMessage(message.outgoing, attachments)
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
        setAwaitingSince(Date.now());
        // Streaming is about to disable the composer, which blurs it. Ask for
        // the caret back once the answer lands.
        armForSend();
      }
    },
    [viewer, onSendMessage, setAwaitingSince, armForSend],
  );

  /**
   * A turn is running, or a sent message has had no reply yet: what is
   * written now waits in the queue.
   */
  const busy = isStreaming || othersTurn || awaitingSince !== null;

  /** The turn before ended in an error: the queue waits for the person. */
  const lastMessage = messages[messages.length - 1];
  const lastFailed =
    lastMessage !== undefined && lastMessage.status === "error" && !busy;
  const queuePaused = queueStopped || lastFailed;

  const handleSend = useCallback(
    (suggestion?: string) => {
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

      const doneFiles = attachedFiles.filter(
        (f): f is AttachedFile & { key: string } =>
          f.status === "done" && f.key !== undefined,
      );

      attachedFiles.forEach((f) => {
        if (f.previewUrl && f.status !== "done")
          URL.revokeObjectURL(f.previewUrl);
      });
      setAttachedFiles([]);

      if (suggestion === undefined) {
        editorRef.current?.clear();
        setIsEditorEmpty(true);
      }

      const message: QueuedMessage = {
        id: randomUUID(),
        outgoing,
        displayText,
        doc: outgoingDoc,
        attachments:
          doneFiles.length > 0
            ? doneFiles.map(
                (f): ChatMessageAttachment => ({
                  key: f.key,
                  name: f.file.name,
                  mimeType: f.file.type || undefined,
                  previewUrl: f.previewUrl,
                }),
              )
            : undefined,
        files: doneFiles,
      };
      // Behind what is already waiting, in the order it was written -- unless
      // the queue is paused: then what is written now is what the person
      // wants sent, and it goes straight away.
      if (busy || (queue.length > 0 && !queuePaused)) {
        // Taken here, at the press, not in the updater: taking it clears
        // the pick, which is another component's state.
        const queued: QueuedMessage = onCaptureSendContext
          ? { ...message, context: onCaptureSendContext() }
          : message;
        setQueue((prev) => [...prev, queued]);
        requestAnimationFrame(() => editorRef.current?.focus());
        return;
      }
      deliver(message);

      requestAnimationFrame(() => editorRef.current?.focus());
    },
    [
      busy,
      queue.length,
      queuePaused,
      attachedFiles,
      editorRef,
      deliver,
      onCaptureSendContext,
    ],
  );

  /**
   * Send the next queued message once the turn before has ended. Never
   * merged into the running turn: it was written before its answer was read.
   */
  useEffect(() => {
    if (queue.length === 0 || busy || queuePaused || !isConnected) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    deliver(next);
  }, [queue, busy, queuePaused, isConnected, deliver]);

  /** Send the next queued message now: after a Stop or a failed turn. */
  const sendNext = useCallback(() => {
    if (queue.length === 0 || busy) return;
    setQueueStopped(false);
    const [next, ...rest] = queue;
    setQueue(rest);
    deliver(next);
  }, [queue, busy, deliver]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setQueueStopped(false);
  }, []);

  const stopTurn = useCallback(() => {
    // What was queued behind the turn waits: Stop is "not like that", and
    // the next message was written before the person saw why.
    if (queue.length > 0) setQueueStopped(true);
    onCancel?.();
  }, [queue.length, onCancel]);

  const removeQueued = useCallback((id: string) => {
    setQueue((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const moveQueuedUp = useCallback((id: string) => {
    setQueue((prev) => {
      const index = prev.findIndex((m) => m.id === id);
      if (index <= 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  /**
   * "Edit": the message comes out of the queue and back into the composer,
   * files and all. Only into an empty composer, so nothing being written is
   * overwritten.
   */
  const editQueued = useCallback(
    (id: string) => {
      const message = queue.find((m) => m.id === id);
      if (message === undefined || !isEditorEmpty) return;
      setQueue((prev) => prev.filter((m) => m.id !== id));
      editorRef.current?.setDocument(
        message.doc ?? [{ tag: "p", children: [message.displayText] }],
      );
      setIsEditorEmpty(false);
      setAttachedFiles((prev) => [...message.files, ...prev]);
      requestAnimationFrame(() => editorRef.current?.focus());
    },
    [queue, isEditorEmpty, editorRef],
  );

  const handleRetry = useCallback(
    (errorMsgId: string) => {
      const errorMsg = messages.find((m) => m.id === errorMsgId);

      /**
       * In a chat several people write in, a retry is a new message from
       * whoever pressed it: "Kari left before the answer was done" is asked
       * again in this person's name, not resent as Kari's. And it waits for
       * someone else's running turn, like anything else they send.
       */
      const askAgain = (source: ChatMessage, removeId: string) => {
        setCompletedMessages((prev) => prev.filter((m) => m.id !== removeId));
        const message: QueuedMessage = {
          id: randomUUID(),
          outgoing: source.userDoc ?? getTextContent(source.content),
          displayText: getTextContent(source.content),
          doc: source.userDoc,
          attachments: source.attachments,
          files: [],
        };
        if (othersTurn) setQueue((prev) => [...prev, message]);
        else deliver(message);
      };

      // Retry a failed user message (WebSocket send error)
      if (errorMsg?.role === "user") {
        if (othersTurn) {
          askAgain(errorMsg, errorMsgId);
          return;
        }
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
          setAwaitingSince(Date.now());
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
      if (
        othersTurn ||
        (prevUserMsg.author !== undefined && prevUserMsg.author.id !== viewerId)
      ) {
        askAgain(prevUserMsg, errorMsgId);
        return;
      }

      // Remove the errored assistant message
      setCompletedMessages((prev) => prev.filter((m) => m.id !== errorMsgId));
      const retryPayload: string | ChatDocument =
        prevUserMsg.userDoc ?? getTextContent(prevUserMsg.content);
      const sent =
        onSendMessage?.(retryPayload, prevUserMsg.attachments) ?? true;
      if (sent) setAwaitingSince(Date.now());
    },
    [messages, onSendMessage, setAwaitingSince, othersTurn, deliver, viewerId],
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
      {(!isEmpty || onFetchSessions || together?.header) && (
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
          <div className="flex items-center gap-1">
            {together?.header}
            {!isEmpty && onNewSession && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onNewSession}
                disabled={ownTurnRunning}
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
            <span className="text-sm font-medium flex-1 truncate">
              {together?.sessionList?.title ?? "Chat history"}
            </span>
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
                      {!isRenaming && together?.sessionList && (
                        <SessionPeople
                          people={together.sessionList.people[session.id]}
                          live={
                            together.sessionList.live?.includes(session.id) ??
                            false
                          }
                        />
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
            {together?.sessionList?.footer && (
              <div className="border-t border-border-primary">
                {together.sessionList.footer}
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
              <Spinner size={20} />
              <span className="text-sm">Loading conversation…</span>
            </div>
          ) : isEmpty && emptyStateOverride !== undefined ? (
            emptyStateOverride
          ) : isEmpty ? (
            <EmptyState
              suggestions={suggestions}
              onSelect={(s) => handleSend(s)}
            />
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                author={
                  showAuthors && msg.role === "user" && msg.author
                    ? {
                        person: msg.author,
                        isViewer: msg.author.id === viewerId,
                      }
                    : undefined
                }
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
          {awaitingSince !== null && !currentMessage && (
            <TurnStatsLine
              className="px-1"
              stats={startTurn(awaitingSince)}
              phase="thinking"
            />
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="shrink-0 border-t border-border-primary bg-bg-primary p-3">
        {unavailable && !authError ? (
          <AIUnavailable {...unavailable} />
        ) : together?.readOnly ? (
          <div className="flex items-center gap-2 rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-xs touch:text-sm text-fg-secondary">
            <span className="min-w-0 flex-1">{together.readOnly.message}</span>
            {together.readOnly.action}
          </div>
        ) : (
          <>
            {!isConnected && !authError && (
              <div className="mb-2 flex items-center justify-center gap-1.5 rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs touch:text-sm text-fg-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-fg-secondary animate-pulse" />
                Connecting…
              </div>
            )}
            {othersTurn && turnBy && (
              <OthersTurnStrip turnBy={turnBy} queued={queue.length} />
            )}
            {queue.length > 0 && (
              <QueuedMessages
                queue={queue}
                paused={
                  queuePaused
                    ? lastFailed
                      ? "The last answer failed, so these wait for you."
                      : "Stopped, so these wait for you."
                    : null
                }
                canEdit={isEditorEmpty}
                onEdit={editQueued}
                onRemove={removeQueued}
                onMoveUp={moveQueuedUp}
                onSendNext={busy ? null : sendNext}
                onClear={clearQueue}
              />
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
                      <Spinner size={12} className="text-fg-secondary" />
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
                disabled={composerDisabled}
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
              <div className="flex items-center gap-1 border-t border-border-primary px-2 py-1.5">
                {onUploadFile && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!isConnected || authError}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach files"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                )}
                {/*
                  Beside the composer rather than in a settings panel: which
                  model answers is a per-message decision — a cheap one for a
                  quick edit, a strong one for a hard question — so it belongs
                  where the message is written.
                */}
                {models && onSelectModel && (
                  <AIChatModelPicker
                    models={models}
                    selectedModel={selectedModel}
                    onSelectModel={onSelectModel}
                    // Someone else's turn has its asker's model; the next
                    // message, waiting for it or not, is this person's.
                    disabled={ownTurnRunning}
                    locked={modelLocked}
                    portalContainer={portalContainer}
                  />
                )}
                <span className="ml-auto flex items-center gap-1">
                  {(!ownTurnRunning || !isEditorEmpty) && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={
                        !isConnected ||
                        isUploading ||
                        hasPendingInlineImage ||
                        authError ||
                        isEditorEmpty
                      }
                      onClick={() => handleSend()}
                      aria-label={
                        busy || queue.length > 0
                          ? "Send when the answer is done"
                          : "Send message"
                      }
                      title={
                        busy || queue.length > 0
                          ? "Send when the answer is done"
                          : undefined
                      }
                    >
                      {busy || queue.length > 0 ? (
                        <Clock className="h-4 w-4" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  {ownTurnRunning && onCancel && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={stopTurn}
                      aria-label="Stop generating"
                      title="Stop generating"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  )}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

/**
 * Someone else's question is running. Their turn holds the chat until it
 * ends; what this person writes meanwhile is sent after it, never into it.
 */
function OthersTurnStrip({
  turnBy,
  queued,
}: {
  turnBy: ProposalParticipant;
  /** How many of this person's messages wait for it. */
  queued: number;
}) {
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs touch:text-sm text-fg-secondary"
    >
      <Avatar name={turnBy.name} imageUrl={turnBy.avatarUrl} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg-primary">{turnBy.name}</span> is
        asking.{" "}
        {queued === 0
          ? "Yours is sent when the answer is done."
          : queued === 1
            ? "Then yours."
            : `Then yours, ${queued} of them, in order.`}
      </span>
    </div>
  );
}

/**
 * What was written while a turn ran, waiting to be sent one per turn. Each
 * can be taken back to edit, moved up or dropped; a paused queue says why and
 * offers to go on.
 */
function QueuedMessages({
  queue,
  paused,
  canEdit,
  onEdit,
  onRemove,
  onMoveUp,
  onSendNext,
  onClear,
}: {
  queue: QueuedMessage[];
  /** Why it is waiting for the person; `null` while it goes on by itself. */
  paused: string | null;
  /** Edit puts a message back into the composer: only into an empty one. */
  canEdit: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  /** `null` while a turn runs: the next is sent when it ends. */
  onSendNext: (() => void) | null;
  onClear: () => void;
}) {
  return (
    <section
      aria-label="Queued messages"
      className="mb-2 rounded-md border border-border-primary bg-bg-secondary text-xs touch:text-sm"
    >
      <div className="flex items-center gap-2 px-2 pt-1.5 text-fg-secondary">
        <Clock className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1">
          {paused ??
            (queue.length === 1
              ? "Sent when the answer is done."
              : `${queue.length} queued, sent one at a time.`)}
        </span>
        {paused !== null && onSendNext !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSendNext}
            className="h-6 shrink-0 px-2 text-xs"
          >
            Send next
          </Button>
        )}
        {queue.length > 1 || paused !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-6 shrink-0 px-2 text-xs"
          >
            Clear
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col py-1">
        {queue.map((message, index) => (
          <li
            key={message.id}
            className="group flex items-center gap-1.5 px-2 py-0.5"
          >
            <span className="w-3 shrink-0 text-right tabular-nums text-fg-tertiary">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-fg-primary">
              {truncate(message.displayText, 120)}
            </span>
            {message.context?.pointedAt && (
              <span
                className="shrink-0 rounded bg-bg-primary px-1 font-mono text-[10px] text-fg-tertiary"
                title="The element picked when this was written goes with it"
              >
                &lt;{message.context.pointedAt.tag}&gt;
              </span>
            )}
            <button
              type="button"
              onClick={() => onEdit(message.id)}
              disabled={!canEdit}
              aria-label="Take back to edit"
              title={
                canEdit
                  ? "Take it back to edit"
                  : "Send or clear what you are writing first"
              }
              className="shrink-0 rounded px-1 text-fg-secondary hover:bg-bg-primary hover:text-fg-primary disabled:text-fg-disabled"
            >
              Edit
            </button>
            {index > 0 && (
              <button
                type="button"
                onClick={() => onMoveUp(message.id)}
                aria-label="Move up"
                title="Move up"
                className="shrink-0 rounded p-0.5 text-fg-secondary hover:bg-bg-primary hover:text-fg-primary"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(message.id)}
              aria-label="Remove from the queue"
              title="Remove from the queue"
              className="shrink-0 rounded p-0.5 text-fg-secondary hover:bg-bg-primary hover:text-fg-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A chat's people in a proposal's chat list, and whether a turn is running. */
function SessionPeople({
  people,
  live,
}: {
  people: ProposalParticipant[] | undefined;
  live: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      {people && <PeopleStack people={people} max={2} />}
      {live && (
        <span className="flex items-center gap-1 text-xs text-fg-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-fg-brand-primary animate-pulse" />
          live
        </span>
      )}
    </span>
  );
}

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
  onSelect,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="rounded-full  p-3">
        <Sparkles className="h-8 w-8" />
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
  author,
  onRetry,
  onSubmitToolAnswers,
  onCancelToolQuestion,
}: {
  message: ChatMessage;
  /** Who wrote it, in a chat several people write in. */
  author?: { person: ProposalParticipant; isViewer: boolean };
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
  const turnStats = isUser ? undefined : message.turnStats;
  // See aiChatBubble.ts - the rule is subtler than it looks.
  const { hasBubble, showCursor } = decideBubble({
    isUser,
    isError,
    isStreaming: isStreamingMsg,
    hasText: textContent.length > 0,
    hasFiles: fileUrls.length > 0,
    hasRunningTool,
    hasPendingQuestion,
    hasStatusLine: turnStats !== undefined,
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 min-w-0",
        // Someone else's message is on the left, as in any chat with more
        // than two parties: the right side is "you".
        !isUser
          ? "items-stretch"
          : author && !author.isViewer
            ? "items-start"
            : "items-end",
      )}
    >
      {author && (
        <span className="flex items-center gap-1.5 px-1 text-xs text-fg-secondary">
          {!author.isViewer && (
            <Avatar
              name={author.person.name}
              imageUrl={author.person.avatarUrl}
              size="xs"
              className="h-5 w-5"
            />
          )}
          {author.isViewer ? "You" : author.person.name}
        </span>
      )}
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
                {/*
                  A plain `<details>`: closed by default, so it costs nothing to
                  everyone who cannot act on it, and one click for whoever can.
                  No component needed, and it works with find-in-page once open.
                */}
                {message.errorDetails && (
                  <details className="text-xs text-fg-secondary">
                    <summary className="cursor-pointer select-none">
                      Details
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-secondary p-2 font-mono text-[11px] text-fg-secondary">
                      {message.errorDetails}
                    </pre>
                  </details>
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
      {turnStats && (
        <TurnStatsLine
          className="px-1"
          stats={turnStats}
          phase={turnPhaseOf({
            status: message.status,
            stopped: turnStats.stopped,
            waitingOnUser: hasPendingQuestion,
            hasRunningTool,
            hasText: textContent.length > 0,
          })}
        />
      )}
    </div>
  );
}

/**
 * Pause the turn's clock while a question card is open, and resume it once
 * the card is answered or cancelled — applied after every change to a
 * message's tools, so no caller has to track the transition itself.
 */
function withPauseSynced(message: ChatMessage, now: number): ChatMessage {
  if (!message.turnStats) return message;
  return {
    ...message,
    turnStats: syncPause(
      message.turnStats,
      (message.toolActivities ?? []).some(isPendingQuestion),
      now,
    ),
  };
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
