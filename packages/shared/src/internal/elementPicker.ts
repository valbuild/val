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
 * Plain DOM, nothing of React's or the Studio's, and in `shared` because
 * both halves need it: the canvas bridge (`@valbuild/next`,
 * `@valbuild/tanstack`) runs it inside the proposal's page, which is another
 * origin than the design tab and the only place the page's elements can be
 * reached; the Studio's stories run it on a page of their own. Only the
 * `PickedElement` crosses the frame (`valCanvasProtocol.ts`).
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

/** How far a touch may move and still be a tap, not a scroll. */
const TAP_SLOP_PX = 10;
/** How long a touch may be held and still be a tap. */
const TAP_MS = 600;
/** How long after a tap its click may still arrive. */
const TAP_CLICK_MS = 800;

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
  /*
   * A tap. iOS Safari dispatches no click for a tap on an element nothing on
   * the way to it listens to -- a listener on the body does not count -- so
   * a tap is taken from the pointer events: a touch that went up where it
   * came down, soon, picks. One that moved is a scroll, which the browser
   * reports as `pointercancel` or as distance, and picks nothing.
   */
  let down: { x: number; y: number; at: number } | null = null;
  /** When a tap last picked: the click a browser may still send is the same tap. */
  let tappedAt = -Infinity;
  const onPointerDown = (event: PointerEvent) => {
    down =
      event.pointerType !== "mouse" && options.active()
        ? { x: event.clientX, y: event.clientY, at: Date.now() }
        : null;
  };
  const onPointerCancel = () => {
    down = null;
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (start === null || !options.active()) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > TAP_SLOP_PX || Date.now() - start.at > TAP_MS) return;
    const element = target(event);
    if (element === null) return;
    event.preventDefault();
    event.stopPropagation();
    tappedAt = Date.now();
    options.onHover(element);
    options.onPick(element);
  };
  const onClick = (event: MouseEvent) => {
    if (!picking(event)) return;
    const element = target(event);
    if (element === null) return;
    event.preventDefault();
    event.stopPropagation();
    // Already picked by the tap this click comes from.
    if (Date.now() - tappedAt < TAP_CLICK_MS) return;
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
  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("pointerup", onPointerUp, true);
  root.addEventListener("pointercancel", onPointerCancel, true);
  root.addEventListener("mouseleave", onLeave);
  win?.addEventListener("keydown", onKey, true);
  win?.addEventListener("keyup", onKey, true);
  return () => {
    root.removeEventListener("mousemove", onMove, true);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("pointerup", onPointerUp, true);
    root.removeEventListener("pointercancel", onPointerCancel, true);
    root.removeEventListener("mouseleave", onLeave);
    win?.removeEventListener("keydown", onKey, true);
    win?.removeEventListener("keyup", onKey, true);
  };
}

/**
 * The outlines over the page while picking: the element under the pointer,
 * named, and the one picked.
 *
 * Boxes `position: fixed` on top of everything, with `pointer-events: none`,
 * appended to the page's body -- not outlines on the elements themselves.
 * The canvas's field outlines are a stylesheet so they cannot disturb the
 * page's layout (`ValCanvasBridge`); a fixed box is out of the flow, so it
 * cannot either, and it is the one way to put a NAME beside any element, which
 * a selector cannot reach.
 *
 * In a shadow root of one host element: the bridge re-measures the page on
 * every `style` change under `body`, and a box that follows the pointer
 * changes its style every frame. Inside a shadow root those changes are not
 * the page's, so the host's one insertion is all the bridge sees.
 */
export type PickerOverlay = {
  show: (kind: "hover" | "picked", element: Element | null) => void;
  setColor: (color: string) => void;
  destroy: () => void;
};

const TOP = "2147483647";

export function createPickerOverlay(
  doc: Document,
  initialColor: string,
): PickerOverlay {
  let color = initialColor;
  const shown: Record<"hover" | "picked", Element | null> = {
    hover: null,
    picked: null,
  };
  const host = doc.createElement("div");
  host.setAttribute("data-val-picker", "");
  const shadow = host.attachShadow({ mode: "open" });
  doc.body.appendChild(host);
  const box = (kind: "hover" | "picked") => {
    const el = doc.createElement("div");
    el.setAttribute("data-kind", kind);
    Object.assign(el.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: TOP,
      boxSizing: "border-box",
      display: "none",
    });
    shadow.appendChild(el);
    return el;
  };
  const boxes = { hover: box("hover"), picked: box("picked") };
  const label = doc.createElement("span");
  Object.assign(label.style, {
    position: "absolute",
    left: "-2px",
    padding: "1px 4px",
    borderRadius: "2px",
    font: "500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#fff",
    whiteSpace: "nowrap",
  });
  boxes.hover.appendChild(label);
  // The pointer says it is picking, and a link under it is not a link.
  const cursor = doc.createElement("style");
  cursor.textContent = "[data-val-picking] * { cursor: crosshair !important; }";
  doc.head.appendChild(cursor);

  const place = (kind: "hover" | "picked") => {
    const element = shown[kind];
    const el = boxes[kind];
    if (element === null || !element.isConnected) {
      el.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    Object.assign(el.style, {
      display: "block",
      top: `${rect.top - 2}px`,
      left: `${rect.left - 2}px`,
      width: `${rect.width + 4}px`,
      height: `${rect.height + 4}px`,
      border: `2px ${kind === "hover" ? "solid" : "dashed"} ${color}`,
    });
    if (kind === "hover") {
      label.textContent = elementLabel(element);
      label.style.background = color;
      // Above the box, unless that is off the top of the window.
      if (rect.top >= 18) {
        label.style.top = "";
        label.style.bottom = "100%";
      } else {
        label.style.bottom = "";
        label.style.top = "100%";
      }
    }
  };
  let frame: number | null = null;
  const win = doc.defaultView;
  const reposition = () => {
    if (frame !== null || win === null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      place("hover");
      place("picked");
    });
  };
  win?.addEventListener("scroll", reposition, true);
  win?.addEventListener("resize", reposition);

  return {
    show: (kind, element) => {
      shown[kind] = element;
      if (kind === "hover") {
        if (element !== null) {
          doc.documentElement.setAttribute("data-val-picking", "");
        } else {
          doc.documentElement.removeAttribute("data-val-picking");
        }
      }
      place(kind);
    },
    setColor: (next) => {
      color = next;
      place("hover");
      place("picked");
    },
    destroy: () => {
      if (frame !== null) win?.cancelAnimationFrame(frame);
      win?.removeEventListener("scroll", reposition, true);
      win?.removeEventListener("resize", reposition);
      host.remove();
      cursor.remove();
      doc.documentElement.removeAttribute("data-val-picking");
    },
  };
}

/** `h2.mb-6.text-2xl`: what the hover box is named. */
export function elementLabel(element: Element): string {
  const classes = Array.from(element.classList).slice(0, 2);
  return [element.tagName.toLowerCase(), ...classes].join(".");
}

export type ElementPicking = {
  /** Take the picked outline down, when the Studio no longer holds the pick. */
  clearPicked: () => void;
  setColor: (color: string) => void;
  stop: () => void;
};

/**
 * Picking on a page, whole: the listeners, the outlines, and Esc to stop
 * picking without the modifier. What a canvas bridge mounts.
 */
export function startElementPicking(
  root: HTMLElement,
  options: {
    modifier: PickModifier;
    active: () => boolean;
    color: string;
    onPick: (picked: PickedElement) => void;
    /** Esc while `active`: the Studio turns Select off. */
    onStop: () => void;
  },
): ElementPicking {
  const doc = root.ownerDocument;
  const overlay = createPickerOverlay(doc, options.color);
  const detach = attachElementPicker(root, {
    modifier: options.modifier,
    active: options.active,
    onHover: (element) => overlay.show("hover", element),
    onPick: (element) => {
      overlay.show("hover", null);
      overlay.show("picked", element);
      options.onPick(describeElement(element, root));
    },
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && options.active()) options.onStop();
  };
  doc.defaultView?.addEventListener("keydown", onKey);
  return {
    clearPicked: () => overlay.show("picked", null),
    setColor: overlay.setColor,
    stop: () => {
      doc.defaultView?.removeEventListener("keydown", onKey);
      detach();
      overlay.destroy();
    },
  };
}
