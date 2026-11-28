/**
 * A conversation handed on to another Studio, carried on there by itself, at
 * most once.
 *
 * The `</>` menu takes a code-mode request from the site to the proposal the
 * person chose: another address, another origin, a new page. The
 * conversation goes with it (`?session=`, open: `withConversationOpen`), and
 * so does this: an id (`?val_continue=`) saying the move was a hand-off, so
 * the proposal's Studio sends the message that continues the turn, instead
 * of the person having to ask again.
 *
 * Two rules, and why:
 *
 * - **Only an id travels, never words.** The message is written here, for
 *   the kind of hand-off it is. A message in the address would be a prompt
 *   anyone could put in a link, run by whoever is signed in when they open it.
 * - **At most once, by the conversation itself.** It is sent only while the
 *   conversation still ends on what it continues (the request for code mode):
 *   once continued, the next turn is after it, so a reload, a second tab or
 *   the address opened elsewhere sends nothing. The id, kept once used
 *   (`markContinued`), saves asking; taking it out of the address afterwards
 *   is tidiness, and nothing depends on it.
 */

/** The query parameter that says a Studio was opened to carry a turn on. */
export const CONTINUE_PARAM = "val_continue";

const USED_KEY = "val:continued";
/** Enough for any one person's hand-offs; the oldest go first. */
const KEPT = 50;

/** `url`, carrying the hand-off `id` on. */
export function withContinuation(url: string, id: string): string {
  const next = new URL(url);
  next.searchParams.set(CONTINUE_PARAM, id);
  return next.href;
}

/** The hand-off `url` carries on, or `null`. */
export function continuationOf(url: string): string | null {
  return new URL(url).searchParams.get(CONTINUE_PARAM);
}

/** `url` without it, once it was acted on. */
export function withoutContinuation(url: string): string {
  const next = new URL(url);
  next.searchParams.delete(CONTINUE_PARAM);
  return next.href;
}

function used(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USED_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether this browser already carried hand-off `id` on. */
export function wasContinued(id: string): boolean {
  return used().includes(id);
}

/** Hand-off `id` was carried on here. */
export function markContinued(id: string): void {
  try {
    localStorage.setItem(
      USED_KEY,
      JSON.stringify([...used().filter((u) => u !== id), id].slice(-KEPT)),
    );
  } catch {
    // Storage off: the conversation's own state still keeps it to once.
  }
}

/** A stored message, as far as a hand-off reads it. */
type Said = {
  role: string;
  content?: unknown;
  toolCalls?: { name: string }[];
};

/**
 * The message that carries a code-mode request on, in the proposal
 * `displayName` -- or `null` when it is not due: the conversation's last
 * turn did not ask for code mode, or it was carried on already.
 */
export function codeModeContinuation(
  messages: Said[],
  displayName: string,
): string | null {
  const asked = messages.filter((m) => m.role === "user").at(-1);
  if (asked === undefined) return null;
  if (!asked.toolCalls?.some((call) => call.name === "request_code_mode")) {
    return null;
  }
  return `Code mode is on in “${displayName}”. Carry on with what I asked.`;
}
