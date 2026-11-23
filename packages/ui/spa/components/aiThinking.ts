/**
 * The model's thinking, summarised, as the content service streams it
 * (`ai_thinking`): what one line of the chat shows of it while a reply is
 * on its way. Only ever the end of it, on one line: it is a sign of work,
 * not something to read back, and it is gone when the answer starts.
 */
const MAX_LENGTH = 140;

export function thinkingTail(thinking: string): string {
  const lines = thinking
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1] ?? "";
  return last.length > MAX_LENGTH ? `…${last.slice(-MAX_LENGTH)}` : last;
}
