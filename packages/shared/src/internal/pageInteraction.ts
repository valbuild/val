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
 * ## What it asks first, and what it will not do
 *
 * The preview is the real site, talking to its real backend, so:
 *
 * - **Every click, and every Enter or Space, asks the person first.** Before
 *   anything is dispatched to the page, the answer is `needs-approval`,
 *   naming the element (its label or text, its role, the page); the Studio
 *   asks in its own words, and Allow sends the same action back with the
 *   element's FINGERPRINT (`approved`). If the element is no longer the one
 *   that was shown -- a re-render, a navigation, a click the person made
 *   meanwhile -- the page asks again rather than act. An approved action
 *   runs as the person's own: nothing it sends to this site is held.
 * - **While the actions that do not ask run** -- typing, other keys, the
 *   settle after opening a page or changing the width -- requests that send
 *   data are held until the page settles (`pageRequestGate.ts`) and shown to
 *   the person, and Allow sends exactly those (the `release` action).
 * - **Links and forms that go to another site are refused.** A link to
 *   another origin or into another window is refused before anything is
 *   asked; sends of data to another site (POST, PUT, PATCH, DELETE, forms,
 *   beacons), and a form that would leave it, are refused when the page
 *   tries. (A script navigation or a redirect can still leave the site;
 *   the Studio then says no page arrived.)
 * - **It never types into a password field.** Whatever the model was told.
 *
 * Not covered: what a page sends while it loads after `open` or any
 * navigation (nothing of Val's runs in a document before it does), what it
 * sends after it settled (an autosave on a timer), requests through a
 * `fetch` or XHR captured before the action and XHRs opened before it,
 * GET, HEAD and OPTIONS requests -- to other sites too -- and image or
 * script loads, WebSockets, workers, embedded frames, and script
 * navigations and redirects, which can still leave the site.
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
  MAX_HELD_REQUESTS,
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
 * (Escape, the arrows) or is also done the way the browser would (Enter,
 * Space, Tab): see {@link pressKey}. Enter and Space ask the person first,
 * as a click does: {@link ASKING_KEYS}.
 */
export const PAGE_KEYS = [
  "Enter",
  "Space",
  "Escape",
  "Tab",
  "Shift+Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** The keys that activate what has the focus, as a click does: asked about. */
export const ASKING_KEYS: ReadonlySet<PageKey> = new Set(["Enter", "Space"]);

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
// One cap, and one excerpt length, for the bridge and the Studio's card.
export { BODY_EXCERPT_LENGTH, MAX_HELD_REQUESTS } from "./pageRequestGate";

/**
 * A click, or Enter or Space, the page will do once the person allows it --
 * nothing has been dispatched yet. Every string in it is the page's: the
 * Studio checks it before it shows any of it.
 */
export type ActionApproval = {
  kind: "action";
  /**
   * The element as it was shown: what Allow sends back (`approved`), and
   * what the page checks it against before it acts.
   */
  fingerprint: string;
  action: "click" | "press";
  /** For `press`: the key. */
  key?: PageKey;
  /** The page it is on. */
  page: string;
  /** What the element says: its accessible label or its text, shortened. */
  label: string;
  /** What it is: its role (`button`, `link`) or its tag. */
  role: string;
  tag: string;
  /**
   * Enter here submits a form: what the form's submit button says, or ""
   * when it has none with a label. Absent when Enter submits nothing.
   */
  submits?: string;
  before: PageState;
};

/**
 * Requests an action that did not ask made the page try, held unsent until
 * the person says (`pageRequestGate.ts`). Every string in it is the page's.
 */
export type RequestsApproval = {
  kind: "requests";
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

/** What the person is asked about: an action, or what an action sent. */
export type PageApproval = ActionApproval | RequestsApproval;

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
  /**
   * The person has to say first: about a click or Enter/Space, not done
   * yet, or about what an action made the page try to send, held unsent.
   */
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
  /**
   * The fingerprint of the element the person allowed this click or key
   * on (`ActionApproval`): only the Studio sends it, after the person's
   * Allow. Absent, a click or Enter/Space only asks.
   */
  approved?: string;
  /** Which document this is (`ready`'s `document`): in the fingerprint. */
  document?: string;
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
  // assistant moved on without the person's answer. FIRST: refusing a held
  // XHR runs the page's own handlers, which can change the page -- so the
  // element is looked for, and checked, only after.
  if (request.action.kind !== "release") refuseAllHolds(win);
  // A click or Enter/Space: the person first, before anything is dispatched.
  const asked = askFirst(win, request);
  if (asked.kind === "answer") return asked.outcome;
  const approvedTarget = asked.kind === "approved" ? asked.target : null;
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
  // From before the action is dispatched until the page settled. An action
  // the person approved is theirs: only what leaves the site is refused.
  const gate = startRequestGate(win, {
    mode: approvedTarget !== null ? "off-site" : "hold",
  });
  let stopped = false;
  const stopGate = () => {
    stopped = true;
    return gate.stop();
  };
  try {
    // The last look before anything is dispatched: still the element the
    // person allowed, as they were shown it? If not, they are asked again.
    if (
      approvedTarget !== null &&
      (!approvedTarget.isConnected ||
        fingerprintOf(win, request, approvedTarget) !== request.approved)
    ) {
      refuseHeld(stopGate());
      const again = askFirst(win, { ...request, approved: undefined });
      return again.kind === "answer"
        ? again.outcome
        : refused(
            "The page changed before the action: do it again to ask again.",
          );
    }
    let acted: Acted;
    try {
      acted = act(win, request, approvedTarget);
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
        inFlight: () => (log?.inFlight() ?? 0) + gate.inFlight(),
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
    const requests = gate.held();
    const held = stopGate();
    if (requests.length > MAX_HELD_REQUESTS) {
      // Not shown in part: the person must see all that Allow would send.
      refuseHeld(held);
      return refused(
        `${did}, and the page tried to send ${requests.length} requests to the site's server -- more than the ${MAX_HELD_REQUESTS} the person can be shown at once. None was sent.`,
      );
    }
    if (requests.length > 0) {
      return {
        status: "needs-approval",
        approval: {
          kind: "requests",
          hold: holdRequests(win, held),
          page: pageLocationOf(win).path,
          label,
          did,
          before,
          requests: [...requests],
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

/** The most refused requests one answer lists. */
const MAX_REQUESTS = 20;

/**
 * Whether the person has to allow this first -- a click, or Enter or Space
 * -- and if so, whether they did: `approved` when the Studio sent back the
 * fingerprint of exactly this element, `not-asked` for an action that does
 * not ask, and otherwise the outcome: `needs-approval`, naming the element,
 * or `refused` for what would never be allowed. Nothing is dispatched to the
 * page here.
 */
type AskFirst =
  | { kind: "approved"; target: Element }
  | { kind: "not-asked" }
  | { kind: "answer"; outcome: PageInteractOutcome };

function askFirst(win: Win, request: InteractRequest): AskFirst {
  const action = request.action;
  const answer = (outcome: PageInteractOutcome): AskFirst => ({
    kind: "answer",
    outcome,
  });
  let target: Element;
  if (action.kind === "click") {
    const found = find(win, action.selector);
    if (typeof found === "string") return answer(refused(found));
    if (isDisabled(found)) {
      return answer(
        refused(`${describe(found)} is disabled: clicking it does nothing.`),
      );
    }
    target = found;
  } else if (action.kind === "press" && ASKING_KEYS.has(action.key)) {
    if (action.selector !== undefined) {
      const found = find(win, action.selector);
      if (typeof found === "string") return answer(refused(found));
      target = found;
    } else {
      target = win.document.activeElement ?? win.document.body;
    }
  } else {
    return { kind: "not-asked" };
  }
  // Never asked about: a link off the site, or into another window.
  const offSite = leavesTheSite(win, target);
  if (offSite !== null) return answer(refused(offSite));
  const fingerprint = fingerprintOf(win, request, target);
  if (request.approved !== undefined && request.approved === fingerprint) {
    return { kind: "approved", target };
  }
  const submits =
    action.kind === "press" && action.key === "Enter"
      ? enterSubmits(win, target)
      : null;
  return answer({
    status: "needs-approval",
    approval: {
      kind: "action",
      fingerprint,
      action: action.kind === "click" ? "click" : "press",
      ...(action.kind === "press" ? { key: action.key } : {}),
      page: pageLocationOf(win).path,
      label: labelOf(target),
      role: roleOf(target),
      tag: clamp(target.tagName.toLowerCase(), 20),
      ...(submits !== null ? { submits } : {}),
      before: stateOf(win),
    },
  });
}

/**
 * Whether Enter on `target` submits a form -- a field whose form submits
 * implicitly, or that form's submit button -- and if so, what the form's
 * submit button says ("" when it has none, or none is labelled). `null`
 * when it submits nothing.
 */
function enterSubmits(win: Win, target: Element): string | null {
  const control = target.closest("button, input");
  if (control === null) return null;
  const form: unknown = Reflect.get(control, "form");
  if (!(form instanceof win.HTMLFormElement)) return null;
  const html = asHtml(win, control);
  if (html !== null && isSubmitButton(win, html)) return labelOf(html);
  const isField =
    control instanceof win.HTMLInputElement &&
    !["submit", "image", "button", "reset", "checkbox", "radio"].includes(
      control.type,
    );
  if (!isField || !submitsImplicitly(win, form)) return null;
  const button = defaultButtonOf(win, form);
  return button !== null ? labelOf(button) : "";
}

/**
 * The element an action would act on, as the person was shown it: the
 * document, the action, the element's tag and words, and where it is among
 * all the document's elements. A re-render that replaces it, a navigation,
 * or a change to what it says gives another fingerprint, and the person is
 * asked again.
 */
function fingerprintOf(
  win: Win,
  request: InteractRequest,
  target: Element,
): string {
  const action = request.action;
  const all = win.document.getElementsByTagName("*");
  return JSON.stringify([
    request.document ?? "",
    pageLocationOf(win).path,
    action.kind,
    "selector" in action ? (action.selector ?? "") : "",
    action.kind === "press" ? action.key : "",
    target.tagName,
    labelOf(target),
    Array.prototype.indexOf.call(all, target),
  ]);
}

/** What an element is, as a person would name it: its role, or its tag. */
function roleOf(element: Element): string {
  const role = element.getAttribute("role");
  if (role !== null && /^[a-z]{1,20}$/.test(role)) return role;
  const tag = element.tagName.toLowerCase();
  if (tag === "a" || tag === "area") {
    return element.hasAttribute("href") ? "link" : tag;
  }
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "list";
  if (tag === "textarea") return "text field";
  if (tag === "input") {
    const type = String(Reflect.get(element, "type"));
    if (["submit", "button", "reset", "image"].includes(type)) return "button";
    if (type === "checkbox" || type === "radio") return type;
    return "text field";
  }
  return clamp(tag, 20);
}

/** The page's window, as `window` is typed: with its own constructors. */
type Win = Window & typeof globalThis;

/**
 * An action done, before the page settles -- what was done, and what it was
 * done to, for the approval card -- or the outcome that ends it.
 */
type Acted =
  | { status: "acted"; did: string; label: string }
  | PageInteractOutcome;

/**
 * Do the action. `approved`: the element the person allowed it on, found
 * and checked by `askFirst` -- used as it is, never looked up again.
 */
function act(
  win: Win,
  request: InteractRequest,
  approved: Element | null,
): Acted {
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
      const count = released.requests.length;
      const what = `${count} request${count === 1 ? "" : "s"}`;
      const notSent = released.notSent;
      return {
        status: "acted",
        did: action.allow
          ? notSent.length === 0
            ? `sent the ${what} the person allowed`
            : `sent ${count - notSent.length} of the ${what} the person allowed; not sent: ${notSent.join("; ")}`
          : `refused the ${what} the person did not allow`,
        label: "",
      };
    }
    case "click": {
      const target = approved ?? find(win, action.selector);
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
      if (approved !== null) {
        target = approved;
        focus(target);
      } else if (action.selector !== undefined) {
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
  Space: "Space",
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
  // What a key event says for Space: a space.
  const eventKey = name === "Space" ? " " : name;
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
  // Space activates a button, a checkbox or a radio as a click would; a
  // link it does not.
  if (name === "Space") {
    const control = target.closest(
      'button, summary, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], input[type="reset"], [role="button"], [role="checkbox"]',
    );
    if (control !== null) activates = control;
  }
  const init: KeyboardEventInit = {
    key: eventKey,
    code: KEY_CODES[name] ?? name,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const proceed = target.dispatchEvent(new win.KeyboardEvent("keydown", init));
  if (proceed) {
    if (name === "Enter" || name === "Space") {
      if (activates !== null) {
        if (activates instanceof win.HTMLElement) activates.click();
      } else if (name === "Space" && isPageItself(win, target)) {
        win.scrollBy(0, Math.round(win.innerHeight * 0.8));
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

/**
 * What an element is called, shortened, in the order an accessible name is
 * found: `aria-labelledby`, `aria-label`, its `<label>` (by `for`, or one
 * around it), `alt`, `title`, `placeholder` -- and then, for a button's
 * `<input>`, its value, and for anything else, its text.
 */
function labelOf(element: Element): string {
  const tidy = (text: string) => clamp(text.replace(/\s+/g, " ").trim(), 40);
  const doc = element.ownerDocument;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (tidy(text) !== "") return tidy(text);
  }
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && tidy(ariaLabel) !== "") return tidy(ariaLabel);
  const labels: unknown = Reflect.get(element, "labels");
  if (labels !== null && typeof labels === "object") {
    // `<label for>` and a `<label>` around it: the element's own `labels`.
    const text = Array.from<unknown>(Object(labels))
      .map((label) => String(Reflect.get(Object(label), "textContent") ?? ""))
      .join(" ");
    if (tidy(text) !== "") return tidy(text);
  }
  for (const attribute of ["alt", "title", "placeholder"]) {
    const value = element.getAttribute(attribute);
    if (value !== null && tidy(value) !== "") return tidy(value);
  }
  if (
    element.tagName === "INPUT" &&
    ["submit", "button", "reset"].includes(String(Reflect.get(element, "type")))
  ) {
    return tidy(String(Reflect.get(element, "value") ?? ""));
  }
  return tidy(element.textContent ?? "");
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
