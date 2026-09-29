import { PointerEvent, useEffect, useState } from "react";
import { cn } from "../designSystem/cn";
import { HotspotMarker } from "./HotspotMarker";

type Hotspot = { x: number; y: number };

/**
 * Where the focal point is, picked on the image itself.
 *
 * The image SHRINK-WRAPS, and that is the fix, not a style. It used to be
 * `w-full object-contain` inside a full-width box, so a portrait image was
 * letterboxed inside its own `<img>`: the click was measured against the
 * letterboxed box rather than the picture, and a click on the middle of the
 * subject stored `x: 0.55` for a point at 70%. The marker was drawn in the same
 * wrong frame, so the picker agreed with itself — and every other view of the
 * focal point (the thumbnail, the large preview, the page) disagreed with it.
 * With the element exactly the size of the picture, the element's rect is the
 * picture's rect and there is nothing to translate.
 *
 * The click also used to subtract 6px on both axes, presumably to centre a
 * marker that no longer needs it: `HotspotMarker` centres itself.
 *
 * A drag moves the marker live, and writes ONE patch when it ends: a patch per
 * `pointermove` would put a hundred entries in the history for one decision.
 *
 * The marker is a BUTTON, so the point can be set without a pointer: tab to
 * it, and the arrow keys move it by 1% (10% with Shift), each press one patch,
 * the way the shell's `HotspotPicker` does it. Its label says where it is,
 * and does NOT start with "Focal point": the section's own toggle is named
 * that, and two buttons with one name are two buttons a screen reader cannot
 * tell apart (the e2e suite, which finds the toggle by name, said so first).
 * With no focal point yet it sits, invisible until focused, in the middle —
 * the point an unset focal point already means — so the first arrow press
 * starts from there.
 */
export function FocalPointPicker({
  url,
  hotspot,
  alt,
  readonly,
  id,
  checkerboard,
  onChange,
}: {
  url: string;
  hotspot: Hotspot | undefined;
  alt?: string;
  readonly?: boolean;
  /** Put on the `<img>`, so the field's own path can find it. */
  id?: string;
  /** Draw a checkerboard behind a picture that may be transparent. */
  checkerboard?: boolean;
  onChange: (hotspot: Hotspot) => void;
}) {
  /** The point being dragged, before it is written. */
  const [dragging, setDragging] = useState<Hotspot | null>(null);
  // A new image, or an undo from elsewhere, ends any drag in flight.
  useEffect(() => {
    setDragging(null);
  }, [url, hotspot?.x, hotspot?.y]);
  const shown = dragging ?? hotspot;

  const pointAt = (ev: PointerEvent<HTMLElement>): Hotspot => {
    const { width, height, left, top } =
      ev.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((ev.clientX - left) / width),
      y: clamp01((ev.clientY - top) / height),
    };
  };

  return (
    <div className="flex justify-center rounded-lg bg-bg-secondary p-2">
      <div
        className={cn(
          "relative min-w-0 max-w-full touch-none select-none",
          readonly ? "cursor-default" : "cursor-crosshair",
        )}
        onPointerDown={(ev) => {
          if (readonly || ev.button !== 0) return;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          setDragging(pointAt(ev));
        }}
        onPointerMove={(ev) => {
          if (!ev.currentTarget.hasPointerCapture(ev.pointerId)) return;
          setDragging(pointAt(ev));
        }}
        onPointerUp={(ev) => {
          if (!ev.currentTarget.hasPointerCapture(ev.pointerId)) return;
          ev.currentTarget.releasePointerCapture(ev.pointerId);
          const point = pointAt(ev);
          // Kept on screen until the patch comes back as `hotspot`, which
          // clears it: dropping it now would flash the old point for a frame.
          setDragging(point);
          onChange(point);
        }}
        onPointerCancel={() => setDragging(null)}
      >
        <img
          id={id}
          src={url}
          alt={alt ?? ""}
          draggable={false}
          className={cn(
            "block h-auto max-h-[500px] w-auto max-w-full rounded",
            checkerboard && "val-checkerboard",
          )}
        />
        {shown && <HotspotMarker hotspot={shown} />}
        <button
          type="button"
          disabled={readonly}
          aria-label={
            shown
              ? `Point to keep in frame, ${percent(shown.x)} across and ${percent(shown.y)} down. Use the arrow keys to move it.`
              : "Point to keep in frame, not set. Use the arrow keys to set it."
          }
          onKeyDown={(ev) => {
            const step = ev.shiftKey ? 0.1 : 0.01;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            };
            const move = moves[ev.key];
            if (!move) return;
            ev.preventDefault();
            const from = shown ?? CENTRE;
            onChange({
              x: round(clamp01(from.x + move[0])),
              y: round(clamp01(from.y + move[1])),
            });
          }}
          style={{
            left: `${(shown ?? CENTRE).x * 100}%`,
            top: `${(shown ?? CENTRE).y * 100}%`,
          }}
          className={cn(
            "absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
            readonly ? "cursor-default" : "cursor-crosshair",
          )}
        />
      </div>
    </div>
  );
}

const CENTRE: Hotspot = { x: 0.5, y: 0.5 };

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Keyboard steps land on whole hundredths. Adding 0.01 to a float drifts
 * (0.7 + 0.01 is 0.7100000000000001), and the drift is what would be saved.
 */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
