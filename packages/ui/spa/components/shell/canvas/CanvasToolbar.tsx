import {
  Maximize2,
  Minus,
  Monitor,
  MousePointerClick,
  Plus,
  RotateCw,
  Smartphone,
  Tablet,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { CanvasDevice } from "./types";

const DEVICE_ICON: Record<CanvasDevice, typeof Monitor> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

/**
 * The canvas's own controls: what width the page is shown at and how far it
 * is zoomed.
 *
 * Picking is here too, because it is a property of the page rather than of the
 * column beside it. It used to follow from the view, which meant the only way
 * to select something on the page was to give up the module editor for the
 * fields list — and no way at all to read the page normally while still being
 * able to point at a bit of it. Switching views still sets it, since each view
 * has an obvious default; the button is how you disagree.
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
  isPicking,
  onPickingChange,
  onReload,
  isRefreshing,
  className,
}: {
  device: CanvasDevice;
  onDeviceChange: (device: CanvasDevice) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /**
   * Whether a click on the page selects what it hits.
   *
   * Absent where picking means nothing — the demo page in Storybook reports no
   * paths, so there is nothing for a click to select.
   */
  isPicking?: boolean;
  onPickingChange?: (isPicking: boolean) => void;
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
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border-float bg-bg-float p-1 shadow-lg",
        className,
      )}
    >
      {(Object.keys(DEVICE_ICON) as CanvasDevice[]).map((option) => {
        const Icon = DEVICE_ICON[option];
        return (
          <button
            key={option}
            type="button"
            aria-label={`${option} width`}
            aria-pressed={device === option}
            onClick={() => onDeviceChange(option)}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-md",
              device === option
                ? "bg-bg-float-raised text-fg-primary"
                : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
            )}
          >
            <Icon size={14} />
          </button>
        );
      })}
      <Divider />
      <button
        type="button"
        aria-label="Zoom out"
        onClick={onZoomOut}
        className="grid h-7 w-7 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
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
        className="grid h-7 w-7 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        aria-label="Fit page to screen"
        onClick={onFit}
        className="grid h-7 w-7 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
      >
        <Maximize2 size={13} />
      </button>
      {onPickingChange && (
        <>
          <Divider />
          <button
            type="button"
            aria-label={
              isPicking ? "Stop selecting on the page" : "Select on the page"
            }
            aria-pressed={isPicking}
            title={
              isPicking
                ? "Clicking the page selects what it hits"
                : "Clicking the page follows links, as a visitor would"
            }
            onClick={() => onPickingChange(!isPicking)}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-md",
              isPicking
                ? // The green the page's own outlines are drawn in, so the
                  // button and what it does read as the same thing.
                  "bg-bg-page-selection-fill text-fg-brand-primary ring-1 ring-inset ring-bg-page-selection"
                : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
            )}
          >
            <MousePointerClick size={14} />
          </button>
        </>
      )}
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
              "grid h-7 w-7 place-items-center rounded-md hover:bg-bg-float-raised hover:text-fg-primary",
              isRefreshing ? "text-fg-brand-primary" : "text-fg-secondary",
            )}
          >
            <RotateCw
              size={13}
              className={cn(isRefreshing && "animate-spin")}
            />
          </button>
        </>
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border-float" />;
}
