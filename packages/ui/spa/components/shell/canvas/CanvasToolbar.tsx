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
import { useEffect, useRef } from "react";
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
  pickNeedsPreview = false,
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
   * Picking cannot work yet, because preview mode is off.
   *
   * The button is still drawn — outlined, so it stands out under the notice
   * that says why — and pressing it always asks for picking ON: the caller
   * turns preview mode on first, and the page starts selecting once it comes
   * back in draft mode. A toggle here would turn picking OFF for someone in
   * the fields view, where it is already on and simply has nothing to select,
   * which is the opposite of what they pressed it for.
   */
  pickNeedsPreview?: boolean;
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
  const stripRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  /**
   * Brings the outlined pick button into view when it is the thing to press.
   *
   * On a phone the strip runs out of room and scrolls, and the pick button is
   * towards its far end — so the button the notice above is pointing at could
   * be scrolled out of sight. Only the strip's own offset is set, never
   * `scrollIntoView`: that walks out to every scrolling ancestor, and on a
   * phone one of those is the track holding the two panes.
   */
  useEffect(() => {
    const strip = stripRef.current;
    const pick = pickRef.current;
    if (!pickNeedsPreview || !strip || !pick) return;
    // The strip is `relative`, so it is the button's offset parent and this is
    // the button's place along the strip whatever it is scrolled to.
    const start = pick.offsetLeft;
    const end = start + pick.offsetWidth;
    if (start < strip.scrollLeft) {
      strip.scrollLeft = start;
    } else if (end > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = end - strip.clientWidth;
    }
  }, [pickNeedsPreview]);
  return (
    <div
      ref={stripRef}
      className={cn(
        "relative flex items-center gap-1 rounded-lg border border-border-float bg-bg-float p-1 shadow-lg",
        // On a phone the canvas is a pane a little narrower than the screen,
        // and this is nine controls: it has to be able to run out of room
        // without pushing itself off both sides of the page it sits on.
        //
        // `[&>*]:shrink-0` is what makes it SCROLL rather than squash. A flex
        // child shrinks below its own width by default, so without this the
        // buttons quietly compress towards their 14px icons and the dividers
        // vanish — the strip always fits, and never once overflows enough to
        // scroll.
        "max-w-[calc(100%-1.5rem)] overflow-x-auto scrollbar-none [&>*]:shrink-0",
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
        className="grid h-7 w-7 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
      >
        <Maximize2 size={13} />
      </button>
      {onPickingChange && (
        <>
          <Divider />
          <button
            ref={pickRef}
            type="button"
            aria-label={
              pickNeedsPreview
                ? "Turn preview on and pick from the page"
                : isPicking
                  ? "Stop selecting on the page"
                  : "Select on the page"
            }
            aria-pressed={pickNeedsPreview ? false : isPicking}
            title={
              pickNeedsPreview
                ? "Turns on preview mode, then clicking the page selects what it hits"
                : isPicking
                  ? "Clicking the page selects what it hits"
                  : "Clicking the page follows links, as a visitor would"
            }
            onClick={() =>
              onPickingChange(pickNeedsPreview ? true : !isPicking)
            }
            className={cn(
              "grid h-7 w-7 place-items-center rounded-md",
              pickNeedsPreview
                ? // Outlined, not filled: it is the way out of the state the
                  // notice above describes, and not yet selecting anything.
                  "text-fg-primary ring-1 ring-inset ring-bg-page-selection hover:bg-bg-page-selection-fill"
                : isPicking
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
