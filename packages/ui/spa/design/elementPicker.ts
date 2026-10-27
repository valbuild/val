/**
 * Pointing at anything on a page, as Lovable's picker does: hover outlines
 * the element under the pointer, a click picks it, and the assistant is told
 * which (valbuild/home `docs/design-tab.md`).
 *
 * ANY element, not only what Val marks. The design tab changes code, and the
 * thing a person wants changed is as often a wrapper, a gap or a button as a
 * field -- so a field's path is extra information when there is one
 * (`valPath`), never the condition for picking.
 *
 * Picking is on while a MODIFIER is held, so the page stays a page: links
 * follow, menus open, and nothing has to be switched back off. `active`
 * turns it on without one, for a Select button or a touch screen.
 *
 * Plain DOM, nothing of React's or the Studio's: it runs in whatever document
 * it is given -- a story's page here, the proposal's frame through the canvas
 * bridge.
 */

export type PickedElement = {
  /** `h2`, `section`, `button`… */
  tag: string;
  /** The words in it, shortened: what a person recognises it by. */
  text: string;
  /** Its own classes, as written. */
  classes: string[];
  /**
   * Where it is, from the root down, short enough to read:
   * `section:nth-of-type(2) > h2`. An `id` ends the walk, since it is
   * already unique.
   */
  selector: string;
  /** The Val field it shows, or is inside of; absent when it shows none. */
  valPath?: string;
};

export type PickModifier = "alt" | "meta" | "shift" | "ctrl";

const TEXT_LENGTH = 80;
const CLASSES = 6;

export function describeElement(
  element: Element,
  root: Element,
): PickedElement {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const valPath =
    element.closest("[data-val-path]")?.getAttribute("data-val-path") ??
    undefined;
  return {
    tag: element.tagName.toLowerCase(),
    text:
      text.length > TEXT_LENGTH ? `${text.slice(0, TEXT_LENGTH - 1)}…` : text,
    classes: Array.from(element.classList).slice(0, CLASSES),
    selector: selectorOf(element, root),
    ...(valPath !== undefined ? { valPath } : {}),
  };
}

function selectorOf(element: Element, root: Element): string {
  const parts: string[] = [];
  let at: Element | null = element;
  while (at !== null && at !== root) {
    const tag = at.tagName.toLowerCase();
    if (at.id !== "") {
      parts.unshift(`${tag}#${at.id}`);
      break;
    }
    const parent: Element | null = at.parentElement;
    const same =
      parent === null
        ? []
        : Array.from(parent.children).filter(
            (sibling) => sibling.tagName === at?.tagName,
          );
    parts.unshift(
      same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag,
    );
    at = parent;
  }
  return parts.join(" > ");
}

/** What a person is told to hold, on their own keyboard. */
export function modifierLabel(modifier: PickModifier, mac: boolean): string {
  switch (modifier) {
    case "alt":
      return mac ? "⌥" : "Alt";
    case "meta":
      return mac ? "⌘" : "Win";
    case "shift":
      return mac ? "⇧" : "Shift";
    case "ctrl":
      return mac ? "⌃" : "Ctrl";
  }
}

function held(
  event: MouseEvent | KeyboardEvent,
  modifier: PickModifier,
): boolean {
  switch (modifier) {
    case "alt":
      return event.altKey;
    case "meta":
      return event.metaKey;
    case "shift":
      return event.shiftKey;
    case "ctrl":
      return event.ctrlKey;
  }
}

export type ElementPickerOptions = {
  modifier: PickModifier;
  /** On without the modifier: a Select button, or a touch screen. */
  active: () => boolean;
  /** The element under the pointer while picking; `null` when not picking. */
  onHover: (element: Element | null) => void;
  onPick: (element: Element) => void;
};

/**
 * Listens on `root` (capturing, so the page's own handlers never see a pick)
 * and returns what stops it.
 */
export function attachElementPicker(
  root: HTMLElement,
  options: ElementPickerOptions,
): () => void {
  const win = root.ownerDocument.defaultView;
  let last: { x: number; y: number } | null = null;
  const picking = (event: MouseEvent | KeyboardEvent) =>
    options.active() || held(event, options.modifier);
  const target = (event: MouseEvent): Element | null =>
    event.target instanceof Element && root.contains(event.target)
      ? event.target
      : null;

  const onMove = (event: MouseEvent) => {
    last = { x: event.clientX, y: event.clientY };
    options.onHover(picking(event) ? target(event) : null);
  };
  const onClick = (event: MouseEvent) => {
    if (!picking(event)) return;
    const element = target(event);
    if (element === null) return;
    event.preventDefault();
    event.stopPropagation();
    options.onPick(element);
  };
  // Pressing the modifier with the pointer still: outline what is under it
  // now, rather than after the next move.
  const onKey = (event: KeyboardEvent) => {
    if (!picking(event)) {
      options.onHover(null);
      return;
    }
    if (last === null) return;
    const under = root.ownerDocument.elementFromPoint(last.x, last.y);
    options.onHover(under !== null && root.contains(under) ? under : null);
  };
  const onLeave = () => {
    last = null;
    options.onHover(null);
  };

  root.addEventListener("mousemove", onMove, true);
  root.addEventListener("click", onClick, true);
  root.addEventListener("mouseleave", onLeave);
  win?.addEventListener("keydown", onKey, true);
  win?.addEventListener("keyup", onKey, true);
  return () => {
    root.removeEventListener("mousemove", onMove, true);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("mouseleave", onLeave);
    win?.removeEventListener("keydown", onKey, true);
    win?.removeEventListener("keyup", onKey, true);
  };
}
