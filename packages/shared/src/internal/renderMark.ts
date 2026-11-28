/**
 * Render ids: which change the page in the Studio's preview is showing.
 *
 * A Studio tool that changes what the page shows -- a content edit, a quick
 * preview of staged code, a Build -- answers with a render id. The Studio
 * sends the id to the page (`render` in `valCanvasProtocol.ts`) once the
 * change can be on it, and the page writes it on itself once it shows it
 * (`markRendered`): on its root element, as an attribute, never as text, so
 * only what reads the page as a tool does -- `read_page` -- sees it
 * (`readPageSnapshot`'s `renderId`). `read_page` with `at` waits for that id,
 * or a later one, so the assistant reads the page it changed and not the one
 * before.
 *
 * An id is the Studio's start time and a count, so a later id is a later
 * change, and a Studio opened again (count from 1) still makes later ones
 * than the tab before it.
 */
export const RENDER_ATTRIBUTE = "data-val-render";

const ID = /^r-([0-9a-z]+)-([0-9a-z]+)$/;

/** The id of the `count`th change a Studio started at `startedAt` made. */
export function renderIdOf(startedAt: number, count: number): string {
  return `r-${startedAt.toString(36)}-${count.toString(36)}`;
}

function orderOf(id: string | null): [number, number] | null {
  if (id === null) return null;
  const match = ID.exec(id);
  if (match === null) return null;
  return [parseInt(match[1] ?? "", 36), parseInt(match[2] ?? "", 36)];
}

/** Whether `id` is a later change than `than` (nothing, or not an id: yes). */
export function isLaterRender(id: string, than: string | null): boolean {
  const mine = orderOf(id);
  if (mine === null) return false;
  const theirs = orderOf(than);
  if (theirs === null) return true;
  return mine[0] !== theirs[0] ? mine[0] > theirs[0] : mine[1] > theirs[1];
}

/** Whether the page showing `shown` shows the change `id` (it, or a later one). */
export function rendersAtLeast(shown: string | null, id: string): boolean {
  return shown === id || (shown !== null && isLaterRender(shown, id));
}

/** The page shows the change `id`: written unless it shows a later one. */
export function markRendered(document: Document, id: string): void {
  const root = document.documentElement;
  if (isLaterRender(id, root.getAttribute(RENDER_ATTRIBUTE))) {
    root.setAttribute(RENDER_ATTRIBUTE, id);
  }
}

/** The change the page says it shows, or `null` before it was told any. */
export function readRendered(document: Document): string | null {
  return document.documentElement.getAttribute(RENDER_ATTRIBUTE);
}

/**
 * The event the canvas bridge dispatches on the page's window for each
 * `render` it is told, before it writes the id: `detail` is `{ id, seq }`.
 * The page's provider takes it (`preventDefault()`) when it has to wait for
 * its server-read content to reach `seq` first, and dispatches
 * {@link VAL_RENDER_SHOWN_EVENT} once it has. Not taken -- a page with
 * nothing to wait for -- the bridge writes it at once.
 */
export const VAL_RENDER_EVENT = "val-render";

/** The page shows the change: `detail` is `{ id }`. See {@link VAL_RENDER_EVENT}. */
export const VAL_RENDER_SHOWN_EVENT = "val-render-shown";
