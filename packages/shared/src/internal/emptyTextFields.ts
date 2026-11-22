/**
 * Keeping an emptied text pointable while Select is on.
 *
 * A heading whose field was emptied is still on the page --
 * `<h1 data-val-path="…"></h1>` -- with a height of nothing, so there is
 * nothing to click: the field cannot be picked again, and in Select & edit
 * cannot be typed back in. Its row stays in the Studio's column
 * (`useRetainedCanvasPaths`), but the page is where people point.
 *
 * So, while Select is on, such an element is marked
 * ({@link EMPTY_TEXT_ATTRIBUTE}) and the bridge's picking stylesheet gives it
 * one line of room: a minimum height for a block, a little padding for an
 * inline element, whose height is its line's already.
 *
 * That is the one rule of the picking stylesheet that moves the page, which
 * otherwise insists on outlines because they cannot. Decided so, and kept
 * narrow, because the alternative is a field that cannot be reached from the
 * page at all:
 *
 * - only while Select is on: the page is laid out as built the rest of the
 *   time;
 * - only an element showing a field the Studio says is a string or a richtext
 *   that is empty NOW (`textFields`): the page cannot tell a text from
 *   anything else, and a spacer, an image or an input showing a non-empty
 *   field is never touched;
 * - never an element that is empty by nature (an `img`, an `input`, a
 *   `<source>`...), whatever field it carries;
 * - and only while the element itself shows nothing: once typed in, it is
 *   laid out by what it holds again.
 *
 * The room it gets is the room it will take once it holds a line of text, so
 * the page moves by what typing in it would move it by anyway.
 */

/** On an emptied text while Select is on: `block` or `inline`. */
export const EMPTY_TEXT_ATTRIBUTE = "data-val-empty-text";

/**
 * Elements that hold no text whatever field is on them: replaced and void
 * elements, and the media ones whose box is their parent's.
 */
const EMPTY_BY_NATURE: ReadonlySet<string> = new Set([
  "AREA",
  "AUDIO",
  "BR",
  "CANVAS",
  "EMBED",
  "HR",
  "IFRAME",
  "IMG",
  "INPUT",
  "LINK",
  "META",
  "OBJECT",
  "PICTURE",
  "SCRIPT",
  "SELECT",
  "SOURCE",
  "STYLE",
  "TEMPLATE",
  "TEXTAREA",
  "TRACK",
  "VIDEO",
  "WBR",
]);

/**
 * Mark what shows one of `empty` and nothing else, and unmark everything
 * else. `empty` is the Studio's empty text fields, or nothing to unmark all.
 * Safe to call as often as the page is scanned: an element already marked
 * keeps its mark, so its own room never decides whether it has room.
 */
export function markEmptyTextFields(
  root: ParentNode,
  empty: ReadonlySet<string>,
  pathsOf: (attribute: string) => readonly string[],
): void {
  root.querySelectorAll(`[${EMPTY_TEXT_ATTRIBUTE}]`).forEach((el) => {
    if (!isEmptyText(el, empty, pathsOf)) {
      el.removeAttribute(EMPTY_TEXT_ATTRIBUTE);
    }
  });
  if (empty.size === 0) return;
  root.querySelectorAll("[data-val-path]").forEach((el) => {
    if (el.hasAttribute(EMPTY_TEXT_ATTRIBUTE)) return;
    if (!isEmptyText(el, empty, pathsOf)) return;
    el.setAttribute(EMPTY_TEXT_ATTRIBUTE, layoutOf(el));
  });
}

/** The picking stylesheet's rules for {@link EMPTY_TEXT_ATTRIBUTE}. */
export const EMPTY_TEXT_RULES = [
  // `1lh` is the element's own line; `1.2em` where `lh` is not known.
  `[${EMPTY_TEXT_ATTRIBUTE}="block"] { min-height: 1.2em; min-height: 1lh; min-width: 2em; }`,
  `[${EMPTY_TEXT_ATTRIBUTE}="inline"] { padding-inline-end: 2em; }`,
].join("\n");

function isEmptyText(
  el: Element,
  empty: ReadonlySet<string>,
  pathsOf: (attribute: string) => readonly string[],
): boolean {
  if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;
  if (EMPTY_BY_NATURE.has(el.tagName.toUpperCase())) return false;
  const attribute = el.getAttribute("data-val-path");
  if (!attribute) return false;
  if (!pathsOf(attribute).some((path) => empty.has(path))) return false;
  return showsNothing(el);
}

/**
 * No text but white space and the invisible characters an edit tag is made
 * of, and nothing that has a box of its own (an image in an empty richtext
 * paragraph is something).
 */
function showsNothing(el: Element): boolean {
  const text = (el.textContent ?? "").replace(/[\s\p{Cf}]/gu, "");
  if (text !== "") return false;
  for (const child of Array.from(el.querySelectorAll("*"))) {
    if (EMPTY_BY_NATURE.has(child.tagName.toUpperCase())) return false;
    if (child.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;
  }
  return true;
}

function layoutOf(el: Element): "block" | "inline" {
  const view = el.ownerDocument.defaultView;
  if (view === null) return "block";
  return view.getComputedStyle(el).display === "inline" ? "inline" : "block";
}
