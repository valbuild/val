import {
  Maximize2,
  Minus,
  Monitor,
  Plus,
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
 * Whether clicking picks elements is not here — that follows from which view
 * the canvas is in, and putting it in two places would let them disagree.
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
  className,
}: {
  device: CanvasDevice;
  onDeviceChange: (device: CanvasDevice) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
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
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border-float" />;
}
