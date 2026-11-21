/**
 * How the Studio's message for its background checks is told from the
 * person's (`checksFollowUp.ts`): it starts with a marker, which survives
 * the round trip through the content server, so a chat loaded later shows it
 * as the notice it was. Here, with nothing imported, for the chat to use.
 */
export const CHECKS_MESSAGE_MARKER = "[Background checks]";

/** Whether a message in the transcript is a follow-up's, not the person's. */
export function isChecksMessage(text: string): boolean {
  return text.startsWith(CHECKS_MESSAGE_MARKER);
}

/** Whether a stored message's content is a follow-up's: a string, or its first text block. */
export function isChecksContent(
  content: string | ReadonlyArray<{ type: string; text?: string }>,
): boolean {
  if (typeof content === "string") return isChecksMessage(content);
  const first = content.find((block) => block.type === "text");
  return first?.text !== undefined && isChecksMessage(first.text);
}

const RIDE_ALONG = /\s*<background_checks>[\s\S]*?<\/background_checks>\s*/g;

/**
 * A person's stored message without the findings that rode along with it
 * (`withRideAlong`): they were for the assistant, not part of what was said.
 */
export function withoutRideAlong<B extends { type: string; text?: string }>(
  content: string | B[],
): string | B[] {
  if (typeof content === "string") return content.replace(RIDE_ALONG, "");
  return content.filter(
    (block) =>
      !(
        block.type === "text" &&
        block.text !== undefined &&
        block.text.trimStart().startsWith("<background_checks>")
      ),
  );
}

/** A follow-up's message without what it says to the assistant: the findings. */
export function stripChecksMessage(text: string): string {
  const start = text.indexOf("\n\n");
  return start === -1 ? text : text.slice(start + 2);
}
