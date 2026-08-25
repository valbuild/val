import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  WheelEvent,
} from "react";
import { cn } from "../../designSystem/cn";
import { CanvasTransform } from "./types";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2;
/** Room left around the page when fitting, so it does not touch the edges. */
const FIT_PADDING = 48;

export type CanvasViewportProps = {
  /** Logical width of the page being shown, in CSS px. */
  pageWidth: number;
  transform: CanvasTransform;
  onTransformChange: (transform: CanvasTransform) => void;
  children: ReactNode;
  className?: string;
  /**
   * Whether a horizontal wheel gesture pans the canvas.
   *
   * On a phone the canvas sits inside a pane that scrolls horizontally, and
   * a trackpad swipe is then consumed twice — once by the pane, once by the
   * canvas. Because the pane clamps at its ends and the canvas does not, the
   * two disagree by a little on every swipe, and the page walks off to one
   * side as you move back and forth. Dragging the background still pans in
   * both directions, so nothing is lost by leaving the horizontal wheel to
   * the pane that has somewhere to go with it.
   */
  horizontalWheelPans?: boolean;
};

/**
 * A pan and zoom surface with the page inside it.
 *
 * The page keeps its own layout at its own width — the canvas only moves and
 * scales it — so what you see is the page as the browser would lay it out,
 * not a re-flow of it. That is the whole point of looking at it this way: a
 * 1280px page stays a 1280px page while you zoom out to see all of it.
 *
 * Trackpad scroll pans, pinch or ctrl/cmd+scroll zooms, and dragging the
 * background pans — the conventions from every design tool, so nobody has to
 * learn this one. `horizontalWheelPans` is the one exception, for when the
 * canvas is inside something that scrolls sideways itself.
 */
export const CanvasViewport = forwardRef<HTMLDivElement, CanvasViewportProps>(
  function CanvasViewport(
    {
      pageWidth,
      transform,
      onTransformChange,
      children,
      className,
      horizontalWheelPans = true,
    },
    forwardedRef,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    // The parent measures this element to fit the page; the component needs it
    // too, to zoom toward the pointer.
    useImperativeHandle(
      forwardedRef,
      () => viewportRef.current as HTMLDivElement,
    );
    const [isPanning, setIsPanning] = useState(false);
    const panOrigin = useRef<{ x: number; y: number } | null>(null);

    const onWheel = useCallback(
      (event: WheelEvent<HTMLDivElement>) => {
        // ctrl/cmd + wheel is what a trackpad pinch reports as, so the two
        // gestures land in the same branch.
        if (event.ctrlKey || event.metaKey) {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          const next = clampScale(transform.scale * (1 - event.deltaY / 300));
          // Zoom toward the pointer rather than the centre, so the thing under
          // the cursor stays under the cursor.
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const ratio = next / transform.scale;
          onTransformChange({
            scale: next,
            x: px - (px - transform.x) * ratio,
            y: py - (py - transform.y) * ratio,
          });
          return;
        }
        onTransformChange({
          ...transform,
          x: horizontalWheelPans ? transform.x - event.deltaX : transform.x,
          y: transform.y - event.deltaY,
        });
      },
      [transform, onTransformChange, horizontalWheelPans],
    );

    useEffect(() => {
      if (!isPanning) return;
      const onMove = (event: PointerEvent) => {
        const origin = panOrigin.current;
        if (!origin) return;
        onTransformChange({
          ...transform,
          x: event.clientX - origin.x,
          y: event.clientY - origin.y,
        });
      };
      const onUp = () => {
        setIsPanning(false);
        panOrigin.current = null;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    }, [isPanning, transform, onTransformChange]);

    return (
      <div
        ref={viewportRef}
        onWheel={onWheel}
        onPointerDown={(event) => {
          // Only the background pans. A drag that starts on the page itself is
          // a selection, not a pan.
          if (event.target !== event.currentTarget) return;
          panOrigin.current = {
            x: event.clientX - transform.x,
            y: event.clientY - transform.y,
          };
          setIsPanning(true);
        }}
        className={cn(
          "relative overflow-hidden bg-bg-canvas",
          // The dotted ground is what makes it read as a canvas rather than a
          // page with margins.
          "[background-image:radial-gradient(var(--border-float)_1px,transparent_1px)] [background-size:24px_24px]",
          isPanning ? "cursor-grabbing" : "cursor-grab",
          className,
        )}
      >
        <div
          style={{
            width: pageWidth,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
          }}
          className="absolute top-0 left-0 origin-top-left will-change-transform"
        >
          {children}
        </div>
      </div>
    );
  },
);

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The transform that centres a page of this size in a viewport of that size.
 *
 * Exported so the toolbar's "fit" button and the initial state agree, and so
 * it can be tested without a browser.
 */
export function fitTransform(
  page: { width: number; height: number },
  viewport: { width: number; height: number },
): CanvasTransform {
  const available = {
    width: Math.max(1, viewport.width - FIT_PADDING * 2),
    height: Math.max(1, viewport.height - FIT_PADDING * 2),
  };
  const scale = clampScale(
    Math.min(available.width / page.width, available.height / page.height),
  );
  return {
    scale,
    x: (viewport.width - page.width * scale) / 2,
    y: (viewport.height - page.height * scale) / 2,
  };
}
