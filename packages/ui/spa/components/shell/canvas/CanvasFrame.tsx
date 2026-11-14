import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bridgeInfoOf,
  capabilitiesOf,
  DEFAULT_CANVAS_SELECTION,
  DEFAULT_CANVAS_SELECTION_SOFT,
  INTERACT_SETTLE_TIMEOUT_MS,
  interactCapability,
  interactOutcomeOf,
  isValCanvasPageMessage,
  type CanvasRequest,
  type PageAction,
  type PageInteraction,
  type PageInteractOutcome,
  type PageApproval,
  type PageState,
  type PageLocation,
  type PageLogLevel,
  type PageLogSnapshot,
  type PageScreenshot,
  type PageSnapshot,
  type QuickPreviewFiles,
  type PickedElement,
  type PickModifier,
  VAL_CANVAS_MESSAGE,
  ValCanvasElement,
  type ValCanvasPageMessage,
  ValCanvasStudioMessage,
  withValCanvasParam,
} from "@valbuild/shared/internal";
import { useValSystem } from "../../../stores/react/SystemContext";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { CanvasPinch } from "./CanvasWindow";
import { CanvasPreviewStatus } from "./CanvasPreviewNotice";
import { CANVAS_DEVICE_WIDTHS, CanvasDevice, CanvasPoint } from "./types";
import {
  INTERACT_ANSWER_MARGIN_MS,
  PageRefusedError,
  sitePathOf,
  trustedApproval,
} from "./canvasInteraction";
import {
  frameHasFocus,
  sameDocument,
  withQuickPreview,
  type CanvasDocument,
} from "./canvasSwap";
import {
  useValCatchUp,
  useValSourceUpdates,
} from "../../../stores/react/ValOverlayEmitter";
import {
  relayedRead,
  type HeldVersions,
} from "../../../stores/react/sourceRelay";
import type { ModuleVersion } from "@valbuild/shared/internal";
import { unansweredRequestError, type FrameBridge } from "./canvasCapabilities";

/**
 * How the frame is currently doing.
 *
 * `waiting` is not the same as `no-draft-mode`: a page that has not answered
 * yet might be about to, and telling someone their preview is broken while it
 * is still loading is worse than saying nothing. The distinction is a timeout,
 * because a page that is not in draft mode has nothing to say — the bridge that
 * would speak is not mounted, so silence is the only signal there is.
 */
type FrameState =
  | { status: "waiting" }
  | {
      status: "ready";
      draftMode: boolean;
      /** What the page said it holds a draft of: see `ready` in the protocol. */
      holds: readonly ModuleFilePath[];
      /** The version it holds each at, where it said. */
      holdsVersions: HeldVersions;
    }
  | { status: "no-answer" };

/**
 * How long to wait for the page to announce itself before assuming it cannot.
 *
 * Generous, because the first load of a route in `next dev` compiles it. The
 * cost of being wrong in this direction is a spinner that lingers; in the other
 * it is telling someone to enable a mode that is already on.
 */
export const ANSWER_TIMEOUT_MS = 8000;

/** How often a new document held for a focused page looks again. */
export const FOCUS_RECHECK_MS = 500;

const NO_HOLDS: readonly ModuleFilePath[] = [];
/** A page that said no versions: everything it holds is sent. */
const NO_HELD_VERSIONS: HeldVersions = {};

export type CanvasFrameProps = {
  /** The page's own URL, e.g. `/blogs/blog1`. */
  url: string;
  width: number | string;
  height: number | string;
  /**
   * Whether this Studio's edits are relayed into the page. Off when the page is
   * not this Studio's content: a proposal's page reads its own drafts, and the
   * site's would be the wrong ones. The page is still told when there is
   * nothing to wait for (`sourcesSynced`), and not what this Studio's server
   * confirms (`confirmed`), which is about other content.
   */
  relaySources?: boolean;
  /** Bumped to reload. */
  reloadKey: number;
  /**
   * Which document of the page to hold, besides the reloads asked for: moves
   * when the server serves another build (`useServedBuild`), or when code
   * mode's status asks for the page again. A new value is a new document,
   * exactly as a new `reloadKey` is.
   */
  documentKey?: string | number;
  /**
   * A quick preview to show (`quickPreview.ts`): the page is opened as it
   * (`?val_quick=<id>`) instead of the served build. Its files must already
   * be stored, through `onQuickPreviewStorer`. `null` for the served build.
   *
   * Like a new `documentKey`, a new one waits while the page has the focus
   * -- someone typing in it, or using it -- and comes in once they leave it,
   * where they were: the same path, scrolled the same.
   */
  quickPreviewId?: string | null;
  /**
   * A document said it is there: which quick preview it is, or `null` for
   * the served build. Called once per document.
   */
  onDocument?: (document: { quick: string | null }) => void;
  /** Whether a click on the page picks the element under it. */
  isPicking: boolean;
  /**
   * What to outline the page's content in, from the project's accent.
   *
   * A prop rather than a `useTheme()` call here: this component is rendered
   * directly by the canvas tests, which mount it with no providers at all.
   * Absent means Val's own green — see `DEFAULT_CANVAS_SELECTION`.
   */
  selectionColors?: { selection: string; selectionSoft: string };
  /** The path to outline, or null for none. */
  highlightedPath: SourcePath | null;
  /** The elements Val tracks on the page, as the page reports them. */
  onElements?: (elements: ValCanvasElement[]) => void;
  /** Something on the page was picked. */
  onPick?: (paths: SourcePath[]) => void;
  /**
   * Picking ANY element (`pickElements` in
   * `valCanvasProtocol`): `null` off, absent never sent. `isPicking` is the
   * other kind, of the fields Val tagged.
   */
  elementPicking?: {
    active: boolean;
    modifier: PickModifier;
    keepPicked: boolean;
    /** Only Val's fields: the Studio's assistant outside code mode. */
    fieldsOnly?: boolean;
    /** The outline's colour, instead of the selection colour: code mode's. */
    color?: string;
  } | null;
  onPickElement?: (element: PickedElement) => void;
  /** Esc on the page while `elementPicking.active`. */
  onElementPickingStopped?: () => void;
  /** Esc on the page while `isPicking`. */
  onPickingStopped?: () => void;
  /**
   * A two-finger gesture on the page.
   *
   * Relayed rather than observed: a frame keeps its own touches, so nothing the
   * studio listens for ever sees a finger that landed here. See
   * `ValCanvasBridge` and the `pinch` message in `valCanvasProtocol`.
   */
  onPinch?: (gesture: CanvasPinch) => void;
  /** A ctrl/cmd + wheel zoom over the page, relayed for the same reason. */
  onZoom?: (factor: number, center: CanvasPoint) => void;
  /**
   * Bumped to turn preview mode on.
   *
   * A key rather than a method, for the reason `reloadKey` is one: the act is a
   * NAVIGATION of the frame, and only the thing holding the frame can perform
   * it. The notice that offers the button sits outside the canvas's zoom
   * transform — see `CanvasPreviewNotice` — so it cannot hold the frame.
   *
   * Ignored at its initial value, so mounting does not enable anything.
   */
  enableKey?: number;
  /**
   * How the conversation with the page is going.
   *
   * Reported rather than rendered here, because the thing that renders it must
   * not be inside the zoom transform: a status bar that shrinks to 7px at
   * auto-fit is not a status bar. See `CanvasPreviewNotice`.
   */
  onStatusChange?: (status: CanvasPreviewStatus) => void;
  /**
   * The modules the page could not show the Studio's content of, because it
   * was made with another schema than the page's build has (`codeChanged`):
   * the page shows its own for them. Empty when a new document loads, and
   * when the page's code catches up. See `CanvasCodeChangedNotice`.
   */
  onCodeChanged?: (modules: ModuleFilePath[]) => void;
  /** Whether the page says it is re-rendering. See `ValCanvasBridge`. */
  onRefreshingChange?: (isRefreshing: boolean) => void;
  /** Where the page is, as it moves: its path and scroll (`location`). */
  onLocation?: (location: PageLocation) => void;
  /**
   * Where each new document is scrolled to once it says it is there: a
   * new build swapped in where the last one was.
   */
  scrollTo?: { x: number; y: number } | null;
  /**
   * Handed the way to read the page (`readPage`), and `null` when the frame
   * goes: the assistant's `read_page`.
   */
  onPageReader?: (reader: PageReader | null) => void;
  /**
   * Handed the way to take a picture of the page (`screenshotPage`), and
   * `null` when the frame goes.
   */
  onPageCamera?: (camera: PageCamera | null) => void;
  /**
   * Handed the way to read what the page logged as going wrong
   * (`readPageLog`), and `null` when the frame goes: the assistant's
   * `read_page_log`.
   */
  onPageLogReader?: (reader: PageLogReader | null) => void;
  /**
   * Handed the way to store a quick preview's files in the page's worker
   * (`quickPreview`), and `null` when the frame goes.
   */
  onQuickPreviewStorer?: (store: QuickPreviewStorer | null) => void;
  /**
   * Handed the way to use the page (`interact`), and `null` when the frame
   * goes: the assistant's `interact_page`.
   */
  onPageInteractor?: (interactor: PageInteractor | null) => void;
  /**
   * Change the width the page is shown at, as the toolbar's device switch
   * does: what `interact_page`'s `viewport` calls, so there is one way the
   * preview is sized. Absent where the width is not the frame's to change
   * (Review's comparison sets it for both sides).
   */
  onDeviceChange?: (device: CanvasDevice) => void;
};

/**
 * What `interact_page` asks of the preview: an action on the page, or one
 * the Studio does to the frame -- open a path on the site, change its width
 * -- after which the page is asked to `settle`.
 */
export type PageInteractRequest = {
  action:
    | PageAction
    | { kind: "open"; path: string }
    | { kind: "viewport"; device: CanvasDevice };
  /** At most this many items in the outline read afterwards. */
  maxItems?: number;
};

/** What the preview answers `interact_page`. */
export type PageInteractAnswer =
  | {
      status: "done";
      interaction: PageInteraction;
      /** The action took the frame to another document. */
      navigated: boolean;
    }
  /**
   * The page tried to send data, held unsent: the person has to allow it,
   * which is a `release` of `approval.hold`. Checked by the Studio
   * (`trustedApproval`) before it is handed on.
   */
  | { status: "needs-approval"; approval: PageApproval };

/**
 * Use the page: see `pageInteraction.ts`. Rejects with what to tell the
 * model when it cannot be done.
 */
export type PageInteractor = (
  request: PageInteractRequest,
) => Promise<PageInteractAnswer>;

/** Store a quick preview's files at the page's origin: see `quickPreview.ts`. */
export type QuickPreviewStorer = (
  id: string,
  files: QuickPreviewFiles,
) => Promise<void>;

/** How long a page is given to store a quick preview. */
export const QUICK_PREVIEW_STORE_TIMEOUT_MS = 45_000;

/** Read what is on the page: see `readPageSnapshot`. */
export type PageReader = (options: {
  selector?: string;
  maxItems?: number;
}) => Promise<PageSnapshot>;

/** How long a page is given to answer `readPage`. */
export const PAGE_READ_TIMEOUT_MS = 5000;

/** Take a picture of the page: see `screenshotPage`. */
export type PageCamera = (options: {
  fullPage?: boolean;
}) => Promise<PageScreenshot>;

/** Read what the page logged as going wrong: see `pageLog.ts`. */
export type PageLogReader = (options: {
  sinceNavigation?: boolean;
  levels?: PageLogLevel[];
}) => Promise<PageLogSnapshot>;

/** How long a page is given to draw itself: a long page with many images is slow. */
export const PAGE_SCREENSHOT_TIMEOUT_MS = 30_000;

/**
 * The running site, in a frame, talking to the studio.
 *
 * Two things make this more than an `<iframe src>`.
 *
 * The first is preview mode. Val only decorates a page with `data-val-path`
 * when it is rendering draft content, so without preview mode the canvas shows
 * the *published* page and nothing on it is selectable — which looks like a
 * broken canvas rather than a mode that is off. So the frame waits to be told,
 * and says so when it is not.
 *
 * The second is that a frame is a different document. Selecting an element on
 * the page, outlining the one being edited, knowing where anything is — none of
 * that can be read across the boundary, so the page reports it instead. See
 * `valCanvasProtocol`.
 */
export function CanvasFrame({
  url,
  width,
  height,
  relaySources = true,
  reloadKey,
  documentKey = 0,
  quickPreviewId = null,
  onDocument,
  isPicking,
  selectionColors,
  highlightedPath,
  onElements,
  onPick,
  elementPicking,
  onPickElement,
  onElementPickingStopped,
  onPickingStopped,
  onPinch,
  onZoom,
  onRefreshingChange,
  enableKey = 0,
  onStatusChange,
  onCodeChanged,
  onLocation,
  scrollTo = null,
  onPageReader,
  onPageCamera,
  onPageLogReader,
  onQuickPreviewStorer,
  onPageInteractor,
  onDeviceChange,
}: CanvasFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const valSystem = useValSystem();
  const [state, setState] = useState<FrameState>({ status: "waiting" });
  const [isEnabling, setIsEnabling] = useState(false);
  /**
   * Bumped every time the page announces itself.
   *
   * The catch-up snapshot below has to run once per DOCUMENT, and `reloadKey`
   * only counts the reloads the studio asked for. A page reloads itself too —
   * `next dev` does it when a `.val.ts` changes, which is exactly what
   * publishing writes — and that new document arrives as another `ready` with
   * the same `draftMode`, so nothing in `state` changes and the effect keyed on
   * it did not re-run. The document then kept whatever the server rendered
   * until the next keystroke happened to relay something, which with auto-save
   * on is how the canvas came to sit on pre-publish content.
   *
   * A counter rather than a flag: `ready` is also posted when draft mode
   * changes, and re-sending the snapshot then is harmless — it is the same
   * sources again.
   */
  const [documentEpoch, setDocumentEpoch] = useState(0);

  /**
   * The path most recently picked ON the page.
   *
   * A pick is followed by a highlight of the thing picked, and asking the page
   * to scroll to it is asking it to reveal something the finger is still on.
   * Harmless in itself, and not harmless in practice: the page's scroll walks
   * out of the frame and moves the studio's own containers with it, which on a
   * phone is how a pick ended up back on the canvas — or half way to it.
   *
   * Consumed by the highlight it suppresses, rather than held: what it excuses
   * is the ONE highlight that follows a pick. Left standing, it would go on
   * suppressing the scroll for that field however you arrived at it later — a
   * row in the fields column, a search hit — where finding it on the page is the
   * whole point.
   *
   * A ref because it is not rendered and must not cause one: it is read while
   * deciding what to send, and written from a message handler.
   */
  const pickedHere = useRef<SourcePath | null>(null);

  /*
   * The document the frame holds, which follows the one asked for
   * (`documentKey`, `quickPreviewId`) -- except while the page has the
   * focus. Then a new build or quick preview waits, and comes in once the
   * person leaves the page, at the path and scroll they were at.
   */
  const wanted = useMemo<CanvasDocument>(
    () => ({ documentKey, quick: quickPreviewId }),
    [documentKey, quickPreviewId],
  );
  const [held, setHeld] = useState<CanvasDocument>(wanted);
  /** Where the page last said it was (`location`). */
  const lastLocation = useRef<PageLocation | null>(null);
  /**
   * Where a document swapped in is opened: where the last one was. Only for
   * the page it was swapped on (`url`): a page the Studio asks for since --
   * picked in Pages, typed in the address bar -- opens where it says.
   */
  const [swapAt, setSwapAt] = useState<{
    at: PageLocation;
    url: string;
  } | null>(null);
  /** Where a document swapped in is scrolled to, once it is there. */
  const swapScroll = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (sameDocument(held, wanted)) return;
    const swap = (): boolean => {
      if (frameHasFocus(frameRef.current)) return false;
      const at = lastLocation.current;
      swapScroll.current =
        at === null ? null : { x: at.scrollX, y: at.scrollY };
      setSwapAt(at === null ? null : { at, url });
      setHeld(wanted);
      return true;
    };
    if (swap()) return;
    const root = frameRef.current?.getRootNode() ?? null;
    const retry = () => void swap();
    // Focus moving into the Studio says it at once; a page left for another
    // window says nothing, so it is looked at now and then too.
    root?.addEventListener("focusin", retry);
    const timer = setInterval(retry, FOCUS_RECHECK_MS);
    return () => {
      root?.removeEventListener("focusin", retry);
      clearInterval(timer);
    };
  }, [held, wanted, url]);
  const openAt = swapAt !== null && swapAt.url === url ? swapAt.at.path : url;
  const heldQuick = useRef(held.quick);
  heldQuick.current = held.quick;

  // The URL the frame is actually given: the page, marked as a canvas load so
  // it renders itself without its own overlay.
  const frameSrc = useMemo(
    () => withValCanvasParam(withQuickPreview(openAt, held.quick)),
    [openAt, held.quick],
  );
  // The page is the Studio's own origin: the canvas frames the site it is on.
  const origin = typeof window === "undefined" ? "" : window.origin;

  /** Send one message into the frame. */
  const send = useCallback(
    (message: ValCanvasStudioMessage) => {
      // The page's origin -- the Studio's own -- named rather than left as `*`.
      frameRef.current?.contentWindow?.postMessage(message, origin);
    },
    [origin],
  );

  /**
   * What the document said it answers (`ready`), and the modules it read:
   * `null` until it says. A ref, as it is read when a request is made,
   * not rendered.
   */
  const bridge = useRef<FrameBridge | null>(null);
  const bridgeHolds = useRef<readonly ModuleFilePath[]>(NO_HOLDS);
  /** Why the page will not answer `request`: see `unansweredRequestError`. */
  const unanswered = useCallback((request: CanvasRequest): Error | null => {
    const error = unansweredRequestError(request, bridge.current);
    return error === null ? null : new Error(error);
  }, []);

  /**
   * How many documents have said `ready`, and who is waiting for the next:
   * an interaction that took the frame to another document (`interactPage`).
   * Refs, as they are read and written by handlers, never rendered.
   */
  const documentsSeen = useRef(0);
  /** The last document's id (`ready`'s `document`), where it said one. */
  const lastDocument = useRef<string | null>(null);
  const documentWaiters = useRef(new Set<() => void>());
  /**
   * `interact` requests the page has not answered yet, by id, with the
   * document they were sent to: an answer from any other is not theirs.
   */
  const interactions = useRef(
    new Map<
      string,
      {
        document: string | null;
        answer: (outcome: PageInteractOutcome | null) => void;
      }
    >(),
  );
  /**
   * Interactions waiting on the frame, told when the Studio loads it again
   * itself -- a new build, a quick preview, another route: that document is
   * not one the action took the page to, and must not be read as if it were.
   */
  const interruptions = useRef(new Set<(error: Error) => void>());
  const frameIdentity = `${frameSrc}\n${reloadKey}\n${held.documentKey}`;
  const lastFrameIdentity = useRef(frameIdentity);
  useEffect(() => {
    if (lastFrameIdentity.current === frameIdentity) return;
    lastFrameIdentity.current = frameIdentity;
    const error = new Error(
      "The Studio loaded the preview again while the action ran (a new build, a quick preview, or another page picked in the Studio), so what happened after it cannot be told apart. Read the page with read_page, and do the action again if it is still needed.",
    );
    for (const interrupt of Array.from(interruptions.current)) {
      interrupt(error);
    }
  }, [frameIdentity]);

  // A reload is a new document, so whatever the last one said no longer holds.
  useEffect(() => {
    bridge.current = null;
    bridgeHolds.current = NO_HOLDS;
    setState({ status: "waiting" });
    onRefreshingChange?.(false);
  }, [frameSrc, reloadKey, held.documentKey, onRefreshingChange]);

  useEffect(() => {
    if (state.status !== "waiting") return;
    const timer = setTimeout(
      () => setState({ status: "no-answer" }),
      ANSWER_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [state.status, frameSrc, reloadKey, held.documentKey]);

  // What the page says.
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      // Only this frame, and only messages shaped like the protocol: a window
      // hears from anything holding a handle on it.
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isValCanvasPageMessage(event.data)) return;
      const message = event.data;
      if (message.type === "ready") {
        // Read leniently: a shape this Studio does not expect is as if
        // absent, never a reason to ignore the page altogether.
        const capabilities = capabilitiesOf(message.capabilities);
        const info = bridgeInfoOf(message.bridge);
        bridge.current = {
          ...(capabilities !== undefined ? { capabilities } : {}),
          ...(info !== undefined ? { bridge: info } : {}),
        };
        bridgeHolds.current = message.holds ?? NO_HOLDS;
        setState({
          status: "ready",
          draftMode: message.draftMode,
          holds: message.holds ?? [],
          holdsVersions: message.holdsVersions ?? {},
        });
        // The page may be a newer build than this Studio -- a proposal
        // built since it loaded -- and its paths name fields this Studio
        // has not got: read the manifest now, so the build's code is in
        // before the editor picks one, not after (`BuildCode`)
        valSystem?.system.checkCodeNow();
        setDocumentEpoch((epoch) => epoch + 1);
        // An interaction waiting for another document (`interactPage`):
        // this one, unless it is the same document speaking again.
        const document =
          typeof message.document === "string" ? message.document : null;
        if (document === null || document !== lastDocument.current) {
          lastDocument.current = document;
          documentsSeen.current += 1;
          for (const waiter of Array.from(documentWaiters.current)) waiter();
        }
        onDocument?.({ quick: heldQuick.current });
        setIsEnabling(false);
        // A new document says again what it could not read, if anything.
        onCodeChanged?.([]);
      } else if (message.type === "elements") {
        onElements?.(message.elements);
      } else if (message.type === "refreshing") {
        onRefreshingChange?.(message.pending);
      } else if (message.type === "pinch") {
        onPinch?.({
          phase: message.phase,
          span: message.span,
          center: message.center,
        });
      } else if (message.type === "zoom") {
        onZoom?.(message.factor, message.center);
      } else if (message.type === "elementPicked") {
        onPickElement?.(message.element);
      } else if (message.type === "elementPickingStopped") {
        onElementPickingStopped?.();
      } else if (message.type === "pickingStopped") {
        onPickingStopped?.();
      } else if (message.type === "location") {
        lastLocation.current = {
          path: message.path,
          scrollX: message.scrollX,
          scrollY: message.scrollY,
        };
        onLocation?.({
          path: message.path,
          scrollX: message.scrollX,
          scrollY: message.scrollY,
        });
      } else if (message.type === "quickPreviewStored") {
        const storing = storings.current.get(message.id);
        if (storing === undefined) return;
        storings.current.delete(message.id);
        storing(message.error);
      } else if (message.type === "pageRead") {
        const reading = readings.current.get(message.requestId);
        if (reading === undefined) return;
        readings.current.delete(message.requestId);
        reading(message);
      } else if (message.type === "codeChanged") {
        onCodeChanged?.(message.modules);
      } else if (message.type === "pageLogRead") {
        const reading = logReadings.current.get(message.requestId);
        if (reading === undefined) return;
        logReadings.current.delete(message.requestId);
        reading(message);
      } else if (message.type === "interacted") {
        const interacting = interactions.current.get(message.requestId);
        if (interacting === undefined) return;
        // Answered by the document it was asked of, or it is not the answer:
        // any script of the site sees the request in its window.
        if (
          interacting.document !== null &&
          message.document !== interacting.document
        ) {
          return;
        }
        interactions.current.delete(message.requestId);
        interacting.answer(interactOutcomeOf(message.outcome));
      } else if (message.type === "pageScreenshot") {
        const shooting = shootings.current.get(message.requestId);
        if (shooting === undefined) return;
        shootings.current.delete(message.requestId);
        shooting(message);
      } else {
        pickedHere.current = message.paths[0] ?? null;
        onPick?.(message.paths);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [
    valSystem,
    onElements,
    onPick,
    onPickElement,
    onElementPickingStopped,
    onPickingStopped,
    onPinch,
    onZoom,
    onRefreshingChange,
    onLocation,
    onDocument,
    onCodeChanged,
  ]);

  /** `readPage` requests the page has not answered yet, by id. */
  const readings = useRef(
    new Map<
      string,
      (answer: Extract<ValCanvasPageMessage, { type: "pageRead" }>) => void
    >(),
  );
  const readPage = useCallback<PageReader>(
    (options) =>
      new Promise<PageSnapshot>((resolve, reject) => {
        const refused = unanswered("readPage");
        if (refused !== null) return reject(refused);
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
          readings.current.delete(requestId);
          reject(
            new Error(
              "The page did not answer. It may still be loading, or its Val packages may be older than the Studio's and cannot be read from here.",
            ),
          );
        }, PAGE_READ_TIMEOUT_MS);
        readings.current.set(requestId, (answer) => {
          clearTimeout(timer);
          if (answer.snapshot !== null) {
            // What the page read, which the page said in `ready`.
            resolve({ ...answer.snapshot, modules: [...bridgeHolds.current] });
          } else {
            reject(new Error(answer.error ?? "The page could not be read."));
          }
        });
        send({
          val: VAL_CANVAS_MESSAGE,
          type: "readPage",
          requestId,
          ...(options.selector !== undefined
            ? { selector: options.selector }
            : {}),
          ...(options.maxItems !== undefined
            ? { maxItems: options.maxItems }
            : {}),
        });
      }),
    [send, unanswered],
  );
  useEffect(() => {
    if (onPageReader === undefined) return;
    onPageReader(readPage);
    return () => onPageReader(null);
  }, [onPageReader, readPage]);

  /** `readPageLog` requests the page has not answered yet, by id. */
  const logReadings = useRef(
    new Map<
      string,
      (answer: Extract<ValCanvasPageMessage, { type: "pageLogRead" }>) => void
    >(),
  );
  const readPageLog = useCallback<PageLogReader>(
    (options) =>
      new Promise<PageLogSnapshot>((resolve, reject) => {
        const refused = unanswered("readPageLog");
        if (refused !== null) return reject(refused);
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
          logReadings.current.delete(requestId);
          reject(
            new Error(
              "The page did not answer. It may still be loading: try again in a moment.",
            ),
          );
        }, PAGE_READ_TIMEOUT_MS);
        logReadings.current.set(requestId, (answer) => {
          clearTimeout(timer);
          if (answer.log !== null) resolve(answer.log);
          else
            reject(
              new Error(answer.error ?? "The page's log could not be read."),
            );
        });
        send({
          val: VAL_CANVAS_MESSAGE,
          type: "readPageLog",
          requestId,
          ...(options.sinceNavigation !== undefined
            ? { sinceNavigation: options.sinceNavigation }
            : {}),
          ...(options.levels !== undefined ? { levels: options.levels } : {}),
        });
      }),
    [send, unanswered],
  );
  useEffect(() => {
    if (onPageLogReader === undefined) return;
    onPageLogReader(readPageLog);
    return () => onPageLogReader(null);
  }, [onPageLogReader, readPageLog]);

  /** `screenshotPage` requests the page has not answered yet, by id. */
  const shootings = useRef(
    new Map<
      string,
      (
        answer: Extract<ValCanvasPageMessage, { type: "pageScreenshot" }>,
      ) => void
    >(),
  );
  const screenshotPage = useCallback<PageCamera>(
    (options) =>
      new Promise<PageScreenshot>((resolve, reject) => {
        const refused = unanswered("screenshotPage");
        if (refused !== null) return reject(refused);
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
          shootings.current.delete(requestId);
          reject(
            new Error(
              "The page did not answer. It may still be loading, or its Val packages may be older than the Studio's and cannot take a picture.",
            ),
          );
        }, PAGE_SCREENSHOT_TIMEOUT_MS);
        shootings.current.set(requestId, (answer) => {
          clearTimeout(timer);
          if (answer.screenshot !== null) resolve(answer.screenshot);
          else
            reject(
              new Error(answer.error ?? "The page could not be pictured."),
            );
        });
        send({
          val: VAL_CANVAS_MESSAGE,
          type: "screenshotPage",
          requestId,
          ...(options.fullPage !== undefined
            ? { fullPage: options.fullPage }
            : {}),
        });
      }),
    [send, unanswered],
  );
  useEffect(() => {
    if (onPageCamera === undefined) return;
    onPageCamera(screenshotPage);
    return () => onPageCamera(null);
  }, [onPageCamera, screenshotPage]);

  /** Quick previews the page has not said it stored, by id. */
  const storings = useRef(new Map<string, (error?: string) => void>());
  const storeQuickPreview = useCallback<QuickPreviewStorer>(
    (id, files) =>
      new Promise<void>((resolve, reject) => {
        const refused = unanswered("quickPreview");
        if (refused !== null) return reject(refused);
        const timer = setTimeout(() => {
          storings.current.delete(id);
          reject(
            new Error(
              "The page did not take the quick preview. Its Val packages may be older than the Studio's: build the proposal instead.",
            ),
          );
        }, QUICK_PREVIEW_STORE_TIMEOUT_MS);
        storings.current.set(id, (error) => {
          clearTimeout(timer);
          if (error === undefined) resolve();
          else reject(new Error(error));
        });
        send({ val: VAL_CANVAS_MESSAGE, type: "quickPreview", id, files });
      }),
    [send, unanswered],
  );
  useEffect(() => {
    if (onQuickPreviewStorer === undefined) return;
    onQuickPreviewStorer(storeQuickPreview);
    return () => onQuickPreviewStorer(null);
  }, [onQuickPreviewStorer, storeQuickPreview]);

  /**
   * Wait until a document after the `seen`th says `ready`, until `deadline`.
   * Counted rather than awaited from now, so a document that arrived while
   * nobody was waiting yet is not waited for again.
   */
  const nextDocument = useCallback(
    (seen: number, deadline: number) =>
      new Promise<void>((resolve, reject) => {
        if (documentsSeen.current > seen) return resolve();
        const timer = setTimeout(
          () => {
            documentWaiters.current.delete(arrived);
            interruptions.current.delete(interrupted);
            reject(
              new Error(
                `The preview started loading another page, and none arrived within ${Math.round(INTERACT_SETTLE_TIMEOUT_MS / 1000)} seconds. It may still be loading (read_page in a moment says), it may have downloaded a file, or it went to a page that is not the site's own -- which the Studio cannot read.`,
              ),
            );
          },
          Math.max(0, deadline - Date.now()),
        );
        const arrived = () => {
          clearTimeout(timer);
          documentWaiters.current.delete(arrived);
          interruptions.current.delete(interrupted);
          resolve();
        };
        const interrupted = (error: Error) => {
          clearTimeout(timer);
          documentWaiters.current.delete(arrived);
          interruptions.current.delete(interrupted);
          reject(error);
        };
        documentWaiters.current.add(arrived);
        interruptions.current.add(interrupted);
      }),
    [],
  );

  /**
   * Ask the page to do one action and wait for its answer -- or for the
   * next document, when the page was replaced without saying so first.
   */
  const askToInteract = useCallback(
    (
      action: PageAction,
      options: {
        deadline: number;
        maxItems?: number;
        logFrom?: "action" | "document";
      },
    ) =>
      new Promise<PageInteractOutcome | "replaced">((resolve, reject) => {
        const refused = unanswered(interactCapability(action.kind));
        if (refused !== null) return reject(refused);
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const remaining = Math.max(0, options.deadline - Date.now());
        const done = () => {
          clearTimeout(timer);
          interactions.current.delete(requestId);
          documentWaiters.current.delete(replaced);
          interruptions.current.delete(interrupted);
        };
        const interrupted = (error: Error) => {
          done();
          reject(error);
        };
        interruptions.current.add(interrupted);
        const timer = setTimeout(() => {
          done();
          reject(
            new Error(
              "The page did not answer. It may still be loading: read_page in a moment says what it shows.",
            ),
          );
        }, remaining + INTERACT_ANSWER_MARGIN_MS);
        const replaced = () => {
          done();
          resolve("replaced");
        };
        documentWaiters.current.add(replaced);
        interactions.current.set(requestId, {
          document: lastDocument.current,
          answer: (outcome) => {
            done();
            if (outcome === null) {
              reject(
                new Error(
                  "The page answered in a way this Studio does not understand: its Val package may be newer than the Studio. Reload the Studio.",
                ),
              );
            } else {
              resolve(outcome);
            }
          },
        });
        send({
          val: VAL_CANVAS_MESSAGE,
          type: "interact",
          requestId,
          action,
          timeoutMs: remaining,
          ...(options.maxItems !== undefined
            ? { maxItems: options.maxItems }
            : {}),
          ...(options.logFrom !== undefined
            ? { logFrom: options.logFrom }
            : {}),
        });
      }),
    [send, unanswered],
  );

  const sizeTo = useRef(onDeviceChange);
  sizeTo.current = onDeviceChange;
  const interactPage = useCallback<PageInteractor>(
    async (request) => {
      // The one bound on all of it: see `INTERACT_SETTLE_TIMEOUT_MS`.
      const deadline = Date.now() + INTERACT_SETTLE_TIMEOUT_MS;
      const maxItems = request.maxItems;
      const where = (): PageState => ({
        url: lastLocation.current?.path ?? url,
      });

      /**
       * What the page asked the person about, checked before any of it is
       * shown -- every field of it is the page's (`trustedApproval`). What
       * cannot be shown is refused, and the page told so, which drops what
       * it held.
       */
      const approvalAnswer = (approval: PageApproval): PageInteractAnswer => {
        const trusted = trustedApproval(approval, origin);
        if ("error" in trusted) {
          void askToInteract(
            { kind: "release", hold: approval.hold, allow: false },
            { deadline: Date.now() + INTERACT_ANSWER_MARGIN_MS },
          ).catch(() => {});
          throw new PageRefusedError(trusted.error);
        }
        return { status: "needs-approval", approval: trusted.approval };
      };

      /**
       * The document the action took the frame to, once it said `ready`:
       * asked to settle and read, its log from when it started loading.
       * Again for each document after it -- a redirect, a page that
       * navigates on load -- until one stays, or the time is up.
       */
      const settleNewDocument = async (
        seen: number,
        did: string,
        before: PageState,
      ): Promise<PageInteractAnswer> => {
        for (;;) {
          await nextDocument(seen, deadline);
          // The one bound holds here too: a page that reloads itself, or
          // redirects to itself, would otherwise be followed for ever.
          if (Date.now() >= deadline) {
            throw new Error(
              `The page kept loading new pages -- a redirect or a reload that repeats -- and did not stay on one within ${Math.round(INTERACT_SETTLE_TIMEOUT_MS / 1000)} seconds. read_page_log may say why.`,
            );
          }
          seen = documentsSeen.current;
          const outcome = await askToInteract(
            { kind: "settle" },
            {
              deadline,
              logFrom: "document",
              ...(maxItems !== undefined ? { maxItems } : {}),
            },
          );
          if (outcome === "replaced" || outcome.status === "leaving") {
            continue;
          }
          if (outcome.status === "refused") {
            throw new PageRefusedError(outcome.error);
          }
          if (outcome.status === "needs-approval") {
            // The new page tried to send something as it loaded: kept from
            // it, and asked about like any other.
            return approvalAnswer(outcome.approval);
          }
          return {
            status: "done",
            interaction: { ...outcome.interaction, did, before },
            navigated: true,
          };
        }
      };

      const action = request.action;
      if (action.kind === "open") {
        const refused = unanswered("interact:settle");
        if (refused !== null) throw refused;
        const target = sitePathOf(action.path, origin);
        if ("error" in target) throw new Error(target.error);
        const frame = frameRef.current;
        if (frame === null) throw new Error("The preview is not open.");
        const before = where();
        const seen = documentsSeen.current;
        // As turning preview mode on does: a navigation of the frame, which
        // the new document answers with `ready`. What the frame said so far
        // stands until it does: a navigation that never lands (a hash on
        // the same page, an empty answer, a download) leaves it as it was.
        frame.src = withValCanvasParam(
          withQuickPreview(target.path, heldQuick.current),
        );
        return settleNewDocument(seen, `opened ${target.path}`, before);
      }

      let did: string | null = null;
      let outcome: PageInteractOutcome | "replaced";
      const seen = documentsSeen.current;
      if (action.kind === "viewport") {
        const resize = sizeTo.current;
        if (resize === undefined) {
          throw new Error(
            "The preview's width is set by what it is shown beside here, not by the preview: it cannot be changed from the assistant.",
          );
        }
        // Asked before resizing, so an older page is refused with nothing
        // changed.
        const refused = unanswered("interact:settle");
        if (refused !== null) throw refused;
        const width = CANVAS_DEVICE_WIDTHS[action.device];
        resize(action.device);
        did = `set the preview to ${action.device} width (${width}px)`;
        outcome = await askToInteract(
          { kind: "settle", width },
          { deadline, ...(maxItems !== undefined ? { maxItems } : {}) },
        );
      } else {
        outcome = await askToInteract(action, {
          deadline,
          ...(maxItems !== undefined ? { maxItems } : {}),
        });
      }
      if (outcome === "replaced") {
        // Gone without saying so first: the next document says what it is.
        return settleNewDocument(
          seen,
          did ?? `did ${action.kind} on the page, and it loaded another`,
          where(),
        );
      }
      switch (outcome.status) {
        case "leaving":
          return settleNewDocument(seen, outcome.did, outcome.before);
        case "needs-approval":
          return approvalAnswer(outcome.approval);
        case "refused":
          throw new PageRefusedError(outcome.error);
        case "done":
          return {
            status: "done",
            interaction:
              did === null
                ? outcome.interaction
                : { ...outcome.interaction, did },
            navigated: false,
          };
      }
    },
    [askToInteract, nextDocument, unanswered, origin, url],
  );
  useEffect(() => {
    if (onPageInteractor === undefined) return;
    onPageInteractor(interactPage);
    return () => onPageInteractor(null);
  }, [onPageInteractor, interactPage]);

  // A document swapped in, scrolled to where the one before it was.
  useEffect(() => {
    const at = swapScroll.current;
    if (at === null || documentEpoch === 0) return;
    swapScroll.current = null;
    send({ val: VAL_CANVAS_MESSAGE, type: "scrollTo", x: at.x, y: at.y });
  }, [send, documentEpoch]);

  /*
   * The frame's first document, scrolled to where it is told to be -- once:
   * a page the person then navigates in, or that reloads itself, is where
   * they took it, not where the build before it was.
   */
  const scrolled = useRef(false);
  const scrollX = scrollTo?.x ?? null;
  const scrollY = scrollTo?.y ?? null;
  useEffect(() => {
    if (scrolled.current || scrollX === null || scrollY === null) return;
    if (documentEpoch === 0) return;
    scrolled.current = true;
    send({ val: VAL_CANVAS_MESSAGE, type: "scrollTo", x: scrollX, y: scrollY });
  }, [send, scrollX, scrollY, documentEpoch]);

  // Picking and highlighting are pushed rather than set on the frame: they are
  // properties of the page's behaviour, and only the page can apply them.
  useEffect(() => {
    send({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: isPicking });
  }, [send, isPicking, state.status]);

  // Whole, every time, and again for every new document: a reload starts the
  // page's picker afresh.
  const pickActive = elementPicking?.active === true;
  const pickModifier = elementPicking?.modifier ?? "alt";
  const keepPicked = elementPicking?.keepPicked !== false;
  const pickFieldsOnly = elementPicking?.fieldsOnly === true;
  const pickColor = elementPicking?.color;
  const pickEnabled =
    elementPicking === undefined ? undefined : elementPicking !== null;
  useEffect(() => {
    if (pickEnabled === undefined) return;
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "pickElements",
      enabled: pickEnabled,
      active: pickActive,
      modifier: pickModifier,
      keepPicked,
      // Only when asked for, so a page is sent what it was sent before.
      ...(pickFieldsOnly ? { fieldsOnly: true } : {}),
      ...(pickColor !== undefined ? { color: pickColor } : {}),
    });
  }, [
    send,
    pickEnabled,
    pickActive,
    pickModifier,
    keepPicked,
    pickFieldsOnly,
    pickColor,
    state.status,
    documentEpoch,
  ]);

  /**
   * The outline colours, pushed for a stronger reason than picking is.
   *
   * The page has none of Val's stylesheet, so a project's accent cannot reach
   * the outlines by cascade the way it reaches everything else in the studio —
   * the tokens are not overridden in that document, they are absent. Telling
   * the page is the only route.
   *
   * Keyed on `state.status` as well as on the colours, because a reload is a
   * new document: the bridge starts again at Val's green and has to be told
   * afresh. Same reason `setPicking` above is.
   */
  useEffect(() => {
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "theme",
      selection: selectionColors?.selection ?? DEFAULT_CANVAS_SELECTION,
      selectionSoft:
        selectionColors?.selectionSoft ?? DEFAULT_CANVAS_SELECTION_SOFT,
    });
  }, [
    send,
    selectionColors?.selection,
    selectionColors?.selectionSoft,
    state.status,
  ]);

  useEffect(() => {
    // Everywhere except straight after a pick on the page, where the thing
    // being highlighted is the thing that was just clicked and is therefore
    // already in front of the person who clicked it. See `pickedHere`.
    const justPicked =
      highlightedPath !== null && highlightedPath === pickedHere.current;
    pickedHere.current = null;
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "highlight",
      path: highlightedPath,
      scrollIntoView: !justPicked,
    });
  }, [send, highlightedPath, state.status]);

  /**
   * Turn preview mode on.
   *
   * `/enable` rather than `/draft/enable`, because two switches have to be on
   * for the canvas to work and this is the one that flips both: it sets the Val
   * Enable cookie *and* turns on draft mode. Draft mode alone is not enough —
   * without the cookie the page mounts none of Val's client code, so nothing
   * tags the content and nothing reports back, and the canvas would sit there
   * looking like a plain screenshot.
   *
   * Navigating the frame through it rather than the studio: the endpoint sets
   * the cookie and then redirects to wherever it is told, so one navigation
   * both enables preview and lands on the page in it. Taking the whole studio
   * through a redirect and back would lose everything unsaved on screen.
   */
  const enablePreview = useCallback(() => {
    setIsEnabling(true);
    /*
     * A fresh attempt, on the same terms as a reload.
     *
     * The frame is about to hold a NEW document, and whatever the last one said
     * no longer holds - so the wait for an answer starts again, and with it the
     * timeout that turns silence into `no-answer`. Without this the state stayed
     * wherever it was and `isEnabling`, which only a `ready` message clears, was
     * the whole of what the notice had to go on: an enable that never landed -
     * a redirect that 404s, a page that does not come back - said "Turning on…"
     * for as long as the tab was open.
     */
    setState({ status: "waiting" });
    if (frameRef.current) {
      frameRef.current.src = enableUrlOf(frameSrc);
    }
  }, [frameSrc]);

  /**
   * Relay every edit into the frame.
   *
   * Only once the page has said it is there and in draft mode: before that
   * there is nothing listening, and a page that is not rendering draft content
   * would not know what to do with the update anyway.
   *
   * This is what makes the canvas keep up with typing. The page's own copy of
   * the content came from the server when it was requested, so without a relay
   * the canvas is only correct for the instant after it loads.
   */
  const isLive = state.status === "ready" && state.draftMode;
  const sendSourceUpdate = useCallback(
    (
      moduleFilePath: ModuleFilePath,
      source: unknown,
      version: ModuleVersion | null,
    ) => {
      const read = relayedRead(source, version);
      if (read === null) return;
      send({
        val: VAL_CANVAS_MESSAGE,
        type: "sourceUpdate",
        moduleFilePath,
        read,
      });
    },
    [send],
  );
  useValSourceUpdates(isLive && relaySources, sendSourceUpdate, () =>
    state.status === "ready" ? state.holdsVersions : NO_HELD_VERSIONS,
  );

  /**
   * And catch the page up the moment it is listening, then say how far the
   * server has confirmed the editor's changes (`useValCatchUp`).
   *
   * The relay above only carries a *change*, which is nothing at all for a page
   * that has just loaded: whatever it got from the server is what it shows, and
   * a freshly opened canvas sometimes showed published content beside an editor
   * full of edits — then corrected itself on the next keystroke, which made it
   * look intermittent rather than like a missing step.
   *
   * Keyed on {@link documentEpoch} rather than on `reloadKey`: every new
   * document has this problem, not only the ones the studio asked for, and the
   * page announcing itself is the one signal that covers both.
   *
   * Then `sourcesSynced`: only modules with changes are ever sent — an
   * unedited module has no draft to send — so a page waiting for draft sources
   * cannot tell "not sent yet" from "nothing to send". Left to work it out, it
   * waited out its own ten second timeout once per unedited module it reads,
   * which is what left a newly created page sitting on its loading fallback
   * long enough to look broken. After this the page knows a module it has not
   * been given has no draft, and renders committed source for it immediately.
   *
   * And then `confirmed`, each time the server takes more of the editor's
   * changes: what makes the page re-read what its server rendered (a loader,
   * a server component), once the server has the edit rather than when it is
   * typed.
   */
  const holds = state.status === "ready" ? state.holds : NO_HOLDS;
  const holdsVersions =
    state.status === "ready" ? state.holdsVersions : NO_HELD_VERSIONS;
  useValCatchUp(isLive, documentEpoch, {
    update: relaySources ? sendSourceUpdate : null,
    holds: () => holds,
    holdsVersions: () => holdsVersions,
    synced: () => send({ val: VAL_CANVAS_MESSAGE, type: "sourcesSynced" }),
    confirmed: (seq) =>
      send({ val: VAL_CANVAS_MESSAGE, type: "confirmed", seq }),
  });

  /**
   * Turn preview mode on when asked from outside.
   *
   * The button lives in the notice above the canvas, which is outside the zoom
   * transform and therefore cannot be this component; the navigation has to
   * happen here, where the frame is. See `enableKey`.
   *
   * Guarded on the KEY's value rather than on "have I run before", and that is
   * the whole of it. `enablePreview` is a `useCallback` over `frameSrc`, so the
   * effect re-runs whenever the canvas changes route — and a "skip the first
   * run" flag says yes to every run after it. The canvas then navigated itself
   * through `/api/val/enable` the moment somebody typed a different route: it
   * turned preview mode on by itself, which is a cookie being set on somebody's
   * site because they looked at a second page.
   */
  const lastEnableKey = useRef(enableKey);
  useEffect(() => {
    if (enableKey === lastEnableKey.current) {
      return;
    }
    lastEnableKey.current = enableKey;
    enablePreview();
  }, [enableKey, enablePreview]);

  /**
   * Say how it is going, once per change.
   *
   * `isEnabling` is part of it: an enable is a redirect and a fresh document,
   * so between the click and the page answering there is nothing in `state`
   * that distinguishes "waiting because we just asked" from "waiting because
   * nothing is coming".
   *
   * But it does not outrank `no-answer`, which is the answer to exactly that
   * question once the timeout has run: an enable that never lands has to reach
   * a diagnosis and the actions that go with it, rather than saying "Turning
   * on…" forever. `isEnabling` is cleared by the page announcing itself, and
   * a page that never announces itself never clears it.
   */
  const status: CanvasPreviewStatus =
    state.status === "no-answer"
      ? "no-answer"
      : isEnabling
        ? "enabling"
        : state.status === "waiting"
          ? "connecting"
          : state.draftMode
            ? "live"
            : "preview-off";
  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  return (
    // `data-val-tour`: the page itself is what a tour step about editing
    // points at. See `StudioTour`.
    <div
      style={{ width, height }}
      className="relative bg-white"
      data-val-tour="canvas"
    >
      <iframe
        ref={frameRef}
        // Remounting is the reload: assigning the same `src` to a live frame is
        // not reliably a navigation, and `contentWindow.location.reload()` is a
        // cross-document call a stricter origin setup would refuse.
        key={`${frameSrc}-${reloadKey}-${held.documentKey}`}
        src={frameSrc}
        title={`Preview of ${url}`}
        style={{ width, height, border: "none", display: "block" }}
        referrerPolicy="same-origin"
      />
      {/*
       * Nothing is drawn over the page here any more.
       *
       * A panel with a blurred backdrop used to cover the frame whenever the
       * canvas could not do its job, which stopped the canvas being a canvas:
       * the published page underneath is real and worth reading and scrolling,
       * and it was unreachable behind an explanation of why it could not be
       * EDITED. `CanvasPreviewNotice`, above the viewport, says the same thing
       * without taking the page away.
       */}
    </div>
  );
}

/** The page, through `/api/val/enable`: sets the cookie, then lands on the page. */
function enableUrlOf(frameSrc: string): string {
  const redirectTo = new URL(frameSrc, window.origin).toString();
  return `/api/val/enable?redirect_to=${encodeURIComponent(redirectTo)}`;
}
