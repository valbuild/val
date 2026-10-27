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
 * window which claims to be showing the whole width of it.
 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 2;
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
  /**
   * Back to the default view: the page at the window's width, from the top.
   *
   * See {@link fitWidthScale} for why that is the default rather than the
   * whole page at once.
   */
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
   * Keep the page at the window's width as things move.
   *
   * The window is the only thing that knows its own size, so it is the only
   * thing that can hold a fit as that changes. The DECISION is not its: the
   * caller turns this off the moment the person zooms, because after that the
   * fit is no longer what they asked to see.
   *
   * Holding it does NOT move the window: the top is pinned when the fit is
   * ASKED for — opened, reloaded, the device switched, the fit button — and not
   * again every time the pane is resized, because a page someone has scrolled
   * down should not jump back to the top because the divider moved.
   */
  autoFit?: boolean;
  /**
   * Someone zoomed, by any of the ways of asking.
   *
   * Reported so the caller can stop wanting a fit. It cannot infer that from
   * `onScaleChange`, because fitting changes the scale too — and a zoom the
   * caller did not hear about is one the next resize silently undoes.
   */
  onUserZoom?: () => void;
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
 * ## Where it starts
 *
 * At the window's WIDTH, from the TOP — see {@link fitWidthScale}. Fitting the
 * whole page instead sounds more helpful and is not: the page is as tall as a
 * viewport, so the height was usually the side that ran out first, and the
 * result was a page shown smaller than the room it had with empty canvas down
 * both sides. The top is where a page begins, and the rest of it is a scroll
 * away, which is how looking at a page works everywhere else.
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
      onUserZoom,
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
     *
     * Only the box the scaled page is reserved in needs it. It does NOT decide
     * the scale any more, and nothing about a zoom is computed from it: the
     * page is pinned to the top rather than centred, so there is no vertical
     * free space whose size anything has to know.
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
        /*
         * Every route into here is someone asking for a zoom — the buttons, a
         * wheel, a pinch. Fitting is not: it goes straight to `onScaleChange`.
         * So this is the one place that has to say so, and saying it here is
         * what keeps the wheel handler below from being the one path that
         * forgets: it does not go through the caller at all, so a zoom over the
         * canvas background used to leave the fit armed and be thrown away by
         * the next resize.
         */
        onUserZoom?.();
        const from = scaleRef.current;
        const to = clampScale(nextScale);
        const target = anchoredScroll(el, pageWidth, from, to, at, hold);
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
      [pageWidth, onScaleChange, onUserZoom],
    );

    /** The middle of the window, in the page's own coordinates. */
    const windowCenter = useCallback((): CanvasPoint => {
      const el = windowRef.current;
      const scale = scaleRef.current;
      if (!el) return { x: 0, y: 0 };
      return {
        x:
          (el.scrollLeft +
            el.clientWidth / 2 -
            centeringOffset(el.clientWidth, pageWidth * scale)) /
          scale,
        // No vertical offset to undo: the page is pinned to the top of the
        // window rather than centred in it. See {@link centeringOffset}.
        y: (el.scrollTop + el.clientHeight / 2) / scale,
      };
    }, [pageWidth]);

    /**
     * Put the page at the window's width.
     *
     * `pinTop` is the difference between being asked for the default view and
     * merely keeping it: asked for, the window goes back to the top as well,
     * because "show me the page" means from the beginning of it. Keeping it —
     * every resize while {@link CanvasWindowProps.autoFit} is on — must not,
     * or the page someone had scrolled down jumps back up because the split
     * divider moved a pixel.
     */
    const fitWidth = useCallback(
      (pinTop: boolean) => {
        const el = windowRef.current;
        // Before the pane has been laid out there is no width to fit to, and
        // the observer below re-runs this the moment there is.
        if (!el || el.clientWidth === 0) return;
        const next = fitWidthScale(pageWidth, el.clientWidth);
        if (next === scaleRef.current) {
          if (pinTop) {
            el.scrollLeft = 0;
            el.scrollTop = 0;
          }
          return;
        }
        if (pinTop) pendingScroll.current = { x: 0, y: 0 };
        scaleRef.current = next;
        onScaleChange(next);
      },
      [pageWidth, onScaleChange],
    );
    const fit = useCallback(() => fitWidth(true), [fitWidth]);

    /**
     * Where the fingers went down, held for the length of the gesture.
     *
     * The span is stored in SCREEN px — see {@link screenSpan} — while the
     * centre stays in the page's own coordinates, because that is what
     * `anchoredScroll` anchors on and a page coordinate does not move when the
     * zoom does.
     */
    const pinchOrigin = useRef<{
      span: number;
      center: CanvasPoint;
      scale: number;
    } | null>(null);
    const pinch = useCallback(
      (gesture: CanvasPinch) => {
        if (gesture.phase === "end") {
          pinchOrigin.current = null;
          return;
        }
        const span = screenSpan(gesture.span, scaleRef.current);
        if (gesture.phase === "start" || pinchOrigin.current === null) {
          // A `move` with no origin means the `start` was lost — a frame that
          // reloaded mid-gesture, say. Treating it as the start is better than
          // dividing by a span nobody measured.
          pinchOrigin.current = {
            span,
            center: gesture.center,
            scale: scaleRef.current,
          };
          return;
        }
        const origin = pinchOrigin.current;
        if (origin.span <= 0) return;
        applyZoom(
          origin.scale * (span / origin.span),
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
     * The window's own width.
     *
     * Only needed to hold a fit — a fit to the width is a relationship between
     * two numbers, and this is the other one. Kept as state rather than read on
     * demand because the fit has to follow a resize, and nothing else would
     * re-run. The height is nobody's business: it does not decide the scale any
     * more, and watching it would refit every time a horizontal scrollbar
     * appeared.
     */
    const [windowWidth, setWindowWidth] = useState(0);
    useEffect(() => {
      const el = windowRef.current;
      if (!el) return;
      const measure = () =>
        setWindowWidth((current) =>
          current === el.clientWidth ? current : el.clientWidth,
        );
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      measure();
      return () => observer.disconnect();
    }, []);

    /**
     * Hold the fit while it is wanted.
     *
     * Re-run rather than run once, because the box keeps changing after the
     * canvas opens: the editor column finishes moving a third of a second after
     * the click, the divider can be dragged, and the window itself resized.
     *
     * Without `pinTop`: this is the fit being MAINTAINED, not asked for. See
     * {@link fitWidth}.
     */
    useEffect(() => {
      if (!autoFit || windowWidth === 0) return;
      fitWidth(false);
    }, [autoFit, windowWidth, pageWidth, fitWidth]);

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
        const anchor = {
          x:
            (event.clientX -
              rect.left +
              el.scrollLeft -
              centeringOffset(el.clientWidth, pageWidth * scale)) /
            scale,
          // Nothing to undo vertically — the page starts at the top of the
          // window. See {@link centeringOffset}.
          y: (event.clientY - rect.top + el.scrollTop) / scale,
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
          /*
           * `overflow-y-scroll`, not `auto`, and that is load bearing now that
           * the scale is decided by the width.
           *
           * A vertical scrollbar takes 10px off `clientWidth` (see
           * `scrollbar-slim`), so with `auto` there is a narrow band of window
           * heights where fitting the width makes the page just tall enough to
           * need the bar, the bar makes the window narrower, the narrower fit
           * makes the page short enough not to need it — and round again,
           * forever, at whatever width the divider was left at. Reserving the
           * gutter always means the number the fit is computed from does not
           * depend on the fit's own result.
           */
          "relative overflow-x-auto overflow-y-scroll overscroll-contain bg-bg-canvas scrollbar-slim",
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
         *
         * Centred across and pinned to the TOP: `items-start`. A page narrower
         * than the window — a phone layout in a wide pane, anything zoomed out
         * — reads as a page on a surface when it is centred horizontally, and a
         * page whose top is half way down the window does not read as the top
         * of a page at all. `anchoredScroll` and `windowCenter` agree with this
         * by leaving the vertical offset out.
         */}
        <div className="flex h-max min-h-full w-max min-w-full items-start justify-center">
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

/**
 * A finger span, converted out of the page's pixels and into the screen's.
 *
 * The page is inside a scaled box, and a scaled box has its own idea of a
 * pixel: at 50% zoom, two fingers 200 screen px apart land 400 page px apart,
 * and the page — which measures in its own coordinates and knows nothing about
 * the zoom — reports 400.
 *
 * That unit cannot be used for a pinch, because the pinch is what changes the
 * number it is divided by. Take the ratio in page px and the next scale works
 * out as `s0² · r / s`, which in terms of `k = s / s0` is `k' = r / k` — a
 * period-2 map. Held at a steady 2×, it does not settle at 2×: it alternates
 * between 1× and 2× on every frame, so the canvas strobes under the fingers and
 * a completed 4× pinch lands somewhere near 2×.
 *
 * One frame of it looks perfect, which is the trap — the first `move` still has
 * the starting scale, so a test that sends a single move sees exactly the right
 * answer. It takes two.
 *
 * Multiplying by the scale the reading was taken at undoes the box, leaving a
 * distance that means the same thing on every frame.
 */
export function screenSpan(pageSpan: number, scale: number): number {
  return pageSpan * scale;
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The scale that shows a page of this width in a window of that width.
 *
 * The WIDTH, and no padding: the page is meant to reach both edges of the pane,
 * because every pixel of width given back to the canvas is a pixel of the page
 * not being shown. What does not fit vertically is scrolled to.
 *
 * Never larger than 1:1, which is the half that is not obvious. A phone layout
 * in a desktop-sized pane would fit its width at nearly 3×, and a 390px page
 * blown up to 1100px is not a preview of anything — it is the same page with
 * everything wrong about it. Bigger than life is something to ask for with the
 * + button, not something to be given.
 *
 * Exported so the fit button, the window and the tests all agree, and so it can
 * be checked without a browser.
 */
export function fitWidthScale(pageWidth: number, windowWidth: number): number {
  // A window that has not been laid out yet, which is the first frame of every
  // canvas: 1:1 until there is something to measure against.
  if (pageWidth <= 0 || windowWidth <= 0) return 1;
  return clampScale(Math.min(1, windowWidth / pageWidth));
}

/**
 * How far a box is pushed in to sit in the middle of a window, ACROSS.
 *
 * Horizontally only. There is no vertical counterpart: the page is pinned to
 * the top of the window (`items-start` above), so its vertical offset is always
 * zero and the callers leave the term out rather than multiplying by one.
 *
 * Zero once the box is wider than the window: at that point the box starts at
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
 * Only the page's WIDTH comes into it, because only the horizontal axis centres
 * — see {@link centeringOffset}. The page's height decides nothing here.
 *
 * Exported for the test: this is the whole of "zoom towards the pointer", and
 * every way of getting it wrong looks the same from outside (the page drifts).
 */
export function anchoredScroll(
  window: {
    clientWidth: number;
    scrollLeft: number;
    scrollTop: number;
  },
  pageWidth: number,
  from: number,
  to: number,
  at: CanvasPoint,
  hold: CanvasPoint,
): CanvasPoint {
  const screenX =
    centeringOffset(window.clientWidth, pageWidth * from) -
    window.scrollLeft +
    at.x * from;
  const screenY = -window.scrollTop + at.y * from;
  return {
    x:
      centeringOffset(window.clientWidth, pageWidth * to) +
      hold.x * to -
      screenX,
    y: hold.y * to - screenY,
  };
}
