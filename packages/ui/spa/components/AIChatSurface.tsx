import { useEffect, useRef } from "react";
import { VAL_AI_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";
import { AIChat, type AIChatHandle } from "./AIChat";
import { useAI } from "../hooks/useAI";
import { useAIChatActions } from "./AIChatActionsContext";
import { useValMode } from "./ValProvider";
import { useSessionParam } from "./ValRouter";

/**
 * The assistant, wired.
 *
 * `AIChat` is the presentation — messages, composer, the session list — and
 * `useAI` is everything behind it: the socket, and the implementation of every
 * tool the assistant can call. This is the seam that joins them, plus the one
 * piece of bookkeeping neither owns: which conversation the URL is pointing at.
 *
 * It exists as its own component because it used to be inlined in the studio's
 * old right-hand tools column, which meant the assistant lived inside a layout.
 * That layout is gone and the shell renders this in a panel; the next surface
 * will render it somewhere else again. Only the container ever changes, so only
 * the container should have to be written.
 *
 * Mounted only while its container is on screen, which in the shell means while
 * the panel is open. That costs less than it looks: the SOCKET belongs to
 * `ValProvider` and stays up either way, so what is lost on unmount is the
 * transcript on screen — and that is read back from the service by session id.
 * What is genuinely lost is a turn in flight, whose tool calls have nobody to
 * answer them until the panel is open again.
 *
 * NOT the on-page overlay's copy — `ValOverlay` mounts its own `useAI`, because
 * its session id is seeded from `sessionStorage` rather than from the studio's
 * URL, which is how the two hand a conversation back and forth.
 */
export function AIChatSurface({ className }: { className?: string }) {
  const chatRef = useRef<AIChatHandle | null>(null);
  const mode = useValMode();
  const { chatEditorRef, flushPendingFieldRefs } = useAIChatActions();
  const { sessionParam, setSessionParam } = useSessionParam();
  // Read once, on the first render. Later URL changes — a navigation rewriting
  // the query, a `popstate` — must not reach in and swap the conversation the
  // user is in the middle of.
  const initialSessionIdRef = useRef(sessionParam);
  const {
    sendMessage,
    uploadAiImage,
    isConnected,
    authError,
    newSession,
    sessions,
    currentSessionId,
    getSessions,
    setSessionName,
    loadSession,
    isLoadingSession,
    answerToolQuestions,
    cancelToolQuestion,
  } = useAI(chatRef, {
    initialSessionId: initialSessionIdRef.current,
    onSessionBorn: (id) => {
      setSessionParam(id, { replace: true });
      try {
        sessionStorage.setItem(VAL_AI_SESSION_STORAGE_KEY, id);
      } catch {
        // sessionStorage may be disabled — the URL remains the source of truth.
      }
    },
    onSessionCleared: () => {
      setSessionParam(null, { replace: true });
      try {
        sessionStorage.removeItem(VAL_AI_SESSION_STORAGE_KEY);
      } catch {
        // see above
      }
    },
  });

  /**
   * Deliver any field mentioned while this surface was not on screen.
   *
   * "Mention this field" opens the assistant and inserts a reference, and in the
   * shell the first of those two is what MOUNTS the second — so the insert has
   * nowhere to go until the render after it. The queue lives in
   * `AIChatActionsProvider`, which outlives every surface; this is where it is
   * emptied.
   *
   * On a frame rather than in the effect itself, and that is the whole point:
   * `StrictMode` runs mount effects, cleans up, and runs them again, destroying
   * and rebuilding the ProseMirror view in between. Inserting from the effect
   * body put the field into the first view and the second one came up empty —
   * the panel opened, the mention was gone, and nothing reported it. A frame is
   * scheduled by both passes and cancelled by the cleanup between them, so only
   * the surviving editor is written to.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => flushPendingFieldRefs());
    return () => cancelAnimationFrame(frame);
  }, [flushPendingFieldRefs]);

  return (
    <AIChat
      ref={chatRef}
      className={className}
      chatEditorRef={chatEditorRef}
      onSendMessage={sendMessage}
      onUploadFile={uploadAiImage}
      onNewSession={newSession}
      isConnected={isConnected}
      authError={authError}
      mode={mode}
      sessions={sessions}
      currentSessionId={currentSessionId}
      onLoadSession={loadSession}
      onFetchSessions={getSessions}
      onSetSessionName={setSessionName}
      isLoadingSession={isLoadingSession}
      onAnswerToolQuestions={answerToolQuestions}
      onCancelToolQuestion={cancelToolQuestion}
    />
  );
}
