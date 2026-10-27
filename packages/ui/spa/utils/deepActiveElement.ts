/**
 * The element that actually has focus, looking through shadow roots.
 *
 * `document.activeElement` stops at the shadow host, and the Studio renders
 * inside one, so from the outside every focused element in the UI looks like
 * the same `<val-app>` element. Walk the `activeElement` chain instead.
 */
export function deepActiveElement(): Element | null {
  let el: Element | null =
    typeof document === "undefined" ? null : document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

/**
 * Whether focus currently sits somewhere the user is typing. Used to decide
 * whether restoring focus somewhere else would interrupt them.
 */
export function isTextEntryFocused(): boolean {
  const el = deepActiveElement();
  if (!el) {
    return false;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    return true;
  }
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
