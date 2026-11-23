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
import type { PageScreenshot } from "./pageScreenshot";
import type { PageLogEntry, PageLogLevel, PageLogSnapshot } from "./pageLog";
import {
  isPageAction,
  PAGE_KEYS,
  type PageAction,
  type PageActionKind,
  type PageInteractOutcome,
  type PageRequest,
  type PageState,
} from "./pageInteraction";
import { isQuickPreviewFiles, type QuickPreviewFiles } from "./quickPreview";
import {
  isInlineEditCandidate,
  isInlineEditValue,
  isInlineRichText,
  isInlineSelection,
  type InlineEditCandidate,
  type InlineEditValue,
  type InlineRect,
  type InlineRichTextNode,
  type InlineSelection,
} from "./inlineEditing";

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

/**
 * The requests a page can be asked, each answered with a message of its own
 * (`readPage` with `pageRead`, and so on), and the names a bridge lists in
 * `ready`'s `capabilities`. A capability is named after its request, so the
 * list needs no second vocabulary.
 *
 * ## `interact`: one request, a capability per action
 *
 * Using the page (`pageInteraction.ts`, the assistant's `interact_page`) is
 * ONE request, `interact`, carrying a {@link PageAction}, answered with one
 * `interacted`. But it is listed as a capability PER ACTION --
 * `interact:click`, `interact:type`, `interact:press`, `interact:settle`,
 * `interact:release` --
 * and not as `interact` alone.
 *
 * Because actions will be added, and a bridge's version is the site's, not
 * the Studio's. A capability named `interact` would say a bridge answers the
 * request, not which actions it knows: a Studio that adds `interact:scroll`
 * would send it to a bridge that knows `interact`, and the bridge could only
 * say "unknown action" -- or, being older than the check, say nothing, which
 * is the timeout this list exists to prevent. Named per action, an older
 * bridge simply does not list the new one, and the Studio says at once which
 * package to update, as for every other request.
 *
 * So adding an action costs: a member of `PageAction`, its name in
 * `PAGE_ACTION_KINDS` and in {@link BRIDGE_CAPABILITIES}, the
 * code that does it in `interactWithPage`, and the words for the "update"
 * error in the Studio (`canvasCapabilities.ts`, which the compiler holds to
 * this union). The message, its guard and both bridges stay as they are:
 * the bridges hand every action to `interactWithPage` unread.
 *
 * Opening another page and changing the width are not actions: the Studio
 * does those to the frame -- its `src`, its width, as the address bar and
 * the device switch do -- and then asks the page to `settle`.
 */
export type CanvasRequest =
  | "readPage"
  | "screenshotPage"
  | "readPageLog"
  | "quickPreview"
  | "editInline"
  | InteractCapability;

/** An action of `interact`, as a capability: see {@link CanvasRequest}. */
export type InteractCapability = `interact:${PageActionKind}`;

/** The capability that answers `action`. */
export function interactCapability(kind: PageActionKind): InteractCapability {
  return `interact:${kind}`;
}

/**
 * Every request a bridge of THIS release answers: what both bindings send in
 * `ready`. A request is added here in the same change that answers it in
 * both bridges -- `canvasBridgePageInspection.test.tsx` in each binding holds
 * it.
 */
export const BRIDGE_CAPABILITIES: readonly CanvasRequest[] = [
  "readPage",
  "screenshotPage",
  "readPageLog",
  "quickPreview",
  "editInline",
  // Written out, not mapped from `PAGE_ACTION_KINDS`: this module is read
  // while `pageInteraction.ts` is still loading (it imports the inspection,
  // which imports this). `pageInteraction.test.ts` holds the two equal.
  "interact:settle",
  "interact:click",
  "interact:type",
  "interact:press",
  "interact:release",
];

/**
 * What a bridge answered before bridges said what they answer. A `ready`
 * without `capabilities` is from such a bridge: it is asked these as before
 * -- and waited for, since it may still be loading -- and never asked
 * anything else, which it would never answer.
 */
export const ANSWERED_BEFORE_CAPABILITIES: readonly CanvasRequest[] = [
  "readPage",
  "screenshotPage",
  "quickPreview",
];

/**
 * Whether a page that said `ready` with these `capabilities` answers
 * `request`. `undefined` is a bridge from before the list existed.
 */
export function bridgeAnswers(
  capabilities: readonly string[] | undefined,
  request: CanvasRequest,
): boolean {
  return (capabilities ?? ANSWERED_BEFORE_CAPABILITIES).includes(request);
}

/** Which binding the page's bridge is, and its version: see `ready`. */
export type CanvasBridgeInfo = {
  /** The package the site installed: `@valbuild/next`, `@valbuild/tanstack`. */
  package: string;
  /** Its version, where it knows it. */
  version: string | null;
};

/**
 * An edit to a list of components, asked for on the page itself.
 *
 * `ValComponentEditor` renders a list of objects with the components their
 * schemas link them to, and in the canvas it lets the editor arrange that
 * list where it is shown: drag a section, add one between two others, take
 * one away. The page cannot make the edit - it has no patch store, and the
 * studio is the one writer - so it says what was asked for and the studio
 * writes the patch, which comes back as a `sourceUpdate` like any other edit.
 *
 * `list` is the path of the array. Indices are positions in it as the page
 * last rendered it:
 *
 * - `move`: the item at `from` ends up at `to`, as a JSON patch `move` does.
 * - `remove`: the item at `index` is deleted.
 * - `insert`: a new item goes in at `index`, pushing what was there down.
 *   The page does not say WHICH: the studio has the schema, so it asks the
 *   editor when there is more than one kind to choose from.
 */
export type ValCanvasComponentEdit =
  | { op: "move"; list: SourcePath; from: number; to: number }
  | { op: "remove"; list: SourcePath; index: number }
  | { op: "insert"; list: SourcePath; index: number };

/**
 * On the layer that holds the controls `ValComponentEditor` draws over a
 * list: the handle, the arrows, the add and remove buttons.
 *
 * They are Val's own, drawn in the page, so a click on one is never a click
 * on the page's content - though it may well sit inside an element that has a
 * `data-val-path`, a list inside a component being the case. Whatever asks
 * "what content is under this click" asks {@link isOnValCanvasControls} first.
 */
export const VAL_CANVAS_CONTROLS_ATTRIBUTE = "data-val-component-controls";

/**
 * On the canvas page's `<html>` while the Studio's Edit is on (its
 * `setPicking`): what the controls over a list of components are shown by.
 *
 * An attribute the bridge sets, rather than the message itself, because the
 * bridge is there from the first render and a list is not: one on a page
 * navigated to later never heard the message, and an attribute is still
 * there to be read.
 */
export const VAL_CANVAS_EDITING_ATTRIBUTE = "data-val-canvas-editing";

/**
 * On the element around each item `ValComponentEditor` renders. The canvas
 * bridge leaves it out of its own outlines: the controls draw one for it.
 */
export const VAL_COMPONENT_ATTRIBUTE = "data-val-component";

/**
 * On the page's root element while a section is being dragged. The canvas
 * bridge draws no outlines around editable content then: the drag has its own
 * markers for where the section can go, and the rest is only in the way.
 */
export const VAL_COMPONENT_DRAGGING_ATTRIBUTE = "data-val-component-dragging";

/**
 * The Studio's selection colour, as a CSS custom property the canvas bridge
 * sets on the page's root. The controls over a list are drawn with it, so
 * they are the colour of everything else the canvas outlines, whenever they
 * were rendered.
 */
export const VAL_CANVAS_SELECTION_PROPERTY = "--val-canvas-selection";

/** Whether an element is one of the controls drawn over a list of components. */
export function isOnValCanvasControls(element: Element): boolean {
  return element.closest(`[${VAL_CANVAS_CONTROLS_ATTRIBUTE}]`) !== null;
}

/** Narrow an unknown value to a {@link ValCanvasComponentEdit}. */
export function isValCanvasComponentEdit(
  value: unknown,
): value is ValCanvasComponentEdit {
  if (typeof value !== "object" || value === null) return false;
  const edit = value as Record<string, unknown>;
  if (typeof edit.list !== "string" || edit.list === "") return false;
  const isIndex = (index: unknown) =>
    typeof index === "number" && Number.isInteger(index) && index >= 0;
  if (edit.op === "move") return isIndex(edit.from) && isIndex(edit.to);
  if (edit.op === "remove" || edit.op === "insert") return isIndex(edit.index);
  return false;
}

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
      /**
       * The modules the page holds a draft of: what its server read for this
       * request (`<ValProvider draft>`). The studio sends each of them in its
       * catch-up, pending or not, so a draft that stopped being the draft
       * before the studio was there to say so -- discarded, published -- is
       * replaced rather than kept. Absent from a page of the release before,
       * and from a page that read no draft.
       */
      holds?: ModuleFilePath[];
      /**
       * The version the page holds each of {@link holds} at, where its draft
       * says (`draftHoldsVersions`): the studio does not send one it would
       * send at the same version -- the same content. Absent from a page of
       * the release before, which is sent everything it holds, as before.
       */
      holdsVersions?: Partial<
        Record<ModuleFilePath, { schema: string; base: string; chain: string }>
      >;
      /**
       * Every request this bridge answers ({@link CanvasRequest}). The Studio
       * asks nothing that is not on it, and says at once what to update
       * instead of waiting for an answer that will not come. Absent from a
       * bridge of a release before it: see
       * {@link ANSWERED_BEFORE_CAPABILITIES}. Unknown names -- a bridge
       * newer than the Studio -- are ignored.
       *
       * `unknown` on purpose, like {@link bridge}: read it with
       * {@link capabilitiesOf}. A future bridge may send it in a shape this
       * Studio does not expect, and that must not make the whole `ready`
       * unreadable -- which is a preview stuck on "no answer".
       */
      capabilities?: unknown;
      /**
       * Which document this is: the same for every `ready` one document
       * posts -- it posts again when draft mode or what it holds changes --
       * and new for each document the frame loads. What tells the Studio
       * an interaction took the frame to another page (`interactPage`), and
       * not that the same page spoke again. Absent from a bridge of a
       * release before it, whose every `ready` is taken as a new document.
       */
      document?: string;
      /**
       * Which package the bridge is, so the Studio can say what to update:
       * a {@link CanvasBridgeInfo}, read with {@link bridgeInfoOf}.
       */
      bridge?: unknown;
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
  | {
      /**
       * Esc on the page while picking FIELDS (`setPicking`): Content's Select
       * turns off. Its twin for any element is `elementPickingStopped`.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "pickingStopped";
    }
  | ({
      /**
       * Where the page is: its path and scroll, as it moves. A new build
       * is opened there (`scrollTo`), so a new version replaces the
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
    }
  | {
      /**
       * What `screenshotPage` asked for: the page as a JPEG data URL, or why
       * it could not be taken (`pageScreenshot.ts`).
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "pageScreenshot";
      requestId: string;
      screenshot: PageScreenshot | null;
      error?: string;
    }
  | {
      /**
       * What `readPageLog` asked for: what the page logged as going wrong
       * (`pageLog.ts`), or why it could not be read.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "pageLogRead";
      requestId: string;
      log: PageLogSnapshot | null;
      error?: string;
    }
  | {
      /**
       * What `interact` asked for: the action done and the page read after
       * it settled, or why not (`pageInteraction.ts`). `leaving` is sent
       * first when the action takes the frame to another document, whose
       * `ready` is then asked to `settle` -- see `interact`.
       *
       * `outcome` is `unknown` on purpose, like `ready`'s `capabilities`:
       * read it with {@link interactOutcomeOf}, so a shape this Studio does
       * not know is a failed interaction rather than an unreadable message.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "interacted";
      requestId: string;
      outcome: unknown;
      /**
       * The document that answered (`ready`'s `document`). The `interact`
       * message is posted into the page's window, where any script of the
       * site can see it and answer first; the id it does not know is what
       * the Studio matches, with the `requestId`.
       */
      document?: string;
    }
  | {
      /**
       * A quick preview's files are stored in the page's worker, and a page
       * opened with its id is served them (`quickPreview.ts`) -- or why not.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "quickPreviewStored";
      id: string;
      error?: string;
    }
  | {
      /**
       * Modules the Studio sent made with another schema than this page's
       * build has: the page shows its bundle's content for them instead, and
       * the Studio says the code changed, with a reload. An empty list: the
       * page's code caught up (`CodeChangedDetail`).
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "codeChanged";
      modules: ModuleFilePath[];
    }
  | {
      /**
       * The editor arranged a list of components on the page
       * ({@link ValCanvasComponentEdit}). A studio that predates it ignores
       * it, as it ignores any type it does not know, and the page then simply
       * does not change.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "componentEdit";
      edit: ValCanvasComponentEdit;
    }
  | {
      /**
       * What `editInline` asked for is happening: the caret is in the field
       * at `path`, on the page (`inlineEditing.ts`).
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "inlineEditStarted";
      /**
       * The `editInline` this answers, or `null` when there was none: the
       * page started the edit on a click by itself, from what `textFields`
       * last said, and said nothing of the click (no `clicked`).
       */
      requestId: string | null;
      /** Which of the fields it offered. */
      path: SourcePath;
    }
  | {
      /**
       * Something was typed into the field being edited on the page: its new
       * value, whole. The Studio writes it as the field in its own column
       * would.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "inlineEdit";
      path: SourcePath;
      value: InlineEditValue;
    }
  | {
      /**
       * A text being edited on the page: what is selected in it, and
       * where its element is in the page's viewport. The Studio draws the
       * field's validation errors there and, for a richtext, its formatting
       * controls, acting on that selection (`applyInlineEdit`). Sent when
       * either moves. A string's selection is always `null`.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "inlineEditSelection";
      path: SourcePath;
      selection: InlineSelection | null;
      rect: InlineRect;
      /** Where the caret itself is, when the page could say. */
      caret?: InlineRect | null;
    }
  | {
      /** Editing on the page ended: Enter, Esc, or the focus went elsewhere. */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "inlineEditEnded";
      path: SourcePath;
    }
  | {
      /**
       * None of what `editInline` offered can be edited on the page: no
       * element shows one of them and nothing else. The Studio opens the
       * field in its own column instead.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "inlineEditUnavailable";
      /** The `editInline` this answers. */
      requestId: string;
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
       * The module as a read (`ModuleRead`: its source and version), which
       * the page keeps as it is. `unknown` because the page's own types are
       * the ones that give it meaning; nothing in between should be
       * interpreting it.
       */
      read: unknown;
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
       * The server holds the editor's changes up to this version (`seq`, the
       * server's `ProjectVersion.seq`; `null` from a server that reports
       * none). Sent once after `sourcesSynced`, then every time it moves.
       *
       * What the page re-reads its server-rendered content on (a loader, a
       * server component): those only show an edit once the server has it,
       * so a refresh sent when the edit was typed raced the write and came
       * back without it -- which a ten second safety refresh used to catch.
       * A bridge of the release before ignores it, as it ignores any type it
       * does not know.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "confirmed";
      seq: number | null;
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
       * Picking ANY element (`elementPicker.ts`),
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
      /**
       * Only Val's fields can be picked (`fieldsOnly` in `elementPicker.ts`):
       * the Studio's assistant outside code mode. Absent is any element, so
       * a studio that predates it is answered as before.
       */
      fieldsOnly?: boolean;
      /**
       * What to outline in, instead of the `theme`'s selection colour: code
       * mode's proposal colour. A bridge that predates it uses the theme's.
       */
      color?: string;
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
    }
  | {
      /**
       * Take a picture of the page (`screenshotPage`): the assistant's
       * `screenshot_page`. Answered with `pageScreenshot` and the same
       * `requestId`; a bridge that predates it never answers.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "screenshotPage";
      requestId: string;
      fullPage?: boolean;
    }
  | {
      /**
       * Read what the page logged as going wrong (`pageLog.ts`): the
       * assistant's `read_page_log`. Answered with `pageLogRead` and the
       * same `requestId`. Asked only of a bridge whose `ready` lists
       * `readPageLog`.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "readPageLog";
      requestId: string;
      /** Only what happened since the page last navigated. Default true. */
      sinceNavigation?: boolean;
      /** Only these levels. Absent or empty is every level. */
      levels?: PageLogLevel[];
    }
  | {
      /**
       * Use the page (`pageInteraction.ts`): the assistant's
       * `interact_page`. Do `action`, wait for the page to settle, and
       * answer `interacted` with the page as it is then -- or `leaving`, if
       * the action took the frame to another document, which answers the
       * rest when the Studio asks it to `settle`.
       *
       * Asked only of a bridge whose `ready` lists the action's capability
       * (`interact:<kind>`, see {@link CanvasRequest}), and answered only to
       * the frame's parent at the page's own origin, as `readPage` is: it
       * changes what the page shows, and it may reach the site's backend.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "interact";
      requestId: string;
      action: PageAction;
      /** At most this many items in the outline read afterwards. */
      maxItems?: number;
      /** How long the page has to settle: what is left of the Studio's bound. */
      timeoutMs?: number;
      /** Which of the page's log to answer with: see `InteractRequest`. */
      logFrom?: "action" | "document";
      /**
       * The fingerprint of the element the person allowed a click or
       * Enter/Space on (`ActionApproval`), sent only after their Allow.
       * Without it, such an action only asks.
       */
      approved?: string;
    }
  | {
      /**
       * Store a quick preview's files in this origin's worker
       * (`storeQuickPreview`): the tab cannot, being another origin.
       * Answered with `quickPreviewStored`.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "quickPreview";
      id: string;
      files: QuickPreviewFiles;
    }
  | {
      /**
       * Edit one of these fields ON the page (`inlineEditing.ts`): sent in
       * answer to a `clicked`, with the fields of that element that can be
       * typed -- a string, a richtext -- and what each holds, which is how
       * the page tells that the element shows one of them and nothing else.
       *
       * The first the page can edit is edited (`inlineEditStarted`, then
       * `inlineEdit` as it is typed and `inlineEditEnded`); when there is
       * none it says `inlineEditUnavailable`. Asked only of a bridge whose
       * `ready` lists `editInline`.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "editInline";
      requestId: string;
      candidates: InlineEditCandidate[];
    }
  | {
      /**
       * The richtext being edited on the page is now this, with this
       * selected: what one of the Studio's formatting controls made of it.
       * The Studio has already written it; the page shows it in the copy
       * being typed in, and goes on from there.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "applyInlineEdit";
      /** Which field: as its `editInline` candidate named it. */
      path: string;
      value: InlineRichTextNode[];
      selection: InlineSelection | null;
    }
  | {
      /**
       * The next text typed in the richtext being edited on the page has
       * these marks (as a span's `styles`; `[]` for none), whatever the
       * text around the caret has: one of the Studio's formatting controls
       * pressed with nothing selected. `null` forgets them. The page
       * forgets them too once the caret moves, as the Studio's editor does.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "markInlineEdit";
      /** Which field: as its `editInline` candidate named it. */
      path: string;
      styles: string[] | null;
      /**
       * Where the caret was when the control was pressed. A caret that has
       * moved since -- the message crosses the frame after the keys that
       * moved it -- gets no mark.
       */
      selection: InlineSelection | null;
    }
  | {
      /**
       * Put the caret back in the text being edited on the page: the focus
       * was in one of the Studio's controls for it, and is done there.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "focusInlineEdit";
    }
  | {
      /** End whatever is being edited on the page: Select was turned off. */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "stopInlineEdit";
    }
  | {
      /**
       * The page's texts, as the Studio knows them: sent whenever the paths
       * the page reported, Select, its mode or a value changes. The page
       * cannot tell a text from anything else -- it has no schemas -- and
       * needs to know ahead of a click for two things:
       *
       * - In Select & edit, a click on an element that shows one of
       *   `editable` and nothing else starts the edit IN the click
       *   (`inlineEditStarted` with no `requestId`), rather than a round
       *   trip later: keys typed straight after the click go where the
       *   caret is, and a phone opens its keyboard, which it does only for
       *   a focus in the tap itself. When the element no longer shows what
       *   the Studio last said, the page asks as before (`clicked`,
       *   `editInline`) and holds the keys pressed meanwhile
       *   (`inlineEditKeys.ts`).
       * - While Select is on, an element showing one of `empty` and nothing
       *   else is given a line of room, so it can still be pointed at
       *   (`emptyTextFields.ts`).
       *
       * A bridge that predates it ignores it, as it ignores any message it
       * does not know: nothing it answered changes.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "textFields";
      /** Select is on in Select & edit, and fields may be written. */
      editing: boolean;
      /**
       * What can be typed in on the page, with what each holds now, as
       * `editInline` offers it. Empty unless `editing`.
       */
      editable: InlineEditCandidate[];
      /** The strings and richtexts on the page that are empty now. */
      empty: string[];
    };

/** Narrow an unknown `event.data` to a message from the page. */
export function isValCanvasPageMessage(
  data: unknown,
): data is ValCanvasPageMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { val?: unknown; type?: unknown };
  if (message.val !== VAL_CANVAS_MESSAGE) return false;
  return (
    (message.type === "ready" &&
      isModulePathList((data as { holds?: unknown }).holds) &&
      isHeldVersions((data as { holdsVersions?: unknown }).holdsVersions)) ||
    message.type === "elements" ||
    message.type === "clicked" ||
    message.type === "pinch" ||
    message.type === "zoom" ||
    message.type === "refreshing" ||
    message.type === "elementPickingStopped" ||
    message.type === "pickingStopped" ||
    (message.type === "elementPicked" &&
      isPickedElement((data as { element?: unknown }).element)) ||
    (message.type === "location" && isPageLocation(data)) ||
    (message.type === "pageRead" &&
      typeof (data as { requestId?: unknown }).requestId === "string") ||
    (message.type === "pageScreenshot" &&
      typeof (data as { requestId?: unknown }).requestId === "string") ||
    (message.type === "pageLogRead" &&
      typeof (data as { requestId?: unknown }).requestId === "string") ||
    (message.type === "interacted" &&
      typeof (data as { requestId?: unknown }).requestId === "string") ||
    (message.type === "quickPreviewStored" &&
      typeof (data as { id?: unknown }).id === "string") ||
    (message.type === "codeChanged" &&
      Array.isArray((data as { modules?: unknown }).modules) &&
      isModulePathList((data as { modules?: unknown }).modules)) ||
    (message.type === "componentEdit" &&
      isValCanvasComponentEdit((data as { edit?: unknown }).edit)) ||
    (message.type === "inlineEditStarted" &&
      (typeof (data as { requestId?: unknown }).requestId === "string" ||
        (data as { requestId?: unknown }).requestId === null) &&
      typeof (data as { path?: unknown }).path === "string") ||
    (message.type === "inlineEditEnded" &&
      typeof (data as { path?: unknown }).path === "string") ||
    (message.type === "inlineEdit" &&
      typeof (data as { path?: unknown }).path === "string" &&
      isInlineEditValue((data as { value?: unknown }).value)) ||
    (message.type === "inlineEditUnavailable" &&
      typeof (data as { requestId?: unknown }).requestId === "string") ||
    (message.type === "inlineEditSelection" && isSelectionReport(data))
  );
}

function isSelectionReport(value: object): boolean {
  const report = value as Record<string, unknown>;
  return (
    typeof report.path === "string" &&
    (report.selection === null || isInlineSelection(report.selection)) &&
    isRect(report.rect) &&
    (report.caret === undefined ||
      report.caret === null ||
      isRect(report.caret))
  );
}

function isRect(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    ["top", "left", "width", "height"].every((side) =>
      Number.isFinite(Reflect.get(value, side)),
    )
  );
}

/** `holdsVersions` on `ready`: absent, or a version per module path. */
function isHeldVersions(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(
    (version) =>
      typeof version === "object" &&
      version !== null &&
      typeof (version as { schema?: unknown }).schema === "string" &&
      typeof (version as { base?: unknown }).base === "string" &&
      typeof (version as { chain?: unknown }).chain === "string",
  );
}

/**
 * `capabilities` on `ready`, read leniently: the names in it that are
 * strings, or `undefined` -- a bridge from before the list -- when it is
 * absent or not a list at all.
 */
export function capabilitiesOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * `outcome` on `interacted`, read leniently: `null` when it is not one this
 * Studio knows -- a bridge newer than it, or a malformed message -- which
 * the Studio reports as a failed interaction.
 */
export function interactOutcomeOf(value: unknown): PageInteractOutcome | null {
  if (typeof value !== "object" || value === null) return null;
  const status: unknown = Reflect.get(value, "status");
  if (status === "refused") {
    const error: unknown = Reflect.get(value, "error");
    return typeof error === "string" ? { status, error } : null;
  }
  if (status === "leaving") {
    const did: unknown = Reflect.get(value, "did");
    const before: unknown = Reflect.get(value, "before");
    return typeof did === "string" && isPageState(before)
      ? { status, did, before }
      : null;
  }
  if (status === "needs-approval") {
    // Its shape only: what it says is the page's, and the Studio checks it
    // before it shows any of it (`trustedApproval`).
    const approval: unknown = Reflect.get(value, "approval");
    if (typeof approval !== "object" || approval === null) return null;
    const kind: unknown = Reflect.get(approval, "kind");
    const text = (key: string): string | null => {
      const field: unknown = Reflect.get(approval, key);
      return typeof field === "string" ? field : null;
    };
    const before: unknown = Reflect.get(approval, "before");
    const page = text("page");
    const label = text("label");
    if (page === null || label === null || !isPageState(before)) return null;
    if (kind === "action") {
      const fingerprint = text("fingerprint");
      const action = text("action");
      const role = text("role");
      const tag = text("tag");
      const key: unknown = Reflect.get(approval, "key");
      const submits: unknown = Reflect.get(approval, "submits");
      const pageKey = PAGE_KEYS.find((known) => known === key);
      if (
        fingerprint === null ||
        role === null ||
        tag === null ||
        (action !== "click" && action !== "press") ||
        (action === "press" && pageKey === undefined)
      ) {
        return null;
      }
      return {
        status,
        approval: {
          kind,
          fingerprint,
          action,
          ...(pageKey !== undefined ? { key: pageKey } : {}),
          ...(typeof submits === "string" ? { submits } : {}),
          page,
          label,
          role,
          tag,
          before,
        },
      };
    }
    if (kind === "requests") {
      const hold = text("hold");
      const did = text("did");
      const requests: unknown = Reflect.get(approval, "requests");
      if (hold === null || did === null || !Array.isArray(requests)) {
        return null;
      }
      return {
        status,
        approval: {
          kind,
          hold,
          page,
          label,
          did,
          before,
          requests: requests.filter(isPageRequest),
        },
      };
    }
    return null;
  }
  if (status === "done") {
    const interaction: unknown = Reflect.get(value, "interaction");
    if (typeof interaction !== "object" || interaction === null) return null;
    const did: unknown = Reflect.get(interaction, "did");
    const before: unknown = Reflect.get(interaction, "before");
    const after: unknown = Reflect.get(interaction, "after");
    const settled: unknown = Reflect.get(interaction, "settled");
    const waitedMs: unknown = Reflect.get(interaction, "waitedMs");
    const pendingRequests: unknown = Reflect.get(
      interaction,
      "pendingRequests",
    );
    const snapshot: unknown = Reflect.get(interaction, "snapshot");
    const log: unknown = Reflect.get(interaction, "log");
    const busy: unknown = Reflect.get(interaction, "busy");
    if (
      typeof did !== "string" ||
      !isPageState(before) ||
      !isPageState(after) ||
      typeof settled !== "boolean" ||
      typeof waitedMs !== "number" ||
      typeof pendingRequests !== "number" ||
      !isPageSnapshot(snapshot) ||
      !Array.isArray(log)
    ) {
      return null;
    }
    return {
      status,
      interaction: {
        did,
        before,
        after,
        settled,
        waitedMs,
        pendingRequests,
        snapshot,
        // The page's log entries, as the page wrote them: data, passed on.
        log: log.filter(isPageLogEntry),
        ...(Array.isArray(Reflect.get(interaction, "blocked"))
          ? {
              blocked: Array.from<unknown>(
                Reflect.get(interaction, "blocked"),
              ).filter(isPageRequest),
            }
          : {}),
        ...(Array.isArray(busy)
          ? {
              busy: busy.filter(
                (item): item is "loading" | "requests" | "changing" | "width" =>
                  item === "loading" ||
                  item === "requests" ||
                  item === "changing" ||
                  item === "width",
              ),
            }
          : {}),
      },
    };
  }
  return null;
}

function isPageRequest(value: unknown): value is PageRequest {
  if (typeof value !== "object" || value === null) return false;
  const via: unknown = Reflect.get(value, "via");
  const body: unknown = Reflect.get(value, "body");
  return (
    (via === "fetch" || via === "xhr" || via === "beacon" || via === "form") &&
    typeof Reflect.get(value, "method") === "string" &&
    typeof Reflect.get(value, "url") === "string" &&
    (body === undefined || typeof body === "string")
  );
}

function isPageState(value: unknown): value is PageState {
  if (typeof value !== "object" || value === null) return false;
  const url: unknown = Reflect.get(value, "url");
  const title: unknown = Reflect.get(value, "title");
  return (
    typeof url === "string" &&
    (title === undefined || typeof title === "string")
  );
}

function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "url") === "string" &&
    typeof Reflect.get(value, "title") === "string" &&
    Array.isArray(Reflect.get(value, "outline"))
  );
}

function isPageLogEntry(value: unknown): value is PageLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const level: unknown = Reflect.get(value, "level");
  return (
    (level === "error" || level === "warn") &&
    typeof Reflect.get(value, "source") === "string" &&
    typeof Reflect.get(value, "text") === "string"
  );
}

/** `bridge` on `ready`, read leniently: a malformed one is as if absent. */
export function bridgeInfoOf(value: unknown): CanvasBridgeInfo | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const name: unknown = Reflect.get(value, "package");
  const version: unknown = Reflect.get(value, "version");
  if (typeof name !== "string") return undefined;
  return {
    package: name,
    version: typeof version === "string" ? version : null,
  };
}

/** `holds` on `ready`: absent, or a list of module paths. */
function isModulePathList(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((path) => typeof path === "string"))
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

export function isCanvasSelectionColor(value: unknown): value is string {
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
      PICK_MODIFIERS.includes(pick.modifier) &&
      (pick.fieldsOnly === undefined || typeof pick.fieldsOnly === "boolean") &&
      (pick.color === undefined || isCanvasSelectionColor(pick.color))
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
  if (message.type === "quickPreview") {
    const preview = data as Record<string, unknown>;
    return (
      typeof preview.id === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/.test(preview.id) &&
      isQuickPreviewFiles(preview.files)
    );
  }
  if (message.type === "screenshotPage") {
    const asked = data as Record<string, unknown>;
    return (
      typeof asked.requestId === "string" &&
      (asked.fullPage === undefined || typeof asked.fullPage === "boolean")
    );
  }
  if (message.type === "readPageLog") {
    const read = data as Record<string, unknown>;
    return (
      typeof read.requestId === "string" &&
      (read.sinceNavigation === undefined ||
        typeof read.sinceNavigation === "boolean") &&
      (read.levels === undefined ||
        (Array.isArray(read.levels) &&
          read.levels.every((level) => level === "error" || level === "warn")))
    );
  }
  if (message.type === "editInline") {
    const edit = data as Record<string, unknown>;
    return (
      typeof edit.requestId === "string" &&
      Array.isArray(edit.candidates) &&
      edit.candidates.every(isInlineEditCandidate)
    );
  }
  if (message.type === "textFields") {
    const fields = data as Record<string, unknown>;
    return (
      typeof fields.editing === "boolean" &&
      Array.isArray(fields.editable) &&
      fields.editable.every(isInlineEditCandidate) &&
      Array.isArray(fields.empty) &&
      fields.empty.every((path) => typeof path === "string")
    );
  }
  if (message.type === "applyInlineEdit") {
    const apply = data as Record<string, unknown>;
    return (
      typeof apply.path === "string" &&
      isInlineRichText(apply.value) &&
      (apply.selection === null || isInlineSelection(apply.selection))
    );
  }
  if (message.type === "markInlineEdit") {
    const mark = data as Record<string, unknown>;
    return (
      typeof mark.path === "string" &&
      (mark.styles === null ||
        (Array.isArray(mark.styles) &&
          mark.styles.every((style) => typeof style === "string"))) &&
      (mark.selection === null || isInlineSelection(mark.selection))
    );
  }
  if (message.type === "interact") {
    const field = (key: string): unknown => Reflect.get(data, key);
    const maxItems = field("maxItems");
    const timeoutMs = field("timeoutMs");
    const logFrom = field("logFrom");
    const approved = field("approved");
    return (
      typeof field("requestId") === "string" &&
      isPageAction(field("action")) &&
      (maxItems === undefined || typeof maxItems === "number") &&
      (timeoutMs === undefined ||
        (typeof timeoutMs === "number" &&
          Number.isFinite(timeoutMs) &&
          timeoutMs >= 0)) &&
      (logFrom === undefined ||
        logFrom === "action" ||
        logFrom === "document") &&
      (approved === undefined ||
        (typeof approved === "string" && approved.length <= 2000))
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
    message.type === "sourcesSynced" ||
    message.type === "stopInlineEdit" ||
    message.type === "focusInlineEdit" ||
    (message.type === "confirmed" &&
      ((data as { seq?: unknown }).seq === null ||
        typeof (data as { seq?: unknown }).seq === "number"))
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

/**
 * Add the canvas marker to a page URL: in its query, before any `#hash` --
 * after it, the marker would be part of the fragment, and the page would
 * not know it is the canvas. A relative URL stays relative.
 */
export function withValCanvasParam(url: string): string {
  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? "" : url.slice(hash);
  const separator = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${separator}${VAL_CANVAS_PARAM}=1${fragment}`;
}
