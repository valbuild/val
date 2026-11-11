import {
  Maximize2,
  Minus,
  Monitor,
  Plus,
  RotateCw,
  Smartphone,
  Tablet,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { CanvasDevice } from "./types";

const DEVICES: readonly CanvasDevice[] = ["desktop", "tablet", "mobile"];

const DEVICE_ICON: Record<CanvasDevice, typeof Monitor> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

/**
 * The canvas's own controls: what width the page is shown at and how far it
 * is zoomed.
 *
 * Picking is not here. It was, and the trouble with that was a pick has an
 * owner — Content opens the field, the assistant is told about it — and one
 * button on the page could not say which. Each owner has its own Select now,
 * in its header (`SelectButton`).
 *
 * Floats over the canvas rather than sitting above it, so the canvas keeps
 * the full height — the same reasoning as the shell's other bars.
 */
export function CanvasToolbar({
  device,
  onDeviceChange,
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onReload,
  isRefreshing,
  docked = false,
  className,
}: {
  device: CanvasDevice;
  /**
   * Absent where the width is chosen elsewhere -- Review's comparison, whose
   * one switch sets both sides -- and the toolbar shows no widths of its own.
   */
  onDeviceChange?: (device: CanvasDevice) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /**
   * Load the page again.
   *
   * Needed because the canvas shows a document Val does not control the
   * rendering of: a server component re-reads content when the page is
   * requested, not when a patch is written, so there are changes that only a
   * reload brings across. Absent when there is nothing to reload — the demo
   * page is rendered from data that is already live.
   */
  onReload?: () => void;
  /**
   * The page is re-rendering because of an edit.
   *
   * Shown on the reload button rather than as a control of its own: what is
   * happening IS a reload — the page is fetching itself again because the
   * content changed — so the button that does it by hand is the honest place to
   * say it is happening by itself.
   */
  isRefreshing?: boolean;
  /**
   * On a phone: the bottom edge of the page's card, a full-width row with a
   * line above it, tap-sized -- as the Sketchpad's tools are docked to its
   * page -- instead of a pill floating under the card.
   */
  docked?: boolean;
  className?: string;
}) {
  // Tap-sized where it is docked, as the Sketchpad's tools are.
  const size = docked ? "h-10 w-10" : "h-7 w-7";
  return (
    <div
      role="toolbar"
      aria-label="Preview"
      className={cn(
        "flex items-center gap-1",
        docked
          ? "w-full justify-center border-t border-border-float bg-bg-float px-2 py-1"
          : "rounded-lg border border-border-float bg-bg-float p-1 shadow-lg",
        // On a phone the canvas is a pane a little narrower than the screen,
        // and this is nine controls: it has to be able to run out of room
        // without pushing itself off both sides of the page it sits on.
        //
        // `[&>*]:shrink-0` is what makes it SCROLL rather than squash. A flex
        // child shrinks below its own width by default, so without this the
        // buttons quietly compress towards their 14px icons and the dividers
        // vanish — the strip always fits, and never once overflows enough to
        // scroll.
        !docked && "max-w-[calc(100%-1.5rem)]",
        "overflow-x-auto scrollbar-none [&>*]:shrink-0",
        className,
      )}
    >
      {onDeviceChange !== undefined &&
        DEVICES.map((option) => {
          const Icon = DEVICE_ICON[option];
          return (
            <button
              key={option}
              type="button"
              aria-label={`${option} width`}
              aria-pressed={device === option}
              onClick={() => onDeviceChange(option)}
              className={cn(
                cn("grid place-items-center rounded-md", size),
                device === option
                  ? "bg-bg-float-raised text-fg-primary"
                  : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
              )}
            >
              <Icon size={14} />
            </button>
          );
        })}
      {onDeviceChange !== undefined && <Divider />}
      <button
        type="button"
        aria-label="Zoom out"
        onClick={onZoomOut}
        className={cn(
          "grid place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          size,
        )}
      >
        <Minus size={14} />
      </button>
      <span className="w-11 text-center text-[0.6875rem] tabular-nums text-fg-secondary">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={onZoomIn}
        className={cn(
          "grid place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          size,
        )}
      >
        <Plus size={14} />
      </button>
      {/*
       * The way back to the default view, which is the page at the width of
       * the pane, from the top — not the whole page at once. See
       * `fitWidthScale`.
       */}
      <button
        type="button"
        aria-label="Fit page width"
        title="Show the page at the width of the pane, from the top"
        onClick={onFit}
        className={cn(
          "grid place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          size,
        )}
      >
        <Maximize2 size={13} />
      </button>
      {onReload && (
        <>
          <Divider />
          <button
            type="button"
            aria-label={isRefreshing ? "Updating the page" : "Reload the page"}
            title={
              isRefreshing
                ? "The page is re-rendering with your change"
                : "Reload the page"
            }
            onClick={onReload}
            className={cn(
              "grid place-items-center rounded-md hover:bg-bg-float-raised hover:text-fg-primary",
              size,
              isRefreshing ? "text-fg-brand-primary" : "text-fg-secondary",
            )}
          >
            {/* The span spins, not the SVG: see designSystem/spinner. */}
            <span
              className={cn(
                "inline-flex",
                isRefreshing && "animate-spin will-change-transform",
              )}
            >
              <RotateCw size={14} />
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border-float" />;
}
