/**
 * Using the page in the Studio's preview: the assistant's `interact_page`.
 *
 * The assistant changes a site and then has to find out whether the change
 * works, and a page that only renders right is not yet a page that works: a
 * form that does not submit, a menu that does not open, a layout that breaks
 * at phone width all look fine from `read_page`. So the page can be clicked,
 * typed into and keyed at -- by the model, through the Studio -- and every
 * answer is the page AFTER the action took effect: it waits for the page to
 * settle (see {@link waitForPageSettle}) and then reads it again.
 *
 * Plain DOM and in `shared` for the reason `pageInspection.ts` is: the canvas
 * bridge (`@valbuild/next`, `@valbuild/tanstack`) runs it inside the page,
 * the only place the page's elements can be reached, and both bindings run
 * this one copy. Only what {@link interactWithPage} returns crosses the frame
 * (`valCanvasProtocol.ts`).
 *
 * ## What it will not do
 *
 * The preview is the real site, talking to its real backend, so:
 *
 * - **Nothing is sent to the site's server without the person.** While an
 *   action runs, every request the page makes that sends data -- a form
 *   POST, a `fetch` or XHR other than GET, a beacon -- is held unsent
 *   (`pageRequestGate.ts`) and the answer is `needs-approval`, with exactly
 *   what the page tried. The Studio asks the person, and Allow sends those
 *   requests and nothing else (the `release` action). What was clicked is not
 *   looked at to decide this: what the page does is.
 * - **It never takes the frame off the site.** A link that goes to another
 *   origin, or into another window, is refused before it is clicked; a form
 *   or a data-sending request to another site is refused when the page makes
 *   it. (A script that navigates on its own cannot be stopped; the Studio
 *   then says no page arrived.)
 * - **It never types into a password field.** Whatever the model was told.
 *
 * ## The events are synthetic
 *
 * They are dispatched, not typed by a person, so `isTrusted` is false and the
 * browser does none of what it does for a real key: no text is inserted by a
 * key event, Tab moves no focus, Enter submits nothing. What a real key would
 * have done is done here instead, after the page had its chance to cancel the
 * `keydown` -- see {@link pressKey}. A page that ignores untrusted events
 * (rare) does not react, and the answer says what was done, not what the
 * page did with it.
 */

import type { PageLog, PageLogEntry } from "./pageLog";
import {
  baseTargetOf,
  holdRequests,
  refuseAllHolds,
  refuseHeld,
  releaseHold,
  startRequestGate,
  type PageRequest,
} from "./pageRequestGate";
import {
  findBySelector,
  pageLocationOf,
  readPageSnapshot,
  type PageSnapshot,
} from "./pageInspection";

/**
 * The keys `press` knows. Each one either reaches the page's own listeners
 * (Escape, the arrows) or is also done the way the browser would (Enter, Tab):
 * see {@link pressKey}.
 */
export const PAGE_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "Shift+Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/**
 * What the page itself can be asked to do. Each `kind` is a capability of
 * its own (`interact:<kind>` in `valCanvasProtocol.ts`), so a new one is one
 * more member here and one more name a bridge lists.
 *
 * Opening another page and changing the width are not here: the Studio does
 * those to the frame (its `src`, its width) and then asks the page to
 * `settle`.
 */
export type PageAction =
  /**
   * Nothing: only wait for the page to settle and read it. What follows a
   * navigation or a change of width. `width`: also wait until the page is
   * this wide -- the frame it was resized to.
   */
  | { kind: "settle"; width?: number }
  /** A click on the element, as a pointer would: down, up, click. */
  | { kind: "click"; selector: string }
  /**
   * Text into an input, a textarea or something editable: the focused
   * element, or `selector`'s. Replaces what is there unless `append`.
   */
  | { kind: "type"; text: string; selector?: string; append?: boolean }
  /** A key, on the focused element or `selector`'s. */
  | { kind: "press"; key: PageKey; selector?: string }
  /**
   * What the person decided about the requests an action held
   * (`needs-approval`): send exactly those (`allow`), or refuse them. Then
   * the page settles and is read, as after any action -- and anything new
   * it tries to send is held again.
   */
  | { kind: "release"; hold: string; allow: boolean };

export type PageActionKind = PageAction["kind"];

/** Every kind of {@link PageAction}: what a bridge of this release answers. */
export const PAGE_ACTION_KINDS: readonly PageActionKind[] = [
  "settle",
  "click",
  "type",
  "press",
  "release",
];

/** The longest text `type` takes. */
export const PAGE_TYPE_MAX_LENGTH = 5000;

/** Whether `value` is a {@link PageAction} this release knows. */
export function isPageAction(value: unknown): value is PageAction {
  if (typeof value !== "object" || value === null) return false;
  const kind: unknown = Reflect.get(value, "kind");
  const selector: unknown = Reflect.get(value, "selector");
  const optionalSelector =
    selector === undefined || typeof selector === "string";
  if (kind === "settle") {
    const width: unknown = Reflect.get(value, "width");
    return (
      width === undefined ||
      (typeof width === "number" && Number.isFinite(width) && width > 0)
    );
  }
  if (kind === "click") return typeof selector === "string";
  if (kind === "type") {
    const text: unknown = Reflect.get(value, "text");
    const append: unknown = Reflect.get(value, "append");
    return (
      typeof text === "string" &&
      text.length <= PAGE_TYPE_MAX_LENGTH &&
      optionalSelector &&
      (append === undefined || typeof append === "boolean")
    );
  }
  if (kind === "press") {
    const key: unknown = Reflect.get(value, "key");
    return PAGE_KEYS.some((known) => known === key) && optionalSelector;
  }
  if (kind === "release") {
    const hold: unknown = Reflect.get(value, "hold");
    const allow: unknown = Reflect.get(value, "allow");
    return (
      typeof hold === "string" &&
      hold.length <= 100 &&
      typeof allow === "boolean"
    );
  }
  return false;
}

/**
 * The one bound on an interaction: how long, after the action, the page is
 * given to settle -- and, when the action took it to a new document, for
 * that document to arrive and settle. The Studio hands what is left of it to
 * the page, so the two halves cannot wait twice.
 */
export const INTERACT_SETTLE_TIMEOUT_MS = 15_000;

/**
 * How long the page must be quiet -- no change to the DOM, no request in
 * flight, no resource finishing -- to count as settled. Long enough for a
 * transition and the render after a response; short enough not to be felt.
 */
export const INTERACT_QUIET_MS = 500;

/** Where the page is: what an interaction says changed. */
export type PageState = {
  /** Its path, query and hash, without Val's own parameters. */
  url: string;
  /** Absent when it is not known: before a page the Studio opened. */
  title?: string;
};

export type { PageRequest } from "./pageRequestGate";

/**
 * Requests an action made the page try, held unsent until the person says
 * (`pageRequestGate.ts`). Every string in it is the page's: the Studio checks
 * it before it shows any of it.
 */
export type PageApproval = {
  /** What to send back with the person's answer (`release`). */
  hold: string;
  /** The page they were tried on. */
  page: string;
  /** What was acted on, shortened: the page's words. */
  label: string;
  /** What was done. */
  did: string;
  before: PageState;
  /** What the page tried to send, as the browser resolved it. */
  requests: PageRequest[];
};

/** Why the page did not settle in time: what was still going on. */
export type PageBusy = "loading" | "requests" | "changing" | "width";

/** An interaction, done: the page as it is now. */
export type PageInteraction = {
  /** What was done, in words: `clicked <button> "Save"`. */
  did: string;
  before: PageState;
  after: PageState;
  /** Whether the page went quiet within the time it had. */
  settled: boolean;
  /** How long after the action it was read. */
  waitedMs: number;
  /** When it did not settle: what kept it busy. */
  busy?: PageBusy[];
  /** `fetch` calls still unanswered when it was read. */
  pendingRequests: number;
  /** The page, read after it settled (or gave up). */
  snapshot: PageSnapshot;
  /**
   * What the page logged as going wrong since the action -- or, on a page
   * that just loaded, since it started loading.
   */
  log: PageLogEntry[];
  /**
   * Requests the page tried that were refused, never sent: data sent to
   * another site, or a form that would have left it.
   */
  blocked?: PageRequest[];
};

/** What {@link interactWithPage} answers. */
export type PageInteractOutcome =
  | { status: "done"; interaction: PageInteraction }
  /**
   * The action is taking the frame to another document, which will say
   * `ready` and answer the rest: this one is about to be gone.
   */
  | { status: "leaving"; did: string; before: PageState }
  /** The page tried to send data: held, until the person says. */
  | { status: "needs-approval"; approval: PageApproval }
  /** Not done, and why. */
  | { status: "refused"; error: string };

export type InteractRequest = {
  action: PageAction;
  /** At most this many items in the outline read afterwards. */
  maxItems?: number;
  /** How long to wait for the page to settle. */
  timeoutMs?: number;
  /** How long it must be quiet. */
  quietMs?: number;
  /**
   * Which of the log to answer with: what happened since the action
   * (default), or since the document started -- for a page that just
   * loaded because of the action, where all of it is.
   */
  logFrom?: "action" | "document";
};

/**
 * Do `request.action` on the page in `win`, wait for it to settle, and say
 * what the page is now. Never throws: what cannot be done is `refused`.
 */
export async function interactWithPage(
  win: Win,
  request: InteractRequest,
  log: PageLog | null,
): Promise<PageInteractOutcome> {
  const doc = win.document;
  const before: PageState = stateOf(win);
  const mark = log?.mark() ?? 0;
  // Anything still held from an action before this one was not wanted: the
  // assistant moved on without the person's answer.
  if (request.action.kind !== "release") refuseAllHolds(win);
  // A cross-document navigation the action started: the page says so
  // before it goes, and the next document answers the rest.
  let leaving = false;
  let onLeave: (() => void) | null = null;
  const leave = () => {
    leaving = true;
    onLeave?.();
  };
  win.addEventListener("beforeunload", leave);
  win.addEventListener("pagehide", leave);
  // From before the action is dispatched until the page settled.
  const gate = startRequestGate(win);
  let stopped = false;
  const stopGate = () => {
    stopped = true;
    return gate.stop();
  };
  try {
    let acted: Acted;
    try {
      acted = act(win, request);
    } catch (error) {
      refuseHeld(stopGate());
      return refused(
        `The page threw while it was ${request.action.kind === "settle" ? "being read" : "being used"}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (acted.status !== "acted") {
      refuseHeld(stopGate());
      return acted;
    }
    const { did, label } = acted;
    const leaveNow: PageInteractOutcome = { status: "leaving", did, before };
    if (leaving) return leaveNow;
    const settled = await Promise.race([
      waitForPageSettle(win, {
        timeoutMs: request.timeoutMs ?? INTERACT_SETTLE_TIMEOUT_MS,
        quietMs: request.quietMs ?? INTERACT_QUIET_MS,
        inFlight: () => log?.inFlight() ?? 0,
        ...(request.action.kind === "settle" &&
        request.action.width !== undefined
          ? { width: request.action.width }
          : {}),
      }),
      new Promise<"leaving">((resolve) => {
        onLeave = () => resolve("leaving");
      }),
    ]);
    if (settled === "leaving" || leaving) return leaveNow;
    const blocked = gate.blocked();
    const held = stopGate();
    if (held.requests.length > 0) {
      return {
        status: "needs-approval",
        approval: {
          hold: holdRequests(win, held),
          page: pageLocationOf(win).path,
          label,
          did,
          before,
          requests: gate.held().slice(0, MAX_REQUESTS),
        },
      };
    }
    const snapshot = readPageSnapshot(doc, {
      ...(request.maxItems !== undefined ? { maxItems: request.maxItems } : {}),
    });
    const entries =
      log === null
        ? []
        : request.logFrom === "document"
          ? log.read({ sinceNavigation: false }).entries
          : log.read({ since: mark }).entries;
    return {
      status: "done",
      interaction: {
        did,
        before,
        after: stateOf(win),
        settled: settled.settled,
        waitedMs: settled.waitedMs,
        ...(settled.busy.length > 0 ? { busy: settled.busy } : {}),
        pendingRequests: log?.inFlight() ?? 0,
        snapshot: {
          ...snapshot,
          ...(log !== null ? { log: log.counts() } : {}),
        },
        log: entries,
        ...(blocked.length > 0
          ? { blocked: blocked.slice(0, MAX_REQUESTS) }
          : {}),
      },
    };
  } finally {
    // A document that is going away takes what it held with it.
    if (!stopped) refuseHeld(gate.stop());
    win.removeEventListener("beforeunload", leave);
    win.removeEventListener("pagehide", leave);
  }
}

/** The most requests one answer lists. */
const MAX_REQUESTS = 20;

/** The page's window, as `window` is typed: with its own constructors. */
type Win = Window & typeof globalThis;

/**
 * An action done, before the page settles -- what was done, and what it was
 * done to, for the approval card -- or the outcome that ends it.
 */
type Acted =
  | { status: "acted"; did: string; label: string }
  | PageInteractOutcome;

function act(win: Win, request: InteractRequest): Acted {
  const action = request.action;
  switch (action.kind) {
    case "settle":
      return { status: "acted", did: "waited for the page", label: "" };
    case "release": {
      const released = releaseHold(win, action.hold, action.allow);
      if (released === null) {
        return refused(
          "The requests the person was asked about are no longer waiting: the page reloaded, or they were refused already. Do the action again to ask again.",
        );
      }
      const what = `${released.length} request${released.length === 1 ? "" : "s"}`;
      return {
        status: "acted",
        did: action.allow
          ? `sent the ${what} the person allowed`
          : `refused the ${what} the person did not allow`,
        label: "",
      };
    }
    case "click": {
      const target = find(win, action.selector);
      if (typeof target === "string") return refused(target);
      return click(win, target);
    }
    case "type": {
      const target =
        action.selector !== undefined
          ? find(win, action.selector)
          : focused(win);
      if (typeof target === "string") return refused(target);
      return typeInto(win, target, action.text, action.append === true);
    }
    case "press": {
      let target: Element;
      if (action.selector !== undefined) {
        const found = find(win, action.selector);
        if (typeof found === "string") return refused(found);
        target = found;
        focus(target);
      } else {
        target = win.document.activeElement ?? win.document.body;
      }
      return pressKey(win, target, action.key);
    }
  }
}

const refused = (error: string): PageInteractOutcome => ({
  status: "refused",
  error,
});

/** The element a selector names, or why there is none to act on. */
function find(win: Window, selector: string): Element | string {
  const element = findBySelector(win.document.body, selector);
  if (element === null) {
    return `Nothing on the page matches the selector ${JSON.stringify(selector)}. Use a selector from read_page's outline, or read the page again: it may have changed.`;
  }
  if (element.getClientRects().length === 0) {
    return `${describe(element)} is on the page but not shown (it has no box): it cannot be used. Read the page to see what is showing.`;
  }
  return element;
}

/** What has the focus, or why nothing does. */
function focused(win: Window): Element | string {
  const active = win.document.activeElement;
  if (
    active === null ||
    active === win.document.body ||
    active === win.document.documentElement
  ) {
    return "Nothing on the page has the focus: give the selector of the field to type into.";
  }
  return active;
}

function isDisabled(element: Element): boolean {
  return (
    element.closest(":disabled") !== null ||
    element.closest('[aria-disabled="true"]') !== null
  );
}

// --- click -----------------------------------------------------------------

function click(win: Win, target: Element): Acted {
  if (isDisabled(target)) {
    return refused(
      `${describe(target)} is disabled: clicking it does nothing.`,
    );
  }
  const offSite = leavesTheSite(win, target);
  if (offSite !== null) return refused(offSite);
  const rect = target.getBoundingClientRect();
  const point = {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  const pointer = (type: string, bubbles = true) =>
    target.dispatchEvent(
      typeof win.PointerEvent === "function"
        ? new win.PointerEvent(type, {
            bubbles,
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerdown" ? 1 : 0,
            ...point,
          })
        : new win.MouseEvent(type, {
            bubbles,
            cancelable: true,
            composed: true,
            button: 0,
            ...point,
          }),
    );
  const mouse = (type: string, buttons: number) =>
    target.dispatchEvent(
      new win.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons,
        detail: 1,
        ...point,
      }),
    );
  pointer("pointerover");
  pointer("pointerenter", false);
  mouse("mouseover", 0);
  const down = pointer("pointerdown");
  // A cancelled pointerdown suppresses the mouse events, as a browser does.
  if (down) {
    if (mouse("mousedown", 1)) focus(target);
  }
  pointer("pointerup");
  if (down) mouse("mouseup", 0);
  // The click itself: a dispatched click runs the element's activation
  // behaviour -- a link is followed, a button submits its form (which the
  // request gate holds, if it sends anything).
  mouse("click", 0);
  return {
    status: "acted",
    did: `clicked ${describe(target)}`,
    label: labelOf(target),
  };
}

/**
 * Why following `target` would take the frame off the site, or `null`: a
 * link to another origin, or one that opens another window or downloads.
 */
function leavesTheSite(win: Win, target: Element): string | null {
  const link = target.closest("a[href], area[href], a[*|href]");
  if (link === null) return null;
  const url = linkUrlOf(win, link);
  if (url === null) return null;
  if (url.protocol === "javascript:") return null;
  if (url.origin !== win.location.origin) {
    return `${describe(link)} leads to another site (${clamp(url.origin, 80)}), and the preview stays on this one.`;
  }
  // Its own target, or the document's `<base target>`.
  const opens = link.getAttribute("target") ?? baseTargetOf(win.document);
  if (opens !== null && opens !== "" && opens !== "_self") {
    return `${describe(link)} opens in another window, which the preview cannot show. Open its address (${clamp(url.pathname, 200)}) instead.`;
  }
  if (link.hasAttribute("download")) {
    return `${describe(link)} downloads a file, which the preview cannot show.`;
  }
  return null;
}

/**
 * Where a link goes, as the browser resolves it: `href` the property, which
 * follows `<base href>` -- and for an SVG `<a>`, whose `href` is an animated
 * string, `href` or `xlink:href` resolved against the document's base.
 */
function linkUrlOf(win: Win, link: Element): URL | null {
  const property: unknown = Reflect.get(link, "href");
  if (typeof property === "string") return parseUrl(property, win);
  const written =
    link.getAttribute("href") ??
    link.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  if (written === null) return null;
  try {
    return new URL(written, win.document.baseURI);
  } catch {
    return null;
  }
}

// --- type ------------------------------------------------------------------

/** Input types that take text, as typing would put it in. */
const TEXT_INPUTS = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

function typeInto(
  win: Win,
  target: Element,
  text: string,
  append: boolean,
): Acted {
  if (target instanceof win.HTMLInputElement) {
    const type = (target.getAttribute("type") ?? "").toLowerCase();
    if (type === "password" || target.type === "password") {
      return refused(
        `${describe(target)} is a password field, and the assistant never types into one. Ask the person to type it themselves.`,
      );
    }
    if (!TEXT_INPUTS.has(type)) {
      return refused(
        `${describe(target)} is an input of type "${type}", which takes no typed text${type === "checkbox" || type === "radio" || type === "submit" || type === "button" ? ": click it instead" : ""}.`,
      );
    }
    return setValue(win, target, win.HTMLInputElement.prototype, text, append);
  }
  if (target instanceof win.HTMLTextAreaElement) {
    return setValue(
      win,
      target,
      win.HTMLTextAreaElement.prototype,
      text,
      append,
    );
  }
  if (target instanceof win.HTMLSelectElement) {
    return refused(
      `${describe(target)} is a list to choose from, which typing does not change.`,
    );
  }
  const editable = asHtml(win, target);
  if (editable !== null && editable.isContentEditable) {
    if (isDisabled(editable))
      return refused(`${describe(target)} is disabled.`);
    return typeIntoEditable(win, editable, text, append);
  }
  return refused(
    `${describe(target)} takes no typed text: type into an input, a textarea or something editable.`,
  );
}

/**
 * Set an input's value so the page hears it as typing, React included.
 *
 * Through the prototype's own setter, not `element.value =`: React puts a
 * setter of its own on a controlled input, which records the value as
 * already seen -- the `input` event then looks like no change and React puts
 * the old value back. The prototype's setter goes around it, as a keystroke
 * does.
 */
function setValue(
  win: Win,
  target: HTMLInputElement | HTMLTextAreaElement,
  prototype: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  append: boolean,
): Acted {
  if (target.disabled) return refused(`${describe(target)} is disabled.`);
  if (target.readOnly) return refused(`${describe(target)} is read-only.`);
  focus(target);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  const value = append ? `${target.value}${text}` : text;
  if (setter !== undefined) setter.call(target, value);
  else target.value = value;
  target.dispatchEvent(inputEvent(win, text));
  target.dispatchEvent(new win.Event("change", { bubbles: true }));
  return {
    status: "acted",
    did: `typed ${text.length} character${text.length === 1 ? "" : "s"} into ${describe(target)}`,
    label: labelOf(target),
  };
}

function typeIntoEditable(
  win: Win,
  target: HTMLElement,
  text: string,
  append: boolean,
): Acted {
  focus(target);
  const doc = win.document;
  const selection = win.getSelection();
  let inserted = false;
  if (selection !== null) {
    const range = doc.createRange();
    range.selectNodeContents(target);
    if (append) range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    // The editor's own path for text, with the `beforeinput` and `input` it
    // fires: what rich text editors listen to. Deprecated, and still the
    // only way to insert text the way typing does.
    try {
      inserted =
        typeof doc.execCommand === "function" &&
        doc.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
  }
  if (!inserted) {
    if (append) target.append(doc.createTextNode(text));
    else target.textContent = text;
    target.dispatchEvent(inputEvent(win, text));
  }
  return {
    status: "acted",
    did: `typed ${text.length} character${text.length === 1 ? "" : "s"} into ${describe(target)}`,
    label: labelOf(target),
  };
}

function inputEvent(win: Win, text: string): Event {
  return typeof win.InputEvent === "function"
    ? new win.InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text,
      })
    : new win.Event("input", { bubbles: true });
}

// --- press -----------------------------------------------------------------

const KEY_CODES: Record<string, string> = {
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

/**
 * A key, as the page would hear it, and then what the browser would have
 * done with it -- which a dispatched key event does not do by itself:
 *
 * - **Enter** on a link or a button clicks it; in a form's field it submits
 *   the form (implicit submission). What that sends is the request gate's
 *   to hold (`pageRequestGate.ts`), as for a click.
 * - **Tab** / **Shift+Tab** moves the focus to the next or previous thing
 *   that takes it.
 * - **Arrows** on the page itself scroll it.
 * - **Escape** is the page's alone: its listeners close what they close.
 *
 * None of that is done when the page cancelled the `keydown`, as a browser
 * would not.
 */
function pressKey(win: Win, target: Element, key: PageKey): Acted {
  const shift = key === "Shift+Tab";
  const name = shift ? "Tab" : key;
  // Enter: what it would activate or submit.
  let submits: HTMLFormElement | null = null;
  let activates: Element | null = null;
  if (name === "Enter") {
    const control = target.closest("a[href], button, input, textarea");
    const isField =
      control instanceof win.HTMLInputElement &&
      !["submit", "image", "button", "reset", "checkbox", "radio"].includes(
        control.type,
      );
    if (isField) {
      const form = control.form;
      if (form !== null && submitsImplicitly(win, form)) submits = form;
    } else if (
      control !== null &&
      !(control instanceof win.HTMLTextAreaElement)
    ) {
      // A link or a button: Enter is a click on it.
      activates = control;
      const offSite = leavesTheSite(win, control);
      if (offSite !== null) return refused(offSite);
    }
  }
  const init: KeyboardEventInit = {
    key: name,
    code: KEY_CODES[name] ?? name,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const proceed = target.dispatchEvent(new win.KeyboardEvent("keydown", init));
  if (proceed) {
    if (name === "Enter") {
      if (activates !== null) {
        if (activates instanceof win.HTMLElement) activates.click();
      } else if (submits !== null) {
        const button = defaultButtonOf(win, submits);
        submits.requestSubmit(button ?? undefined);
      }
    } else if (name === "Tab") {
      moveFocus(win, target, shift ? -1 : 1);
    } else if (name.startsWith("Arrow") && isPageItself(win, target)) {
      const step = 40;
      win.scrollBy(
        name === "ArrowLeft" ? -step : name === "ArrowRight" ? step : 0,
        name === "ArrowUp" ? -step : name === "ArrowDown" ? step : 0,
      );
    }
  }
  // On what has the focus now, as a real keyup would be.
  (win.document.activeElement ?? target).dispatchEvent(
    new win.KeyboardEvent("keyup", init),
  );
  return {
    status: "acted",
    did: `pressed ${key} on ${describe(target)}${proceed ? "" : " (the page cancelled it)"}`,
    label: `${key} on ${labelOf(target)}`,
  };
}

/**
 * Whether Enter in a field of `form` submits it, as the HTML standard says:
 * when the form has a submit button, or only one field that blocks it.
 */
function submitsImplicitly(win: Win, form: HTMLFormElement): boolean {
  if (defaultButtonOf(win, form) !== null) return true;
  let fields = 0;
  for (const element of Array.from(form.elements)) {
    if (
      element instanceof win.HTMLInputElement &&
      TEXT_INPUTS.has(element.type === "text" ? "" : element.type)
    ) {
      fields++;
    }
  }
  return fields === 1;
}

function defaultButtonOf(win: Win, form: HTMLFormElement): HTMLElement | null {
  for (const element of Array.from(form.elements)) {
    const html = asHtml(win, element);
    if (html !== null && isSubmitButton(win, html)) return html;
  }
  return null;
}

/**
 * Whether the browser treats `element` as a submit button: by its `type`
 * PROPERTY, which is what the browser resolved -- `<button type="foo">` is
 * a submit button, and so is `type="submit "`.
 */
function isSubmitButton(win: Win, element: HTMLElement): boolean {
  if (element instanceof win.HTMLButtonElement) {
    return element.type === "submit";
  }
  return (
    element instanceof win.HTMLInputElement &&
    (element.type === "submit" || element.type === "image")
  );
}

function isPageItself(win: Window, target: Element): boolean {
  return (
    target === win.document.body || target === win.document.documentElement
  );
}

/** What Tab reaches, in the order it reaches it. */
const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

function moveFocus(win: Win, from: Element, direction: 1 | -1): void {
  const candidates = Array.from(
    win.document.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter((element) => {
    if (element.tabIndex < 0) return false;
    if (isDisabled(element)) return false;
    if (element instanceof win.HTMLInputElement && element.type === "hidden")
      return false;
    return element.getClientRects().length > 0;
  });
  // Positive tabindex first, in its order, then the rest in document order.
  const ordered = [
    ...candidates
      .filter((element) => element.tabIndex > 0)
      .sort((a, b) => a.tabIndex - b.tabIndex),
    ...candidates.filter((element) => element.tabIndex === 0),
  ];
  if (ordered.length === 0) return;
  const at = ordered.findIndex((element) => element === from);
  const next =
    at === -1
      ? direction === 1
        ? ordered[0]
        : ordered[ordered.length - 1]
      : ordered[(at + direction + ordered.length) % ordered.length];
  focus(next);
}

// --- settling --------------------------------------------------------------

/** What {@link waitForPageSettle} found. */
export type PageSettle = {
  settled: boolean;
  waitedMs: number;
  /** What was still going on, when it gave up. Empty when settled. */
  busy: PageBusy[];
};

/** How often the page is looked at while it settles. */
const SETTLE_POLL_MS = 50;

/**
 * Wait until the page is quiet: done loading, no `fetch` in flight, and no
 * change to the DOM and no resource finishing for `quietMs` -- and, given a
 * `width`, as wide as that. Bounded by `timeoutMs`: a page that never goes
 * quiet (a carousel, a clock, a poll) is answered `settled: false`, with
 * what kept it busy, rather than waited on for ever.
 *
 * A client-side navigation is covered by the same signals: the router's
 * requests are in flight, and the new page's render is a change to the DOM.
 * A cross-document one ends this document, which is the caller's to notice.
 *
 * Not counted: `XMLHttpRequest`, WebSocket and EventSource traffic, which
 * the page log does not wrap (only `fetch`); a response they bring in is
 * still seen when it changes the DOM.
 */
export function waitForPageSettle(
  win: Win,
  options: {
    timeoutMs: number;
    quietMs: number;
    inFlight: () => number;
    width?: number;
  },
): Promise<PageSettle> {
  const doc = win.document;
  const started = Date.now();
  let lastActivity = started;
  const touched = () => {
    lastActivity = Date.now();
  };
  const mutations = new win.MutationObserver(touched);
  mutations.observe(doc, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  let resources: PerformanceObserver | null = null;
  try {
    if (typeof PerformanceObserver === "function") {
      resources = new PerformanceObserver(touched);
      resources.observe({ type: "resource" });
    }
  } catch {
    resources = null;
  }
  const busyNow = (): PageBusy[] => {
    const busy: PageBusy[] = [];
    if (doc.readyState !== "complete") busy.push("loading");
    if (options.inFlight() > 0) busy.push("requests");
    if (Date.now() - lastActivity < options.quietMs) busy.push("changing");
    if (options.width !== undefined && win.innerWidth !== options.width) {
      busy.push("width");
    }
    return busy;
  };
  return new Promise<PageSettle>((resolve) => {
    const finish = (settled: boolean, busy: PageBusy[]) => {
      mutations.disconnect();
      resources?.disconnect();
      resolve({ settled, waitedMs: Date.now() - started, busy });
    };
    const look = () => {
      const busy = busyNow();
      if (busy.length === 0) return finish(true, []);
      if (Date.now() - started >= options.timeoutMs) {
        return finish(false, busy);
      }
      setTimeout(look, SETTLE_POLL_MS);
    };
    // Not before the action's own work has had a turn: a click's handler
    // may start its request in a microtask or the next task.
    setTimeout(look, SETTLE_POLL_MS);
  });
}

// --- helpers ---------------------------------------------------------------

function stateOf(win: Window): PageState {
  return { url: pageLocationOf(win).path, title: win.document.title };
}

function focus(element: Element): void {
  const focusable: unknown = Reflect.get(element, "focus");
  if (typeof focusable === "function") {
    try {
      // Without scrolling: the page is the Studio's to scroll, not the
      // focus's (see `scrollWithinPage` in the bridges).
      focusable.call(element, { preventScroll: true });
    } catch {
      // Not focusable: the events still go to it.
    }
  }
}

function asHtml(win: Win, element: Element): HTMLElement | null {
  return element instanceof win.HTMLElement ? element : null;
}

/** An element, as the answer names it: `<button> "Save"`. */
/**
 * An element, as the answer names it: `<button#send> "Save"`. Every part is
 * the page's own -- its tag, id, name and words -- so each is shortened, and
 * the words are quoted as the data they are.
 */
function describe(element: Element): string {
  const tag = clamp(element.tagName.toLowerCase(), 20);
  const id = element.getAttribute("id");
  const name = element.getAttribute("name");
  const label = labelOf(element);
  return `<${tag}${id ? `#${clamp(id, 40)}` : ""}${
    name ? ` name=${JSON.stringify(clamp(name, 40))}` : ""
  }>${label !== "" ? ` ${JSON.stringify(label)}` : ""}`;
}

/** What an element says, shortened: its label, or its words. */
function labelOf(element: Element): string {
  const value: unknown =
    element.tagName === "INPUT" ? Reflect.get(element, "value") : undefined;
  const words =
    element.getAttribute("aria-label") ??
    (element.tagName === "INPUT" &&
    ["submit", "button", "reset"].includes(String(Reflect.get(element, "type")))
      ? String(value ?? "")
      : (element.textContent ?? ""));
  return clamp(words.replace(/\s+/g, " ").trim(), 40);
}

/** The page's text, cut to `length`. */
function clamp(text: string, length: number): string {
  return shorten(text, length);
}

function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function parseUrl(value: string, win: Window): URL | null {
  try {
    return new URL(value, win.location.href);
  } catch {
    return null;
  }
}
