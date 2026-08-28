import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../designSystem/cn";
import { CanvasPoint } from "./types";

/**
 * As far out as the window will go.
 *
 * Low enough that a 1280px page still fits a phone-width pane: fitting clamps
 * to this, so a floor the fit cannot reach shows up as a page that overflows a
 * window which claims to be showing all of it.
 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 2;
/** Room left around the page when fitting, so it does not touch the edges. */
const FIT_PADDING = 24;
/** How much one press of + or - changes the zoom. */
export const ZOOM_STEP = 1.2;

/** A two-finger gesture, as the page reports it. */
export type CanvasPinch = {
  phase: "start" | "move" | "end";
  /** Distance between the fingers, in the page's own CSS px. */
  span: number;
  /** Midpoint of the fingers, in the page's own coordinates. */
  center: CanvasPoint;
};

/**
 * What the window can be asked to do from outside.
 *
 * Imperative rather than another piece of state, because every one of these
 * has to read the scroll position and write it back in the same beat — and a
 * scroll position that went through a render would be one frame behind the
 * finger that is moving it.
 */
export type CanvasWindowHandle = {
  /**
   * Zoom by a factor, keeping `center` under the same point on screen.
   *
   * `center` is in the page's own coordinates. `null` means the middle of the
   * window, which is what the toolbar's + and - want: there is no pointer
   * involved, so the honest anchor is whatever you are looking at.
   */
  zoomBy(factor: number, center: CanvasPoint | null): void;
  /** Show the whole page at once. */
  fit(): void;
  /** A two-finger gesture relayed out of the page. See {@link CanvasPinch}. */
  pinch(gesture: CanvasPinch): void;
};

export type CanvasWindowProps = {
  /** Logical width of the page being shown, in CSS px. */
  pageWidth: number;
  scale: number;
  onScaleChange: (scale: number) => void;
  /**
   * Keep the whole page in view as things move.
   *
   * The window is the only thing that knows both sizes involved — its own and
   * the page's — so it is the only thing that can hold a fit as either changes.
   * The DECISION is not its: the caller turns this off the moment the person
   * zooms, because after that the fit is no longer what they asked to see.
   */
  autoFit?: boolean;
  /**
   * Where the window was left scrolled, from a link.
   *
   * Applied once, when the page has a size to scroll within — before that
   * there is nothing to scroll and the browser would clamp it to zero.
   */
  initialScroll?: CanvasPoint | null;
  /** Reported as the window is scrolled, so a link can carry the position. */
  onScrollChange?: (scroll: CanvasPoint) => void;
  children: ReactNode;
  className?: string;
};

/**
 * The page, in a window.
 *
 * This used to be a canvas: the page floated on an infinite surface and you
 * dragged the background to move it. That is the right model for a design tool
 * and the wrong one here, and a phone is where it becomes obvious — there is no
 * background to drag when the page fills the pane, dragging the page itself
 * scrolls the page (correctly), and the result was a surface that could be
 * moved by nobody and stranded by anybody.
 *
 * So it is a window instead: the page sits inside it at a size you choose, and
 * if it does not fit, the window scrolls. Nothing floats, nothing can be lost
 * off the edge, and the scrolling is the browser's own — which on a touch
 * device means it has momentum, rubber-banding and every other thing a
 * hand-written pan does not.
 *
 * The page keeps its own layout at its own width — the window only scales it —
 * so what you see is the page as the browser would lay it out, not a re-flow of
 * it. That was always the point of looking at it this way, and it is unchanged:
 * a 1280px page stays a 1280px page while you zoom out to see all of it.
 *
 * ## Who gets a gesture
 *
 * One finger belongs to the PAGE — it scrolls it, taps its links, drags
 * whatever the page put there. Two belong to the WINDOW, and pinch both zooms
 * and moves the page inside it. Nothing has to be moded and the two cannot be
 * confused for one another, which is the whole reason for the split.
 *
 * A gesture that lands on the page arrives here from `ValCanvasBridge` over
 * `postMessage`: the page is a frame, and a frame keeps its own touches.
 */
export const CanvasWindow = forwardRef<CanvasWindowHandle, CanvasWindowProps>(
  function CanvasWindow(
    {
      pageWidth,
      scale,
      onScaleChange,
      autoFit = false,
      initialScroll,
      onScrollChange,
      children,
      className,
    },
    forwardedRef,
  ) {
    const windowRef = useRef<HTMLDivElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);

    /**
     * The page's laid-out height.
     *
     * Measured rather than given, because the two things that go in here know
     * it in different ways: a frame is given a height and a demo page is as
     * tall as its content. Measured on the UNSCALED element, so the number is
     * the page's own height whatever the zoom — a transform does not change
     * layout size.
     */
    const [pageHeight, setPageHeight] = useState(0);
    useEffect(() => {
      const el = pageRef.current;
      if (!el) return;
      const observer = new ResizeObserver(() => setPageHeight(el.offsetHeight));
      observer.observe(el);
      setPageHeight(el.offsetHeight);
      return () => observer.disconnect();
    }, []);

    /**
     * The scale, as the imperative handlers below see it.
     *
     * They can run several times between two renders — a pinch reports every
     * frame — so reading the prop would mean every gesture after the first in a
     * frame computing from a scale that has already been superseded. Written
     * eagerly by the handlers and re-synced from the prop on render.
     */
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const pageHeightRef = useRef(pageHeight);
    pageHeightRef.current = pageHeight;

    /**
     * Where to scroll once the new scale has been laid out.
     *
     * Zooming and scrolling have to happen together — that is what makes a zoom
     * land on the thing you pointed at rather than on the middle — but the
     * scroll extents only exist after the bigger or smaller page has been laid
     * out. So the target is computed with the old layout (where the maths is
     * exact) and applied in a layout effect, before the browser paints either.
     */
    const pendingScroll = useRef<CanvasPoint | null>(null);
    useLayoutEffect(() => {
      const target = pendingScroll.current;
      const el = windowRef.current;
      if (target === null || !el) return;
      pendingScroll.current = null;
      el.scrollLeft = target.x;
      el.scrollTop = target.y;
    }, [scale]);

    /**
     * Zoom, holding one point of the page still.
     *
     * `at` is where the pointer or the fingers are NOW; `hold` is the point
     * that should end up there. For a wheel or a button the two are the same
     * point. For a pinch they are not: `hold` is where the fingers went down,
     * which is what makes a pinch drag the page as well as scale it — and what
     * keeps it from chasing its own tail, since `hold` is fixed for the whole
     * gesture rather than re-derived from a layout this is about to change.
     */
    const applyZoom = useCallback(
      (nextScale: number, at: CanvasPoint, hold: CanvasPoint) => {
        const el = windowRef.current;
        if (!el) return;
        const from = scaleRef.current;
        const to = clampScale(nextScale);
        const page = { width: pageWidth, height: pageHeightRef.current };
        const target = anchoredScroll(el, page, from, to, at, hold);
        if (to === from) {
          // Nothing to re-lay-out, so nothing to wait for — and a pinch held at
          // the zoom limit is still moving the page, which would otherwise stop
          // dead the moment the scale stopped changing.
          el.scrollLeft = target.x;
          el.scrollTop = target.y;
          return;
        }
        pendingScroll.current = target;
        scaleRef.current = to;
        onScaleChange(to);
      },
      [pageWidth, onScaleChange],
    );

    /** The middle of the window, in the page's own coordinates. */
    const windowCenter = useCallback((): CanvasPoint => {
      const el = windowRef.current;
      const scale = scaleRef.current;
      if (!el) return { x: 0, y: 0 };
      const page = { width: pageWidth, height: pageHeightRef.current };
      return {
        x:
          (el.scrollLeft +
            el.clientWidth / 2 -
            centeringOffset(el.clientWidth, page.width * scale)) /
          scale,
        y:
          (el.scrollTop +
            el.clientHeight / 2 -
            centeringOffset(el.clientHeight, page.height * scale)) /
          scale,
      };
    }, [pageWidth]);

    const fit = useCallback(() => {
      const el = windowRef.current;
      if (!el || pageHeightRef.current === 0) return;
      const next = fitScale(
        { width: pageWidth, height: pageHeightRef.current },
        { width: el.clientWidth, height: el.clientHeight },
      );
      // Back to the top left as well as out: fitting is "show me the whole
      // thing", and a fitted page that is still scrolled somewhere is not that.
      pendingScroll.current = { x: 0, y: 0 };
      if (next === scaleRef.current) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
        pendingScroll.current = null;
        return;
      }
      scaleRef.current = next;
      onScaleChange(next);
    }, [pageWidth, onScaleChange]);

    /** Where the fingers went down, held for the length of the gesture. */
    const pinchOrigin = useRef<{ span: number; center: CanvasPoint } | null>(
      null,
    );
    /**
     * And the scale they went down at.
     *
     * The gesture is a ratio against where it STARTED, not a nudge per frame:
     * accumulating per-frame factors drifts, and lets a pinch that ends where it
     * began leave the page at a different zoom than it found it.
     */
    const pinchStartScale = useRef(scale);
    const pinch = useCallback(
      (gesture: CanvasPinch) => {
        if (gesture.phase === "end") {
          pinchOrigin.current = null;
          return;
        }
        if (gesture.phase === "start" || pinchOrigin.current === null) {
          // A `move` with no origin means the `start` was lost — a frame that
          // reloaded mid-gesture, say. Treating it as the start is better than
          // dividing by a span nobody measured.
          pinchOrigin.current = {
            span: gesture.span,
            center: gesture.center,
          };
          pinchStartScale.current = scaleRef.current;
          return;
        }
        const origin = pinchOrigin.current;
        if (origin.span <= 0) return;
        applyZoom(
          pinchStartScale.current * (gesture.span / origin.span),
          gesture.center,
          origin.center,
        );
      },
      [applyZoom],
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        zoomBy: (factor, center) => {
          const anchor = center ?? windowCenter();
          applyZoom(scaleRef.current * factor, anchor, anchor);
        },
        fit,
        pinch,
      }),
      [applyZoom, windowCenter, fit, pinch],
    );

    /**
     * The window's own size.
     *
     * Only needed to hold a fit — a fit is a relationship between two boxes,
     * and this is the other one. Kept as state rather than read on demand
     * because the fit has to follow a resize, and nothing else would re-run.
     */
    const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
      const el = windowRef.current;
      if (!el) return;
      const measure = () =>
        setWindowSize((current) =>
          current.width === el.clientWidth && current.height === el.clientHeight
            ? current
            : { width: el.clientWidth, height: el.clientHeight },
        );
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      measure();
      return () => observer.disconnect();
    }, []);

    /**
     * Hold the fit while it is wanted.
     *
     * Re-run rather than run once, because the page's height is not known for a
     * frame or two after a frame mounts — measuring too early fits to a page a
     * tenth of its real size — and because the box keeps changing afterwards:
     * the editor column finishes moving a third of a second after the click,
     * and the device switch re-lays-out the page entirely.
     */
    useEffect(() => {
      if (!autoFit || pageHeight === 0 || windowSize.height === 0) return;
      fit();
    }, [autoFit, pageHeight, windowSize, pageWidth, fit]);

    /**
     * ctrl/cmd + wheel zooms, which is what a trackpad pinch reports as.
     *
     * A native listener rather than React's `onWheel`, because it has to
     * cancel: without that the browser zooms the whole studio at the same time,
     * and React registers `wheel` passively at the root, where `preventDefault`
     * does nothing. A plain wheel is deliberately left alone — that is the
     * window scrolling, and the browser does it better than this could.
     */
    useEffect(() => {
      const el = windowRef.current;
      if (!el) return;
      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const scale = scaleRef.current;
        const page = { width: pageWidth, height: pageHeightRef.current };
        const anchor = {
          x:
            (event.clientX -
              rect.left +
              el.scrollLeft -
              centeringOffset(el.clientWidth, page.width * scale)) /
            scale,
          y:
            (event.clientY -
              rect.top +
              el.scrollTop -
              centeringOffset(el.clientHeight, page.height * scale)) /
            scale,
        };
        applyZoom(scale * (1 - event.deltaY / 300), anchor, anchor);
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [applyZoom, pageWidth]);

    /**
     * The position a link would carry, reported as it changes.
     *
     * Coalesced into an animation frame: a scroll fires far more often than
     * anything upstream can use, and every one of those is a render of the
     * whole shell plus a write to the URL.
     */
    const scrollFrame = useRef<number | null>(null);
    const onScroll = useCallback(() => {
      if (!onScrollChange || scrollFrame.current !== null) return;
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        const el = windowRef.current;
        if (!el) return;
        onScrollChange({ x: el.scrollLeft, y: el.scrollTop });
      });
    }, [onScrollChange]);
    useEffect(
      () => () => {
        if (scrollFrame.current !== null) {
          cancelAnimationFrame(scrollFrame.current);
        }
      },
      [],
    );

    /**
     * Where a link left the window looking.
     *
     * Once, and only once there is something to scroll: applied against a page
     * that has not been laid out yet, the browser clamps it to zero and the
     * link looks like it did not work.
     */
    const hasRestored = useRef(false);
    useLayoutEffect(() => {
      if (hasRestored.current || !initialScroll) return;
      const el = windowRef.current;
      if (!el || pageHeight === 0) return;
      hasRestored.current = true;
      el.scrollLeft = initialScroll.x;
      el.scrollTop = initialScroll.y;
    }, [initialScroll, pageHeight]);

    return (
      <div
        ref={windowRef}
        onScroll={onScroll}
        className={cn(
          "relative overflow-auto overscroll-contain bg-bg-canvas scrollbar-slim",
          // The dotted ground is what makes it read as a surface the page is
          // placed on rather than as a page with margins. Kept from the canvas
          // it replaces: the model changed, the look did not need to.
          "[background-image:radial-gradient(var(--border-float)_1px,transparent_1px)] [background-size:24px_24px]",
          className,
        )}
      >
        {/*
         * The centring box.
         *
         * `w-max`/`h-max` with a `min-*-full` floor, rather than flex centring
         * on the scroller itself: a centred flex item that overflows its
         * container spills off BOTH edges, and the half that goes off the start
         * edge cannot be scrolled back to. Sizing this box to the larger of the
         * page and the window means there is never negative free space for the
         * centring to mishandle.
         */}
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
          <div
            style={{
              width: pageWidth * scale,
              height: pageHeight * scale,
            }}
            className="shrink-0"
          >
            <div
              ref={pageRef}
              style={{
                width: pageWidth,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
              }}
              className="will-change-transform"
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The scale that shows a page of this size in a window of that size.
 *
 * Exported so the toolbar's fit button, the initial state and the tests all
 * agree, and so it can be checked without a browser.
 */
export function fitScale(
  page: { width: number; height: number },
  window: { width: number; height: number },
): number {
  const available = {
    width: Math.max(1, window.width - FIT_PADDING * 2),
    height: Math.max(1, window.height - FIT_PADDING * 2),
  };
  return clampScale(
    Math.min(available.width / page.width, available.height / page.height),
  );
}

/**
 * How far a box is pushed in to sit in the middle of a window.
 *
 * Zero once the box is bigger than the window: at that point the box starts at
 * the window's edge and the rest is scrolled to, which is exactly what the
 * centring box above does. Both have to agree, or a zoom lands off by half the
 * difference.
 */
function centeringOffset(window: number, content: number): number {
  return Math.max(0, (window - content) / 2);
}

/**
 * Where the window has to be scrolled for `hold` to land where `at` is now.
 *
 * Both points are in the page's own coordinates. The screen position of `at`
 * under the current scale is worked out first — that is where the pointer or
 * the fingers physically are — and then the scroll that puts `hold` there under
 * the new scale.
 *
 * Exported for the test: this is the whole of "zoom towards the pointer", and
 * every way of getting it wrong looks the same from outside (the page drifts).
 */
export function anchoredScroll(
  window: {
    clientWidth: number;
    clientHeight: number;
    scrollLeft: number;
    scrollTop: number;
  },
  page: { width: number; height: number },
  from: number,
  to: number,
  at: CanvasPoint,
  hold: CanvasPoint,
): CanvasPoint {
  const screenX =
    centeringOffset(window.clientWidth, page.width * from) -
    window.scrollLeft +
    at.x * from;
  const screenY =
    centeringOffset(window.clientHeight, page.height * from) -
    window.scrollTop +
    at.y * from;
  return {
    x:
      centeringOffset(window.clientWidth, page.width * to) +
      hold.x * to -
      screenX,
    y:
      centeringOffset(window.clientHeight, page.height * to) +
      hold.y * to -
      screenY,
  };
}
