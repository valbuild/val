import { Loader2 } from "lucide-react";
import { cn } from "./cn";

/**
 * Even sizes only: Safari rotates an SVG about a half-pixel centre by
 * snapping it to the device grid on every frame, so an odd-sized spinner
 * visibly orbits its own centre instead of turning in place.
 */
export type SpinnerSize = 10 | 12 | 14 | 16 | 18 | 20 | 24;

/**
 * The one loading spinner. Use it rather than `<Loader2 className="animate-spin" />`.
 *
 * What spins is the wrapping span, on its own compositing layer, never the
 * SVG: Safari re-rasterizes a spinning SVG every frame and rounds its position
 * each time, so one that sits at a fractional offset (which flex centring
 * produces all the time) wobbles off centre on a 2x screen. A composited
 * layer is drawn once and turned as a bitmap.
 */
export function Spinner({
  size = 16,
  className,
  "aria-hidden": ariaHidden,
}: {
  size?: SpinnerSize;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn(
        "inline-flex shrink-0 animate-spin items-center justify-center will-change-transform",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Loader2 size={size} className="block" />
    </span>
  );
}
