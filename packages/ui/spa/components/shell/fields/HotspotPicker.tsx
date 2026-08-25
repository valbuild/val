import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, RotateCcw } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { CENTER_HOTSPOT } from "./types";

export type Hotspot = { x: number; y: number };

/**
 * The focal point of an image, as a point rather than a crop rectangle.
 *
 * Val does not crop images — the customer's layout does, at whatever aspect
 * ratio their design asks for. So the question the editor can actually answer
 * is not "which rectangle do you want" but "what must stay in frame", and one
 * point answers it for every ratio at once. That is why this follows
 * Storyblok's focus point rather than the crop-handles pattern: crop handles
 * promise a decision the CMS is not in a position to make.
 *
 * The crop previews below are the proof. They are the same `object-position`
 * the site will use, so what you see is arithmetic rather than a promise.
 */
export function HotspotPicker({
  url,
  alt,
  hotspot,
  onChange,
}: {
  url: string;
  alt: string;
  /** Absent means the middle, which is what a crop does on its own. */
  hotspot?: Hotspot;
  onChange: (hotspot: Hotspot | undefined) => void;
}) {
  const point = hotspot ?? CENTER_HOTSPOT;
  const frameRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const setFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      onChange({
        x: clamp01((clientX - rect.left) / rect.width),
        y: clamp01((clientY - rect.top) / rect.height),
      });
    },
    [onChange],
  );

  // Dragging is tracked on the window so the point keeps following the pointer
  // once it leaves the image, which is exactly when you are aiming at an edge.
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (event: PointerEvent) =>
      setFromEvent(event.clientX, event.clientY);
    const onUp = () => setIsDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, setFromEvent]);

  const nudge = (dx: number, dy: number) =>
    onChange({ x: clamp01(point.x + dx), y: clamp01(point.y + dy) });

  return (
    <div className="space-y-3">
      <div
        ref={frameRef}
        onPointerDown={(event) => {
          setIsDragging(true);
          setFromEvent(event.clientX, event.clientY);
        }}
        className="relative overflow-hidden rounded-md border border-border-float cursor-crosshair select-none touch-none"
      >
        <img src={url} alt={alt} className="block w-full" draggable={false} />
        {/* Guides, so the point reads as a coordinate and not as a sticker. */}
        <span
          aria-hidden
          style={{ top: `${point.y * 100}%` }}
          className="absolute inset-x-0 h-px bg-white/40 mix-blend-difference"
        />
        <span
          aria-hidden
          style={{ left: `${point.x * 100}%` }}
          className="absolute inset-y-0 w-px bg-white/40 mix-blend-difference"
        />
        <button
          type="button"
          aria-label={`Focal point, ${percent(point.x)} across and ${percent(point.y)} down. Use the arrow keys to adjust.`}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.01;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            nudge(move[0], move[1]);
          }}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full",
            "border-2 border-bg-page-selection bg-bg-page-selection-fill backdrop-blur-[1px]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg-page-selection",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-bg-page-selection" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Coordinate
          axis="X"
          value={point.x}
          onChange={(x) => onChange({ ...point, x })}
        />
        <Coordinate
          axis="Y"
          value={point.y}
          onChange={(y) => onChange({ ...point, y })}
        />
        <button
          type="button"
          onClick={() => onChange(CENTER_HOTSPOT)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-float px-2.5 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Crosshair size={13} />
          Centre
        </button>
        {hotspot && (
          // Clearing is not the same as centring: an image with no hotspot
          // stores nothing, and picks up whatever default the site uses.
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-secondary-alt hover:text-fg-primary"
          >
            <RotateCcw size={13} />
            Clear
          </button>
        )}
      </div>

      <CropPreviews url={url} alt={alt} hotspot={point} />
    </div>
  );
}

/** One axis of the focal point, as the percentage the site will use. */
function Coordinate({
  axis,
  value,
  onChange,
}: {
  axis: "X" | "Y";
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
      {axis}
      <span className="inline-flex h-8 items-center rounded-md border border-border-float bg-bg-surface pr-2">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isNaN(next)) return;
            onChange(clamp01(next / 100));
          }}
          className="w-14 bg-transparent px-2 text-xs tabular-nums text-fg-primary outline-none"
        />
        <span className="text-[0.6875rem] text-fg-secondary-alt">%</span>
      </span>
    </label>
  );
}

/** The ratios a page actually asks for, and what the focal point does to them. */
const CROPS: ReadonlyArray<{ label: string; ratio: string }> = [
  { label: "16:9", ratio: "16 / 9" },
  { label: "1:1", ratio: "1 / 1" },
  { label: "3:4", ratio: "3 / 4" },
];

function CropPreviews({
  url,
  alt,
  hotspot,
}: {
  url: string;
  alt: string;
  hotspot: Hotspot;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[0.6875rem] text-fg-secondary-alt">
        How it crops
      </p>
      <div className="flex gap-2">
        {CROPS.map((crop) => (
          <figure key={crop.label} className="flex flex-col items-center">
            {/* A fixed height and a ratio, rather than a fixed width: the
                previews then share a baseline and the captions line up. */}
            <div
              style={{ aspectRatio: crop.ratio, height: "3.5rem" }}
              className="overflow-hidden rounded border border-border-float"
            >
              <img
                src={url}
                alt={`${alt} — ${crop.label} crop`}
                style={{
                  objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%`,
                }}
                className="h-full w-full object-cover"
              />
            </div>
            <figcaption className="mt-1 text-[0.625rem] tabular-nums text-fg-secondary-alt">
              {crop.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
