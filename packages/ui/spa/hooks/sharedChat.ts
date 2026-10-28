import type { AIMessagesResponse } from "../components/ValProvider";

/**
 * Reading a proposal's chat that others write in too (valbuild/home
 * `docs/proposals.md`, Flow H), from the messages as the server has them.
 * `useAI` reads the open chat again every few seconds; these decide what that
 * means for the screen.
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
