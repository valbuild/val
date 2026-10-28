import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CANVAS_SELECTION,
  DEFAULT_CANVAS_SELECTION_SOFT,
  isValCanvasPageMessage,
  type PageLocation,
  type PageSnapshot,
  type PickedElement,
  type PickModifier,
  VAL_CANVAS_MESSAGE,
  ValCanvasElement,
  type ValCanvasPageMessage,
  ValCanvasStudioMessage,
  withValCanvasParam,
} from "@valbuild/shared/internal";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { CanvasPinch } from "./CanvasWindow";
import { CanvasPreviewStatus } from "./CanvasPreviewNotice";
import { CanvasPoint } from "./types";
import {
  useValPendingSourceSnapshot,
  useValSourceUpdates,
} from "../../../stores/react/ValOverlayEmitter";

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
  | { status: "ready"; draftMode: boolean }
  | { status: "no-answer" };

/**
 * How long to wait for the page to announce itself before assuming it cannot.
 *
 * Generous, because the first load of a route in `next dev` compiles it. The
 * cost of being wrong in this direction is a spinner that lingers; in the other
 * it is telling someone to enable a mode that is already on.
 */
export const ANSWER_TIMEOUT_MS = 8000;

export type CanvasFrameProps = {
  /** The page's own URL, e.g. `/blogs/blog1`; absolute when `origin` is another. */
  url: string;
  width: number | string;
  height: number | string;
  /**
   * The origin the page is served from, when it is not the Studio's: the
   * design tab frames a proposal's address from the site's
   * (valbuild/home `docs/design-tab.md`). Messages are sent to it, and preview
   * mode is turned on there.
   */
  origin?: string;
  /**
   * Whether this Studio's edits are relayed into the page. Off when the page is
   * not this Studio's content: a proposal's page reads its own drafts, and the
   * site's would be the wrong ones. The page is still told when there is
   * nothing to wait for (`sourcesSynced`).
   */
  relaySources?: boolean;
  /**
   * Load the page through `/api/val/enable` every time, so it is in preview
   * mode from its first document. The design tab's frame: the proposal's
   * address is another origin, which the Studio's own enable never reached,
   * and without the cookie it sets the page mounts no bridge -- nothing on it
   * can be picked, and the tab learns that only from a timeout.
   */
  throughEnable?: boolean;
  /** Bumped to reload. */
  reloadKey: number;
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
   * Picking ANY element, the design tab's way (`pickElements` in
   * `valCanvasProtocol`): `null` off, absent never sent. `isPicking` is the
   * other kind, of the fields Val tagged.
   */
  elementPicking?: {
    active: boolean;
    modifier: PickModifier;
    keepPicked: boolean;
  } | null;
  onPickElement?: (element: PickedElement) => void;
  /** Esc on the page while `elementPicking.active`. */
  onElementPickingStopped?: () => void;
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
  /** Whether the page says it is re-rendering. See `ValCanvasBridge`. */
  onRefreshingChange?: (isRefreshing: boolean) => void;
  /** Where the page is, as it moves: its path and scroll (`location`). */
  onLocation?: (location: PageLocation) => void;
  /**
   * Where each new document is scrolled to once it says it is there: the
   * design tab swapping a new build in where the last one was.
   */
  scrollTo?: { x: number; y: number } | null;
  /**
   * Handed the way to read the page (`readPage`), and `null` when the frame
   * goes: the assistant's `read_page`.
   */
  onPageReader?: (reader: PageReader | null) => void;
};

/** Read what is on the page: see `readPageSnapshot`. */
export type PageReader = (options: {
  selector?: string;
  maxItems?: number;
}) => Promise<PageSnapshot>;

/** How long a page is given to answer `readPage`. */
export const PAGE_READ_TIMEOUT_MS = 5000;

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
  origin = typeof window === "undefined" ? "" : window.origin,
  relaySources = true,
  throughEnable = false,
  reloadKey,
  isPicking,
  selectionColors,
  highlightedPath,
  onElements,
  onPick,
  elementPicking,
  onPickElement,
  onElementPickingStopped,
  onPinch,
  onZoom,
  onRefreshingChange,
  enableKey = 0,
  onStatusChange,
  onLocation,
  scrollTo = null,
  onPageReader,
}: CanvasFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
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

  // The URL the frame is actually given: the page, marked as a canvas load so
  // it renders itself without its own overlay.
  const frameSrc = useMemo(() => withValCanvasParam(url), [url]);

  /** Send one message into the frame. */
  const send = useCallback(
    (message: ValCanvasStudioMessage) => {
      // The page's origin -- the Studio's own unless told otherwise -- named
      // rather than left as `*`.
      frameRef.current?.contentWindow?.postMessage(message, origin);
    },
    [origin],
  );

  // A reload is a new document, so whatever the last one said no longer holds.
  useEffect(() => {
    setState({ status: "waiting" });
    onRefreshingChange?.(false);
  }, [frameSrc, reloadKey, onRefreshingChange]);

  useEffect(() => {
    if (state.status !== "waiting") return;
    const timer = setTimeout(
      () => setState({ status: "no-answer" }),
      ANSWER_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [state.status, frameSrc, reloadKey]);

  // What the page says.
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      // Only this frame, and only messages shaped like the protocol: a window
      // hears from anything holding a handle on it.
      if (event.source !== frameRef.current?.contentWindow) return;
      // A frame of another origin is held to it; the Studio's own pages are
      // already the only thing `source` can be.
      if (origin !== window.origin && event.origin !== origin) return;
      if (!isValCanvasPageMessage(event.data)) return;
      const message = event.data;
      if (message.type === "ready") {
        setState({ status: "ready", draftMode: message.draftMode });
        setDocumentEpoch((epoch) => epoch + 1);
        setIsEnabling(false);
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
      } else if (message.type === "location") {
        onLocation?.({
          path: message.path,
          scrollX: message.scrollX,
          scrollY: message.scrollY,
        });
      } else if (message.type === "pageRead") {
        const reading = readings.current.get(message.requestId);
        if (reading === undefined) return;
        readings.current.delete(message.requestId);
        reading(message);
      } else {
        pickedHere.current = message.paths[0] ?? null;
        onPick?.(message.paths);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [
    onElements,
    onPick,
    onPickElement,
    onElementPickingStopped,
    onPinch,
    onZoom,
    onRefreshingChange,
    onLocation,
    origin,
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
          if (answer.snapshot !== null) resolve(answer.snapshot);
          else reject(new Error(answer.error ?? "The page could not be read."));
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
    [send],
  );
  useEffect(() => {
    if (onPageReader === undefined) return;
    onPageReader(readPage);
    return () => onPageReader(null);
  }, [onPageReader, readPage]);

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
    });
  }, [
    send,
    pickEnabled,
    pickActive,
    pickModifier,
    keepPicked,
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
      frameRef.current.src = enableUrlOf(frameSrc, origin);
    }
  }, [frameSrc, origin]);

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
    (moduleFilePath: ModuleFilePath, source: unknown) => {
      send({
        val: VAL_CANVAS_MESSAGE,
        type: "sourceUpdate",
        moduleFilePath,
        source,
      });
    },
    [send],
  );
  useValSourceUpdates(isLive && relaySources, sendSourceUpdate);

  /**
   * And catch the page up the moment it is listening.
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
   */
  const sendPendingSources = useValPendingSourceSnapshot();
  useEffect(() => {
    if (!isLive) return;
    if (relaySources) sendPendingSources(sendSourceUpdate);
    /**
     * And say that was all of it.
     *
     * Only modules with patches are ever sent — an unedited module has no draft
     * to send — so a page waiting for draft sources cannot tell "not sent yet"
     * from "nothing to send". Left to work it out, it waited out its own ten
     * second timeout once per unedited module it reads, which is what left a
     * newly created page sitting on its loading fallback long enough to look
     * broken. After this the page knows a module it has not been given has no
     * draft, and renders committed source for it immediately.
     */
    send({ val: VAL_CANVAS_MESSAGE, type: "sourcesSynced" });
  }, [
    isLive,
    relaySources,
    documentEpoch,
    sendPendingSources,
    sendSourceUpdate,
    send,
  ]);

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
        key={`${frameSrc}-${reloadKey}`}
        src={throughEnable ? enableUrlOf(frameSrc, origin) : frameSrc}
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

/** The page, through `/api/val/enable` at its own origin: the cookie it sets is the page's. */
function enableUrlOf(frameSrc: string, origin: string): string {
  const redirectTo = new URL(frameSrc, origin).toString();
  return `${origin === window.origin ? "" : origin}/api/val/enable?redirect_to=${encodeURIComponent(
    redirectTo,
  )}`;
}
