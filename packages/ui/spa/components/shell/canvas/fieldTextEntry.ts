/**
 * What can be typed in, in a field's row: where the caret goes when a text
 * picked on the page could not be typed in there (Select & edit's fallback,
 * see `PickedOptions.focus`).
 *
 * An input, a text area or an editable element -- a richtext's ProseMirror,
 * a code field's CodeMirror. Not a button: a field with nothing to type in
 * (an image, a toggle) is opened and scrolled to, and the caret is left
 * where it was rather than put on whichever control came first.
 */
const TEXT_ENTRY = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"])',
  "textarea",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[contenteditable=""]',
].join(", ");

/**
 * Put the caret in the first control in `row` a person can type in, and say
 * whether it is there now.
 *
 * Whether the focus LANDED is the answer, rather than whether there was a
 * control: a column that is folded or switched off is `display: none` until
 * the layout brings it back, and a browser does not focus anything in it.
 * So `false` means "not yet" as often as "nothing to type in", and the
 * caller asks again.
 *
 * `preventScroll`, because the column scrolls itself to the row, and a
 * focus's own scroll walks every scrollable ancestor: on a phone that is
 * the track the two panes are on.
 */
export function focusTextEntry(row: Element): boolean {
  for (const candidate of Array.from(row.querySelectorAll(TEXT_ENTRY))) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (
      (candidate instanceof HTMLInputElement ||
        candidate instanceof HTMLTextAreaElement) &&
      (candidate.disabled || candidate.readOnly)
    ) {
      continue;
    }
    if (candidate.closest("[inert]") !== null) continue;
    candidate.focus({ preventScroll: true });
    const root = candidate.getRootNode();
    if (
      (root instanceof ShadowRoot || root instanceof Document) &&
      root.activeElement === candidate
    ) {
      return true;
    }
  }
  return false;
}
