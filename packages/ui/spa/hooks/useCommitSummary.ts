import { useCallback, useEffect, useRef, useState } from "react";
import { useAIContext } from "../components/ValProvider";
import type { AiSummaryState } from "../components/PublishSummaryView";
import type { AIModel, AIServerMessage } from "./useAIWebSocket";

/**
 * Writes the commit summary through the AI websocket, in its own session.
 *
 * A fresh session per publish, and a hidden one. Fresh because a summary must
 * describe the changes and nothing else — continuing whatever the user was last
 * chatting about would colour it. Hidden because one sidebar entry per publish
 * is noise; it is revealed only if the user asks to see it.
 *
 * No tools. The changes are pushed in the prompt as field paths with before and
 * after values, which is both cheaper than a source diff and the material a
 * summary actually needs. It also has to be that way: tool calls are executed
 * by `useAI`, which is only mounted with the chat UI — a summary session asking
 * for a tool while the publish popover is open on its own would wait for an
 * executor that is not there.
 */

const COMMIT_SUMMARY_SYSTEM_PROMPT = `You write commit messages for a content management system, for readers who are not developers.

Output format:
- First line: a short title, under 80 characters.
- Blank line.
- One to three sentences describing what changed.

Guidance:
- You are given the fields that changed, with their previous and new values. Describe the change in terms of the content, not the fields: "the hero heading now leads with the product name" rather than "hero.title was replaced".
- Be specific. Prefer the concrete user-facing effect over a vague phrase.
- Do not mention field paths, file names, identifiers or types. The reader does not know what those are.
- A heading like "## Home" names the page a change belongs to; use that name if it helps.
- State only what the values show. Never speculate about why ("so that", "to enable").
- Do not repeat the title in the description.
- Where a value was truncated, describe it as far as you can see and do not invent the rest.
- Reply with the commit message only. No preamble, no quoting of these instructions.`;

export type UseCommitSummaryResult = {
  state: AiSummaryState;
  /** Start writing. Safe to call once per mount; later calls are ignored. */
  start: (changeDescription: string) => void;
  /** Stop the request, aborting it on the server so it stops billing. */
  cancel: () => void;
  /**
   * Reveal the session so the user can open it in chat and ask what changed.
   * Resolves to the session id once the server confirms.
   */
  reveal: () => Promise<string | null>;
};

export function useCommitSummary(
  model: AIModel | null,
): UseCommitSummaryResult {
  const { sendWsMessage, subscribeToWsMessages, isWsConnected } =
    useAIContext();
  const [state, setState] = useState<AiSummaryState>({
    status: model === null ? "off" : "idle",
  });
  const promptIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const streamedRef = useRef("");

  // "off" has to be reachable in both directions. `/ai/initialize` resolves
  // after this mounts, so a popover opened straight away sees `model === null`
  // first; leaving it at "off" from then on would tell the user AI is disabled
  // for the rest of the publish, when it had simply not answered yet. Only the
  // "off" state is swapped back, so a summary already loading or ready is never
  // clobbered by a model reference changing identity.
  useEffect(() => {
    setState((prev) => {
      if (model === null) {
        return prev.status === "off" ? prev : { status: "off" };
      }
      return prev.status === "off" ? { status: "idle" } : prev;
    });
  }, [model]);

  useEffect(() => {
    const unsubscribe = subscribeToWsMessages((message: AIServerMessage) => {
      // Every session shares this socket, so anything not ours is somebody
      // else's turn — most likely the chat's.
      if (!("id" in message) || message.id !== promptIdRef.current) {
        return;
      }
      if (message.type === "ai_streaming") {
        streamedRef.current += message.chunk;
        return;
      }
      if (message.type === "ai_response") {
        const text = (message.response || streamedRef.current).trim();
        setState(
          text
            ? { status: "ready", text, sessionId: sessionIdRef.current }
            : {
                status: "failed",
                message: "The AI returned an empty summary.",
              },
        );
        promptIdRef.current = null;
        return;
      }
      if (message.type === "ai_error") {
        setState({
          status: "failed",
          message: message.message,
          canSetUp:
            message.code === "provider_not_configured" ||
            message.code === "byok_invalid_key",
        });
        promptIdRef.current = null;
        return;
      }
      if (message.type === "ai_cancelled") {
        // Cancelling is the user closing the popover or publishing early. There
        // is nothing to report and nothing to show.
        setState({ status: "idle" });
        promptIdRef.current = null;
      }
    });
    return unsubscribe;
  }, [subscribeToWsMessages]);

  const cancel = useCallback(() => {
    const id = promptIdRef.current;
    promptIdRef.current = null;
    if (id !== null) {
      sendWsMessage({ type: "ai_cancel", id });
    }
  }, [sendWsMessage]);

  /**
   * Abort on unmount: the popover closing must not leave a request running on
   * the user's own key with nobody left to read the answer.
   *
   * The cleanup also clears `startedRef`, which matters in development:
   * StrictMode mounts, cleans up, and mounts again, so without it the first
   * mount's prompt was cancelled and the second was refused as already started
   * — a permanent spinner and the full publish grace period, in dev only. The
   * cost is one cancelled prompt per StrictMode mount; in production the
   * popover mounts once and this runs only on a real close.
   */
  useEffect(
    () => () => {
      cancel();
      startedRef.current = false;
    },
    [cancel],
  );

  const start = useCallback(
    (changeDescription: string) => {
      // Nothing to latch until it can actually be sent. Latching first meant a
      // call made before `/ai/initialize` resolved, or during a reconnect, was
      // the only attempt there would ever be — the summary then sat at "off" or
      // "not connected" with nothing to retry it.
      if (startedRef.current || model === null || !isWsConnected) {
        return;
      }
      startedRef.current = true;
      const promptId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      promptIdRef.current = promptId;
      sessionIdRef.current = sessionId;
      streamedRef.current = "";
      setState({ status: "loading" });
      const sent = sendWsMessage({
        type: "ai_prompt",
        id: promptId,
        sessionId,
        hidden: true,
        message: changeDescription,
        maxIterations: 1,
        agents: [
          {
            id: "commit-summary",
            model,
            systemPrompt: COMMIT_SUMMARY_SYSTEM_PROMPT,
            tools: [],
          },
        ],
      });
      if (!sent) {
        promptIdRef.current = null;
        setState({
          status: "failed",
          message: "Could not reach the AI service.",
        });
      }
    },
    [isWsConnected, model, sendWsMessage],
  );

  const reveal = useCallback(async (): Promise<string | null> => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) {
      return null;
    }
    const requestId = crypto.randomUUID();
    return new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, 10000);
      const unsubscribe = subscribeToWsMessages((message: AIServerMessage) => {
        if (!("id" in message) || message.id !== requestId) {
          return;
        }
        clearTimeout(timeout);
        unsubscribe();
        resolve(
          message.type === "ai_session_unhidden" ? message.sessionId : null,
        );
      });
      const sent = sendWsMessage({
        type: "ai_unhide_session",
        id: requestId,
        sessionId,
      });
      if (!sent) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(null);
      }
    });
  }, [sendWsMessage, subscribeToWsMessages]);

  return { state, start, cancel, reveal };
}
