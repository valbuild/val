import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  isValCanvasPageMessage,
  VAL_CANVAS_MESSAGE,
  ValCanvasElement,
  ValCanvasStudioMessage,
  withValCanvasParam,
} from "@valbuild/shared/internal";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { cn } from "../../designSystem/cn";
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
const ANSWER_TIMEOUT_MS = 8000;

export type CanvasFrameProps = {
  /** The page's own URL, e.g. `/blogs/blog1`. */
  url: string;
  width: number;
  height: number;
  /** Bumped to reload. */
  reloadKey: number;
  /** Whether a click on the page picks the element under it. */
  isPicking: boolean;
  /** The path to outline, or null for none. */
  highlightedPath: SourcePath | null;
  /** The elements Val tracks on the page, as the page reports them. */
  onElements?: (elements: ValCanvasElement[]) => void;
  /** Something on the page was picked. */
  onPick?: (paths: SourcePath[]) => void;
  /** Ask for the page again — used when enabling preview needs a reload. */
  onRequestReload: () => void;
  /** Whether the page says it is re-rendering. See `ValCanvasBridge`. */
  onRefreshingChange?: (isRefreshing: boolean) => void;
};

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
  reloadKey,
  isPicking,
  highlightedPath,
  onElements,
  onPick,
  onRequestReload,
  onRefreshingChange,
}: CanvasFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<FrameState>({ status: "waiting" });
  const [isEnabling, setIsEnabling] = useState(false);

  // The URL the frame is actually given: the page, marked as a canvas load so
  // it renders itself without its own overlay.
  const frameSrc = useMemo(() => withValCanvasParam(url), [url]);

  /** Send one message into the frame. */
  const send = useCallback((message: ValCanvasStudioMessage) => {
    // Same origin as the studio — the page is served by the same app — so the
    // target origin can be named rather than left as `*`.
    frameRef.current?.contentWindow?.postMessage(message, window.origin);
  }, []);

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
      if (!isValCanvasPageMessage(event.data)) return;
      const message = event.data;
      if (message.type === "ready") {
        setState({ status: "ready", draftMode: message.draftMode });
        setIsEnabling(false);
      } else if (message.type === "elements") {
        onElements?.(message.elements);
      } else if (message.type === "refreshing") {
        onRefreshingChange?.(message.pending);
      } else {
        onPick?.(message.paths);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onElements, onPick, onRefreshingChange]);

  // Picking and highlighting are pushed rather than set on the frame: they are
  // properties of the page's behaviour, and only the page can apply them.
  useEffect(() => {
    send({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: isPicking });
  }, [send, isPicking, state.status]);

  useEffect(() => {
    send({
      val: VAL_CANVAS_MESSAGE,
      type: "highlight",
      path: highlightedPath,
      scrollIntoView: true,
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
    const redirectTo = new URL(frameSrc, window.location.origin).toString();
    const enableUrl = `/api/val/enable?redirect_to=${encodeURIComponent(
      redirectTo,
    )}`;
    if (frameRef.current) {
      frameRef.current.src = enableUrl;
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
  useValSourceUpdates(isLive, sendSourceUpdate);

  /**
   * And catch the page up the moment it is listening.
   *
   * The relay above only carries a *change*, which is nothing at all for a page
   * that has just loaded: whatever it got from the server is what it shows, and
   * a freshly opened canvas sometimes showed published content beside an editor
   * full of edits — then corrected itself on the next keystroke, which made it
   * look intermittent rather than like a missing step.
   *
   * Keyed on the reload as well as on going live, because a reload is a new
   * document with the same problem.
   */
  const sendPendingSources = useValPendingSourceSnapshot();
  useEffect(() => {
    if (!isLive) return;
    sendPendingSources(sendSourceUpdate);
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
  }, [isLive, reloadKey, sendPendingSources, sendSourceUpdate, send]);

  const blocked =
    (state.status === "ready" && !state.draftMode) ||
    state.status === "no-answer";

  return (
    <div style={{ width, height }} className="relative bg-white">
      <iframe
        ref={frameRef}
        // Remounting is the reload: assigning the same `src` to a live frame is
        // not reliably a navigation, and `contentWindow.location.reload()` is a
        // cross-document call a stricter origin setup would refuse.
        key={`${frameSrc}-${reloadKey}`}
        src={frameSrc}
        title={`Preview of ${url}`}
        style={{ width, height, border: "none", display: "block" }}
        referrerPolicy="same-origin"
      />
      {blocked && (
        <PreviewBlocked
          isEnabling={isEnabling}
          onEnable={enablePreview}
          onReload={onRequestReload}
          unreachable={state.status === "no-answer"}
        />
      )}
    </div>
  );
}

/**
 * Shown over the page when the canvas cannot do its job.
 *
 * Over rather than instead of: the published page underneath is real, and worth
 * seeing. What is missing is that nothing on it is selectable, which is what
 * this says.
 */
function PreviewBlocked({
  isEnabling,
  onEnable,
  onReload,
  unreachable,
}: {
  isEnabling: boolean;
  onEnable: () => void;
  onReload: () => void;
  /** True when the page never answered at all, rather than answering "off". */
  unreachable: boolean;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-bg-canvas/80 backdrop-blur-sm p-6">
      <div className="max-w-sm rounded-lg border border-border-float bg-bg-float p-5 text-center shadow-lg">
        <h3 className="text-sm font-medium text-fg-primary">
          {unreachable ? "No answer from the page" : "Preview mode is off"}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
          {unreachable
            ? "The page loaded but did not report back. It may be an older version of Val, or preview mode may have been turned off elsewhere."
            : "Without preview mode the canvas shows the published page, and nothing on it can be selected or edited."}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onEnable}
            disabled={isEnabling}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
              "bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary",
              "hover:bg-bg-brand-primary-hover",
              "disabled:bg-bg-disabled disabled:text-fg-disabled",
            )}
          >
            {isEnabling && <Loader2 size={13} className="animate-spin" />}
            {isEnabling ? "Turning on…" : "Turn on preview mode"}
          </button>
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <RefreshCw size={13} />
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
