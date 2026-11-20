import { useRef, useState, type CSSProperties } from "react";
import { cn } from "../../designSystem/cn";

/** How far an arrow key moves a column's edge. */
const KEYBOARD_STEP_PX = 24;

/**
 * The handle on a column's edge, for dragging the column wider or narrower:
 * Content's, on its right edge beside the preview, and Sketch's and the
 * Assistant's, on their left. The preview has none of its own: it is the
 * anchor, and takes whatever room the columns beside it leave.
 *
 * A `separator` with the keyboard behaviour that implies, not just a draggable
 * strip: how much room the page gets against how much a pane gets is a real
 * decision, and one that should not need a mouse to make. Double-click puts
 * the column back to its designed width.
 *
 * The hit area is wider than the line it draws, because a 1px target is a
 * target nobody hits. The drag follows the pointer by pointer capture, not by
 * where the pointer is over: it leaves the handle at once, and over the
 * preview it would be inside another document, which swallows its events.
 */
export function ColumnDivider({
  label,
  edge,
  width,
  min,
  max,
  onResize,
  onReset,
  onDraggingChange,
  className,
  style,
  lineClassName = "inset-y-0",
}: {
  label: string;
  /** Which edge of its column it is on: dragging away from the column widens it. */
  edge: "left" | "right";
  /** The column's width now. */
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** Back to the designed width. */
  onReset?: () => void;
  /** While it is being dragged, so the column can stop animating its width. */
  onDraggingChange?: (dragging: boolean) => void;
  className?: string;
  style?: CSSProperties;
  /** Where the drawn line runs, inside the hit area. */
  lineClassName?: string;
}) {
  const [dragging, setDragging] = useState(false);
  /** Away from the column is wider: right for a right edge, left for a left one. */
  const sign = edge === "right" ? 1 : -1;
  const clamp = (px: number) => Math.round(Math.min(max, Math.max(min, px)));
  // The limits move as the layout follows the drag; the drag reads them now.
  const limits = useRef({ min, max });
  limits.current = { min, max };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(Math.max(min, max))}
      tabIndex={0}
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startWidth = width;
        setDragging(true);
        onDraggingChange?.(true);
        const move = (moveEvent: PointerEvent) => {
          const { min: low, max: high } = limits.current;
          const next = startWidth + sign * (moveEvent.clientX - startX);
          onResize(Math.round(Math.min(high, Math.max(low, next))));
        };
        const finish = () => {
          setDragging(false);
          onDraggingChange?.(false);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft"
            ? -KEYBOARD_STEP_PX
            : event.key === "ArrowRight"
              ? KEYBOARD_STEP_PX
              : 0;
        if (step === 0) return;
        event.preventDefault();
        onResize(clamp(width + sign * step));
      }}
      className={cn(
        // `z-hover`: the grab handle sits over the edge of both panes.
        "group w-3 shrink-0 cursor-col-resize touch-none focus-visible:outline-none",
        className,
      )}
    >
      {/* The line, centred in the wider hit area. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 w-px -translate-x-1/2 rounded-full transition-colors",
          lineClassName,
          dragging
            ? "bg-fg-brand-primary"
            : "bg-border-float group-hover:bg-fg-secondary group-focus-visible:bg-fg-brand-primary",
        )}
      />
    </div>
  );
}
