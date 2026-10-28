import type { AIChatHandle } from "../components/AIChat";
import type { ProposalParticipant } from "../components/proposals/types";
import type { AIMessagesResponse } from "../components/ValProvider";
import type { AIMessageContentBlock, AIWatchedMessage } from "./useAIWebSocket";

/**
 * Reading a proposal's chat that others write in too (valbuild/home
 * `docs/proposals.md`, Flow H). The content server sends `useAI` every turn
 * of the open chat as it is written (`applyWatchedEvent`); one that does not
 * is read again every few seconds instead (`runningAsker`,
 * `someoneElseAdded`).
 */

type ServerMessage = AIMessagesResponse["messages"][number];

/** Who asked the last, unanswered question, when it is not the viewer. */
export function runningAsker(
  messages: ServerMessage[],
  viewerId: string | null,
): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.authorId) return null;
  return last.authorId === viewerId ? null : last.authorId;
}

/**
 * Whether the server has messages someone else caused: a question they asked,
 * or the answer to one. Only then is the chat shown again; this tab's own
 * question and its answer are on screen already.
 */
export function someoneElseAdded(
  before: ServerMessage[],
  after: ServerMessage[],
  viewerId: string | null,
): boolean {
  if (after.length < before.length) return true;
  let asker: string | null | undefined = undefined;
  for (let i = 0; i < after.length; i++) {
    const m = after[i];
    if (m.role === "user") asker = m.authorId ?? null;
    if (i < before.length) continue;
    if (m.role === "user" || m.role === "assistant") {
      if (asker !== viewerId) return true;
    }
  }
  return false;
}

/** What a watched turn is shown in, and where it has got to. */
export type WatchedChat = {
  chat: Pick<
    AIChatHandle,
    | "appendMessage"
    | "startAssistantMessage"
    | "appendAssistantChunk"
    | "completeAssistantMessage"
    | "errorAssistantMessage"
  > | null;
  /** The watched turn whose answer is on screen as it streams. */
  activeId: { current: string | null };
  /** Watched turns whose question was seen asked, not joined midway. */
  started: Set<string>;
  participantOf: (id: string) => ProposalParticipant;
  setTurnBy: (by: ProposalParticipant | null) => void;
  /**
   * The turn is over: read the chat again, to learn who is in it, and to show
   * it whole when the turn was joined midway (its question never shown, its
   * answer only from where it was when the watch began).
   */
  turnEnded: (joinedMidway: boolean) => void;
};

/**
 * Show a turn someone else asked in the open chat as it is written: their
 * question, then the answer streaming in. Tool calls are never relayed (they
 * ask the asker's Studio to act), so a watched answer is its text alone.
 */
export function applyWatchedEvent(
  event: AIWatchedMessage["event"],
  watched: WatchedChat,
): void {
  const { chat, activeId } = watched;
  /** Start the answer the first time the turn says anything. */
  const openAnswer = (id: string): boolean => {
    if (!chat || activeId.current === id) return false;
    activeId.current = id;
    chat.startAssistantMessage(id);
    return true;
  };
  if (event.type === "ai_turn_started") {
    watched.started.add(event.id);
    const author = watched.participantOf(event.authorId);
    chat?.appendMessage({
      id: `watched-${event.id}`,
      role: "user",
      content: watchedQuestionText(event.message),
      status: "complete",
      author,
    });
    watched.setTurnBy(author);
  } else if (event.type === "ai_streaming") {
    openAnswer(event.id);
    chat?.appendAssistantChunk(event.id, event.chunk);
  } else if (event.type === "ai_response") {
    if (openAnswer(event.id)) {
      chat?.appendAssistantChunk(event.id, event.response);
    }
    chat?.completeAssistantMessage(event.id, {
      outputTokens: event.metadata?.outputTokens,
    });
  } else if (event.type === "ai_cancelled") {
    if (openAnswer(event.id)) {
      chat?.appendAssistantChunk(
        event.id,
        event.partialResponse || "Stopped.",
        { fromModel: false },
      );
    }
    chat?.completeAssistantMessage(event.id, { stopped: true });
  } else if (event.type === "ai_error") {
    openAnswer(event.id);
    chat?.errorAssistantMessage(event.id, event.message, event.code);
  } else if (event.type === "ai_turn_ended") {
    if (activeId.current === event.id) activeId.current = null;
    const joinedMidway = !watched.started.delete(event.id);
    watched.setTurnBy(null);
    watched.turnEnded(joinedMidway);
  } else {
    const _exhaustiveCheck: never = event;
    return _exhaustiveCheck;
  }
}

/**
 * Someone else's question, as they sent it, for the transcript: its text,
 * without the image keys appended for the model (`[Attached images …]`).
 */
export function watchedQuestionText(
  message: string | AIMessageContentBlock[],
): string {
  const text =
    typeof message === "string"
      ? message
      : message
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n\n");
  const attached = text.indexOf("\n\n[Attached images");
  return attached === -1 ? text : text.slice(0, attached);
}
