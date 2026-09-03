/**
 * Whether an assistant turn gets a message bubble, and whether it gets a
 * streaming cursor.
 *
 * A pure function in its own module because the rule is not obvious and has
 * already been got wrong once. When tool calls moved out of the bubble into a
 * row of their own, an empty bubble under that row was noise — so the bubble
 * was skipped whenever there was nothing to put in it. That also silenced the
 * "Empty response" fallback for a FINISHED turn that ran tools and then said
 * nothing, which is the one case where the emptiness is the message: it looked
 * identical to a turn whose tools simply succeeded.
 *
 * So the two are separated. A turn still running its tools has no bubble; a
 * turn that has finished always has one.
 *
 * No imports on purpose: the caller passes booleans, so this stays testable
 * without React and cannot form a cycle with `AIChat.tsx`.
 */
export type BubbleState = {
  /** Render the message bubble at all. */
  hasBubble: boolean;
  /** Render the "…" cursor inside it. */
  showCursor: boolean;
};

export function decideBubble(message: {
  isUser: boolean;
  isError: boolean;
  isStreaming: boolean;
  hasText: boolean;
  hasFiles: boolean;
  /** A tool call, other than a question, is still running. */
  hasRunningTool: boolean;
  /** An `ask_user_question` card is open, so the turn is blocked on the user. */
  hasPendingQuestion: boolean;
}): BubbleState {
  const {
    isUser,
    isError,
    isStreaming,
    hasText,
    hasFiles,
    hasRunningTool,
    hasPendingQuestion,
  } = message;

  // Once a token has landed the cursor belongs at the end of the text. Before
  // that it is redundant with the tool row, which already says "working".
  const showCursor =
    isStreaming && !hasPendingQuestion && (hasText || !hasRunningTool);

  const hasBubble =
    isUser ||
    isError ||
    hasText ||
    hasFiles ||
    showCursor ||
    // A finished turn that is not waiting on the user always gets its bubble,
    // even with nothing in it — that is where "Empty response" is said.
    (!isStreaming && !hasPendingQuestion);

  return { hasBubble, showCursor };
}
