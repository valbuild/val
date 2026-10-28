/**
 * The protocol between the studio's canvas and the page inside it.
 *
 * The canvas shows the running site in a frame. That frame is a different
 * document — the customer's app, rendered by their components — so the studio
 * cannot reach into it, and it cannot reach out. Everything they say to each
 * other goes through `postMessage`, and this is the vocabulary.
 *
 * It lives in `shared` because both halves have to agree on it: the page half
 * ships in `@valbuild/next`, the studio half in `@valbuild/ui`, and a message
 * shape defined twice is a message shape that will differ once.
 *
 * ## Why a query parameter turns it on
 *
 * The frame has to render the page as Val sees it — draft content, with
 * `data-val-path` on every element Val tracks — while *not* showing Val's own
 * overlay, because the studio is already the UI. Nothing about the cookies can
 * express that: they are per-origin, and the studio and the page share an
 * origin, so a cookie would change the customer's own tabs too. A parameter on
 * the frame's URL is scoped to exactly the one document that needs it.
 */

import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import type { PickedElement, PickModifier } from "./elementPicker";
import type { PageLocation, PageSnapshot } from "./pageInspection";

/** Marks a page load as the studio's canvas frame. */
export const VAL_CANVAS_PARAM = "val_canvas";

/**
 * Every message is tagged with this, and the tag is checked on receipt.
 *
 * A window receives messages from anything that has a handle on it —
 * extensions, embeds, other frames — and `event.data` is whatever they chose to
 * send. Checking a discriminator before reading anything else is what keeps a
 * stray message from being read as a canvas instruction.
 */
export const VAL_CANVAS_MESSAGE = "val-canvas";

/** One element on the page that Val has a path for. */
export type ValCanvasElement = {
  /**
   * The paths on the element, already split.
   *
   * `data-val-path` holds a comma-separated list, because one element can
   * render more than one piece of content — a heading built from two fields is
   * one element with two paths.
   *
   * Typed as `SourcePath` rather than `string` because that is what they are:
   * the page splits the attribute with Val's own splitter, so the values arrive
   * already being paths. Saying so here is what keeps every reader of them from
   * having to assert it again.
   */
  paths: SourcePath[];
  /** Where it is, in the page's own coordinates (unscaled, page-relative). */
  rect: { top: number; left: number; width: number; height: number };
};

/**
 * The colours Val outlines the page's content in, when nobody has said
 * otherwise.
 *
 * They mirror `--bg-page-selection` and `--bg-page-selection-soft` in
 * `packages/ui/spa/index.css`, and they are literals here because the page the
 * bridge runs in has none of Val's stylesheet — no `:host`, no tokens, nothing
 * to inherit. A CSS custom property genuinely cannot reach across that
 * boundary, which is why the colours are SENT (see the `theme` message below)
 * rather than derived.
 *
 * They live beside the protocol rather than with the theme code on purpose:
 * `@valbuild/shared/client` is what the bridge imports, and it exists to keep
 * production bundles small (see the docblock on that entrypoint). Two strings
 * cost nothing; the accent generator that produces the non-default values is
 * ~350 lines of colour maths that no visitor to a Val site should download.
 *
 * `canvasSelectionDefaults.test.ts` holds them equal to the stylesheet.
 */
export const DEFAULT_CANVAS_SELECTION = "#079455";
export const DEFAULT_CANVAS_SELECTION_SOFT = "rgba(7, 148, 85, 0.4)";

/** What the page tells the studio. */
export type ValCanvasPageMessage =
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "ready";
      /**
       * Whether the page is actually rendering draft content.
       *
       * The studio asks the server the same question, but the server answers
       * for the *next* request; this answers for the document on screen, which
       * is the one the person is looking at.
       */
      draftMode: boolean;
      /** The URL the frame ended up on, which a redirect may have changed. */
      url: string;
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "elements";
      elements: ValCanvasElement[];
      /** The page's full layout size, for mapping a click back to an element. */
      pageSize: { width: number; height: number };
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "clicked";
      /** The paths on the element that was clicked. */
      paths: SourcePath[];
    }
  | {
      /**
       * A two-finger gesture on the page.
       *
       * The page is a frame, and a frame keeps its own touches: nothing the
       * studio listens for ever sees a finger that landed on the page. So the
       * canvas cannot zoom by pinch unless the page says a pinch happened,
       * which is what this is.
       *
       * Two fingers rather than one, and that is the whole division of labour:
       * one finger belongs to the page — it scrolls it, taps its links, drags
       * its carousels — and two belong to the window around it. Nothing has to
       * be moded, and neither gesture can be mistaken for the other.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "pinch";
      phase: "start" | "move" | "end";
      /**
       * Distance between the two touches, in the page's own CSS px.
       *
       * A span rather than a scale: the page has no idea what the studio is
       * showing it at, so the only honest thing it can report is how far apart
       * the fingers are. The studio turns the ratio against the span at
       * `start` into a zoom.
       */
      span: number;
      /**
       * Midpoint of the two touches, in the page's own coordinates.
       *
       * The same frame of reference as `ValCanvasElement.rect`, so the studio
       * can map it into the window without knowing anything about the page.
       */
      center: { x: number; y: number };
    }
  | {
      /**
       * A zoom asked for by the pointer — ctrl/cmd + wheel, which is what a
       * trackpad pinch reports as.
       *
       * Separate from `pinch` because it is a different kind of event and not
       * a degenerate one: there are no fingers and therefore no span, only a
       * step, and there is no start and end to hold an anchor across.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "zoom";
      /** Multiply the current scale by this. */
      factor: number;
      /** Where the pointer was, in the page's own coordinates. */
      center: { x: number; y: number };
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "refreshing";
      /**
       * Whether the page is re-rendering because of an edit.
       *
       * An edit reaches the page in two steps of very different cost: the
       * client store updates at once, and anything rendered on the SERVER waits
       * for a `router.refresh()` and its round trip — which in development is
       * long enough to look like nothing happened. The studio cannot see that
       * from outside, so the page says so and the canvas can show it is working.
       */
      pending: boolean;
    }
  | {
      /**
       * Something on the page was picked while `pickElements` was on: ANY
       * element, described (`describeElement`), since the element itself
       * cannot leave the page.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "elementPicked";
      element: PickedElement;
    }
  | {
      /**
       * Esc on the page while Select was on. The key went to the page, which
       * has the focus once it has been clicked, so the studio hears it only
       * from here.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "elementPickingStopped";
    }
  | ({
      /**
       * Where the page is: its path and scroll, as it moves. The design tab
       * opens a new build there (`scrollTo`), so a new version replaces the
       * page in place rather than starting over at the top of the front page.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "location";
    } & PageLocation)
  | {
      /** What `readPage` asked for, or why it could not be read. */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "pageRead";
      requestId: string;
      snapshot: PageSnapshot | null;
      error?: string;
    };

/** What the studio tells the page. */
export type ValCanvasStudioMessage =
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "rescan";
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "highlight";
      /** The path to outline, or null to clear the outline. */
      path: SourcePath | null;
      /** Bring it into view as well as outlining it. */
      scrollIntoView?: boolean;
    }
  | {
      /**
       * A module's source moved, so the page should re-render with it.
       *
       * The page already knows how to do this — it is what makes an inline edit
       * visible behind the overlay — but it learns about it from a CustomEvent
       * on its own window, and the studio is in a different window. So the
       * update is relayed and the bridge re-dispatches it where the page is
       * listening.
       *
       * Without it the canvas is only correct immediately after a load: a
       * server component re-reads content when the page is requested, so
       * everything typed since then is invisible until a reload.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "sourceUpdate";
      moduleFilePath: ModuleFilePath;
      /**
       * The whole module source. `unknown` because the page's own types are the
       * ones that give it meaning; nothing in between should be interpreting it.
       */
      source: unknown;
    }
  | {
      /**
       * Everything the studio holds has been sent.
       *
       * The page waits for draft sources before it renders, and it cannot know
       * how many to expect. The studio only sends modules it has PATCHES for —
       * an unedited module has no draft, so there is nothing to send — and the
       * page cannot tell "not sent yet" from "nothing to send". Left to a
       * timeout, every page reading an unedited module stalled ten seconds and
       * then rendered committed source; the module that mattered, a router with
       * a brand new page in it, was the one whose absence looked identical.
       *
       * So the studio says when it has finished. After this, a module the page
       * has not been given has no draft, and committed source IS the draft.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "sourcesSynced";
    }
  | {
      /**
       * What colour to outline the page's content in.
       *
       * Sent because it cannot be inherited: the bridge runs in the customer's
       * document, which has no Val stylesheet, so the studio's custom
       * properties are not merely overridden there — they do not exist. A
       * project that sets `theme.accent` in `s.settings()` moves the studio's
       * chrome by overriding tokens, and this message is the only way the same
       * decision reaches the outlines drawn on the page itself.
       *
       * Both halves degrade on their own: a bridge that predates this message
       * ignores it and stays Val green, and a bridge that never receives one
       * falls back to {@link DEFAULT_CANVAS_SELECTION}. So an app on an older
       * `@valbuild/next` than its studio, or the reverse, keeps working and
       * simply does not follow the accent.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "theme";
      /** The outline on the element under the pointer, and on a highlight. */
      selection: string;
      /** The resting outline on every field the canvas found. */
      selectionSoft: string;
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "setPicking";
      /**
       * Whether a click picks an element instead of doing what the page would
       * do with it.
       *
       * Off by default: in the normal view the canvas is the page, and a click
       * on a link should follow the link.
       */
      picking: boolean;
    }
  | {
      /**
       * Picking ANY element, as the design tab does (`elementPicker.ts`),
       * rather than the fields Val tagged, as `setPicking` does.
       *
       * While `enabled`, holding `modifier` outlines what is under the
       * pointer and a click picks it; `active` picks without the modifier (the
       * tab's Select). Sent whole every time, so a page that missed one
       * message is put right by the next. A bridge that predates it ignores
       * it, and the tab then simply never hears of a pick.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "pickElements";
      enabled: boolean;
      active: boolean;
      modifier: PickModifier;
      /** Whether the studio still holds the last pick: false takes its outline down. */
      keepPicked: boolean;
    }
  | {
      /** Scroll to where the page before this one was (`location`). */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "scrollTo";
      x: number;
      y: number;
    }
  | {
      /**
       * Read what is on the page (`readPageSnapshot`): the assistant's
       * `read_page`. Answered with `pageRead` and the same `requestId`. A
       * bridge that predates it never answers, and the tab says so.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "readPage";
      requestId: string;
      selector?: string;
      maxItems?: number;
    };

/** Narrow an unknown `event.data` to a message from the page. */
export function isValCanvasPageMessage(
  data: unknown,
): data is ValCanvasPageMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { val?: unknown; type?: unknown };
  if (message.val !== VAL_CANVAS_MESSAGE) return false;
  return (
    message.type === "ready" ||
    message.type === "elements" ||
    message.type === "clicked" ||
    message.type === "pinch" ||
    message.type === "zoom" ||
    message.type === "refreshing" ||
    message.type === "elementPickingStopped" ||
    (message.type === "elementPicked" &&
      isPickedElement((data as { element?: unknown }).element)) ||
    (message.type === "location" && isPageLocation(data)) ||
    (message.type === "pageRead" &&
      typeof (data as { requestId?: unknown }).requestId === "string")
  );
}

function isPageLocation(value: object): boolean {
  const location = value as Record<string, unknown>;
  return (
    typeof location.path === "string" &&
    location.path.startsWith("/") &&
    typeof location.scrollX === "number" &&
    typeof location.scrollY === "number"
  );
}

function isPickedElement(value: unknown): value is PickedElement {
  if (typeof value !== "object" || value === null) return false;
  const element = value as Record<string, unknown>;
  return (
    typeof element.tag === "string" &&
    typeof element.text === "string" &&
    typeof element.selector === "string" &&
    Array.isArray(element.classes) &&
    element.classes.every((item) => typeof item === "string") &&
    (element.valPath === undefined || typeof element.valPath === "string")
  );
}

const PICK_MODIFIERS: readonly unknown[] = ["alt", "meta", "shift", "ctrl"];

/**
 * Whether a value is a colour a `theme` message may carry.
 *
 * A whitelist rather than an escape, and the reason is where these two strings
 * end up: the bridge writes them into a `<style>` element in the CUSTOMER's
 * document with `dangerouslySetInnerHTML`, so a value containing `</style>` is
 * a script tag away from running in someone else's page. A page can be
 * `postMessage`d by any window holding a handle on it, and this guard is the
 * only thing between such a message and that sink.
 *
 * The two shapes are exactly what `themeCustomProperties` produces — a hex, and
 * the `rgba()` it derives the soft outline as. Narrowing the contract is easier
 * to keep true than sanitising an open one, and a forged message that passes
 * this can do no more than pick a different colour.
 */
const CANVAS_SELECTION_COLOR =
  /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i;

function isCanvasSelectionColor(value: unknown): value is string {
  return typeof value === "string" && CANVAS_SELECTION_COLOR.test(value);
}

/** Narrow an unknown `event.data` to a message from the studio. */
export function isValCanvasStudioMessage(
  data: unknown,
): data is ValCanvasStudioMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as {
    val?: unknown;
    type?: unknown;
    selection?: unknown;
    selectionSoft?: unknown;
  };
  if (message.val !== VAL_CANVAS_MESSAGE) return false;
  if (message.type === "theme") {
    // Checked here and not in the bridge: a rejected message is never applied
    // at all, and there is one guard rather than one per framework binding.
    return (
      isCanvasSelectionColor(message.selection) &&
      isCanvasSelectionColor(message.selectionSoft)
    );
  }
  if (message.type === "pickElements") {
    const pick = data as Record<string, unknown>;
    return (
      typeof pick.enabled === "boolean" &&
      typeof pick.active === "boolean" &&
      typeof pick.keepPicked === "boolean" &&
      PICK_MODIFIERS.includes(pick.modifier)
    );
  }
  if (message.type === "scrollTo") {
    const scroll = data as Record<string, unknown>;
    return (
      typeof scroll.x === "number" &&
      Number.isFinite(scroll.x) &&
      typeof scroll.y === "number" &&
      Number.isFinite(scroll.y)
    );
  }
  if (message.type === "readPage") {
    const read = data as Record<string, unknown>;
    return (
      typeof read.requestId === "string" &&
      (read.selector === undefined || typeof read.selector === "string") &&
      (read.maxItems === undefined || typeof read.maxItems === "number")
    );
  }
  return (
    message.type === "rescan" ||
    message.type === "highlight" ||
    message.type === "setPicking" ||
    message.type === "sourceUpdate" ||
    message.type === "sourcesSynced"
  );
}

/**
 * Whether this document is showing in the studio's canvas frame.
 *
 * The parameter marks the document the studio LOADED, and that is not always
 * the document the frame ends up holding. A frame navigates on its own: a site
 * with a login of its own redirects a signed-out canvas to its sign-in page,
 * and the sign-in sends it back to wherever the site chooses. Each of those is
 * a new document without the parameter, and it used to render Val's whole
 * overlay inside the canvas — a studio in the studio, which never told the
 * canvas it was there, so the canvas never went live again until reloaded.
 *
 * So where the frame SITS answers too: a document whose parent is the studio
 * is in the canvas, whatever its own address says. `parentPathname` is that
 * parent's path: `null` for a top-level document, and for a parent on another
 * origin, whose `location` cannot be read and which is not the studio anyway.
 */
export function isValCanvasFrame(
  search: string,
  parentPathname: string | null = null,
): boolean {
  if (parentPathname !== null && isValStudioPathname(parentPathname)) {
    return true;
  }
  try {
    return new URLSearchParams(search).get(VAL_CANVAS_PARAM) !== null;
  } catch {
    return false;
  }
}

/** Whether a path is the studio's own route, where the canvas lives. */
function isValStudioPathname(pathname: string): boolean {
  return pathname === "/val" || pathname.startsWith("/val/");
}

/** Add the canvas marker to a page URL. */
export function withValCanvasParam(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${VAL_CANVAS_PARAM}=1`;
}
