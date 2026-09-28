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
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
