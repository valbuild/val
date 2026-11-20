import { EyeOff } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Switch } from "../designSystem/switch";
import { AnimatedClock } from "../AnimatedClock";
import {
  OverlayDock,
  OverlayPlacement,
  isDockPlacement,
  placementOfDock,
} from "./overlayPlacement";

const DOCK_LABELS: Record<OverlayDock, string> = {
  "left-top": "Top left",
  "center-top": "Top centre",
  "right-top": "Top right",
  "left-center": "Middle left",
  "right-center": "Middle right",
  "left-bottom": "Bottom left",
  "center-bottom": "Bottom centre",
  "right-bottom": "Bottom right",
};

/**
 * Pick one of the eight presets from a picture of the screen, for anyone who
 * would rather choose than drag. Dragging is not limited to these: a menu
 * dropped anywhere else simply has none of them selected.
 */
export function PlacementPicker({
  placement,
  onPlacementChange,
}: {
  placement: OverlayPlacement;
  onPlacementChange: (placement: OverlayPlacement) => void;
}) {
  const cells: Array<OverlayDock | null> = [
    "left-top",
    "center-top",
    "right-top",
    "left-center",
    null,
    "right-center",
    "left-bottom",
    "center-bottom",
    "right-bottom",
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Menu position"
      className="grid grid-cols-3 gap-1 p-1 w-[4.5rem] h-12 rounded-md border border-border-primary bg-bg-secondary"
    >
      {cells.map((dock, index) =>
        dock === null ? (
          <span key={index} aria-hidden />
        ) : (
          <button
            key={dock}
            type="button"
            role="radio"
            aria-checked={isDockPlacement(placement, dock)}
            aria-label={DOCK_LABELS[dock]}
            title={DOCK_LABELS[dock]}
            onClick={() => onPlacementChange(placementOfDock(dock))}
            className={cn(
              "rounded-sm transition-colors",
              isDockPlacement(placement, dock)
                ? "bg-fg-primary"
                : "bg-border-primary hover:bg-fg-secondary",
            )}
          />
        ),
      )}
    </div>
  );
}

const rowClassName =
  "flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-sm text-left text-fg-primary hover:bg-bg-secondary-hover disabled:text-fg-disabled disabled:pointer-events-none";

/**
 * What the menu's "⋯" opens: where the menu sits, light or dark, and leaving
 * preview mode. Turning Val off is the bar's own X, not in here.
 *
 * Presentational, so the overlay and its stories render the same panel: the
 * overlay puts it in a popover and wires it to the theme and preview mode.
 */
export function OverlaySettingsPanel({
  placement,
  onPlacementChange,
  dark,
  onDarkChange,
  inPreview,
  exitingPreview = false,
  onExitPreview,
}: {
  placement: OverlayPlacement;
  onPlacementChange: (placement: OverlayPlacement) => void;
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  /** Offers "Exit preview mode" only while in it. */
  inPreview: boolean;
  /** Preview mode is being switched: the row waits rather than repeats. */
  exitingPreview?: boolean;
  onExitPreview: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-2 py-1.5">
        <span className="text-sm">Position</span>
        <PlacementPicker
          placement={placement}
          onPlacementChange={onPlacementChange}
        />
      </div>
      <label className="flex items-center justify-between gap-3 px-2 h-9 text-sm">
        <span>Dark mode</span>
        <Switch checked={dark} onCheckedChange={onDarkChange} />
      </label>
      {inPreview && (
        <>
          <div className="my-1 h-px bg-border-primary" />
          <button
            type="button"
            className={rowClassName}
            disabled={exitingPreview}
            onClick={onExitPreview}
          >
            {exitingPreview ? (
              <AnimatedClock size={16} />
            ) : (
              <EyeOff size={16} className="shrink-0" />
            )}
            <span className="flex flex-col leading-tight gap-0.5">
              <span>Exit preview mode</span>
              <span className="text-xs text-fg-tertiary">
                See the published site
              </span>
            </span>
          </button>
        </>
      )}
    </div>
  );
}
