import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import {
  OVERLAY_LAUNCHER_SIZE,
  OVERLAY_MARGIN,
  OverlayPlacement,
  OverlayViewport,
  fullViewport,
  placementStyle,
  snapPlacement,
} from "./overlayPlacement";

/** How far a press has to travel before it is a drag rather than a tap. */
const DRAG_THRESHOLD = 5;
/** The settle after a drop: quick, with a soft landing. */
const SETTLE = "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)";

function readViewport(): OverlayViewport {
  const layoutWidth = window.innerWidth;
  const layoutHeight = window.innerHeight;
  const visual = window.visualViewport;
  if (!visual) return fullViewport(layoutWidth, layoutHeight);
  return {
    left: visual.offsetLeft,
    top: visual.offsetTop,
    width: Math.min(visual.width, layoutWidth),
    height: Math.min(visual.height, layoutHeight),
    layoutWidth,
    layoutHeight,
  };
}

/** The visible part of the page, kept up to date. See `OverlayViewport`. */
function useOverlayViewport(): OverlayViewport {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const update = () => {
      const next = readViewport();
      setViewport((prev) =>
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.layoutWidth === next.layoutWidth &&
        prev.layoutHeight === next.layoutHeight
          ? prev
          : next,
      );
    };
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  return viewport;
}

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where in the circle it was picked up, so it does not jump to the pointer. */
  grabX: number;
  grabY: number;
  active: boolean;
};

/**
 * Holds the overlay menu at its placement, and lets it be dragged anywhere
 * and dropped: wherever it is let go, it snaps to the nearest edge of the
 * viewport and stays as far along that edge as it was.
 *
 * Pointer events, not the HTML drag and drop it used to be built on: that
 * has no touch support at all, so on a phone the menu could not be moved,
 * and on desktop it dragged a translucent screenshot while the real menu sat
 * still. Here the menu itself follows the pointer or the finger.
 *
 * A press becomes a drag only once it has moved `DRAG_THRESHOLD` px, so a
 * tap on a button is still a tap. The click that ends a drag is swallowed,
 * or letting go over the Studio button would follow the link.
 *
 * The landing is animated FLIP-style: the menu is moved to its new placement
 * at once, offset back to where it was dropped, and the offset is then
 * animated away — so the snap is one transform, whatever the placement's
 * anchoring did.
 */
export function OverlayMenuDock({
  placement,
  onPlacementChange,
  children,
  className,
}: {
  placement: OverlayPlacement;
  onPlacementChange: (placement: OverlayPlacement) => void;
  children: (state: { dragging: boolean }) => ReactNode;
  className?: string;
}) {
  const viewport = useOverlayViewport();
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const flipFrom = useRef<DOMRect | null>(null);
  // The circle's top left while it is being carried.
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const dragging = dragAt !== null;
  const detach = useRef<(() => void) | null>(null);
  useEffect(() => () => detach.current?.(), []);

  // Kept inside what can be seen while it is carried.
  const positionFor = (clientX: number, clientY: number, g: Gesture) => {
    const v = readViewport();
    const x = clientX - g.grabX;
    const y = clientY - g.grabY;
    const maxX = v.left + v.width - OVERLAY_LAUNCHER_SIZE;
    const maxY = v.top + v.height - OVERLAY_LAUNCHER_SIZE;
    return {
      x: Math.min(maxX, Math.max(v.left, x)),
      y: Math.min(maxY, Math.max(v.top, y)),
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (gesture.current) return;
    const circle = outerRef.current?.querySelector(
      "[data-overlay-launcher-circle]",
    );
    const rect = circle?.getBoundingClientRect();
    // The offset of the press from the collapsed menu's top left. Pressed
    // anywhere other than the circle, the menu collapses as the drag starts,
    // and the circle comes to the pointer.
    const half = OVERLAY_LAUNCHER_SIZE / 2;
    const clampGrab = (d: number) => Math.min(half, Math.max(-half, d));
    const grabX = rect
      ? half + clampGrab(event.clientX - (rect.left + rect.width / 2))
      : half;
    const grabY = rect
      ? half + clampGrab(event.clientY - (rect.top + rect.height / 2))
      : half;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX,
      grabY,
      active: false,
    };

    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (!g.active) {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.active = true;
      }
      e.preventDefault();
      setDragAt(positionFor(e.clientX, e.clientY, g));
    };
    const finish = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      gesture.current = null;
      detach.current?.();
      if (!g.active) return;
      const at = positionFor(e.clientX, e.clientY, g);
      const half = OVERLAY_LAUNCHER_SIZE / 2;
      const v = readViewport();
      const next = snapPlacement(
        { x: at.x + half - v.left, y: at.y + half - v.top },
        { width: v.width, height: v.height },
      );
      flipFrom.current = outerRef.current?.getBoundingClientRect() ?? null;
      setDragAt(null);
      onPlacementChange(next);
      if (e.type === "pointerup") swallowNextClick();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      detach.current = null;
    };
  };

  // The landing: from where it was let go to where it snapped.
  useLayoutEffect(() => {
    const from = flipFrom.current;
    const inner = innerRef.current;
    const outer = outerRef.current;
    if (!from || dragging || !inner || !outer) return;
    flipFrom.current = null;
    const to = outer.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx === 0 && dy === 0) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    inner.style.transition = "none";
    inner.style.transform = `translate(${dx}px, ${dy}px)`;
    // Commit the offset before animating it away.
    void inner.getBoundingClientRect();
    inner.style.transition = SETTLE;
    inner.style.transform = "";
    const clear = () => {
      inner.style.transition = "";
    };
    inner.addEventListener("transitionend", clear, { once: true });
  }, [placement, dragging]);

  const style: React.CSSProperties = dragAt
    ? { position: "fixed", left: dragAt.x, top: dragAt.y }
    : placementStyle(placement, viewport);

  return (
    <div
      ref={outerRef}
      style={{ ...style, maxWidth: `calc(100vw - ${OVERLAY_MARGIN * 2}px)` }}
      onPointerDown={onPointerDown}
      // Links in the bar would otherwise start the browser's own drag.
      onDragStart={(e) => e.preventDefault()}
      data-overlay-dragging={dragging ? "" : undefined}
      className={cn(
        // `touch-action: none`, or a finger on the menu scrolls the page
        // and the browser cancels the pointer before it is a drag.
        "touch-none select-none",
        dragging ? "cursor-grabbing" : undefined,
        className,
      )}
    >
      <div ref={innerRef}>{children({ dragging })}</div>
    </div>
  );
}

/**
 * Swallows the click a drag ends with. Capture phase on `window`, so it is
 * stopped before the button or link it was let go over hears it, and given
 * up shortly after in case the browser sends no click at all (a touch drag
 * usually does not).
 */
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener("click", swallow, true);
  };
  window.addEventListener("click", swallow, true);
  window.setTimeout(
    () => window.removeEventListener("click", swallow, true),
    300,
  );
}
