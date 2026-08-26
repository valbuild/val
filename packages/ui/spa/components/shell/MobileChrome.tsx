import { Columns2, Eye, Info } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { PublishButton } from "./TopBar";
import { visibleRailItems } from "./LeftRail";
import { ShellDestination, ShellPanel } from "./types";

/**
 * The destination switcher shown at the top of every navigation sheet on
 * mobile, standing in for the left rail.
 */
export function MobileNavSwitcher({
  openPanel,
  onSelect,
  destinations,
}: {
  openPanel: ShellPanel | null;
  onSelect: (panel: ShellPanel) => void;
  /** The destinations this project has content for. See `LeftRailProps`. */
  destinations?: readonly ShellDestination[];
}) {
  const items = visibleRailItems(destinations);
  if (items.length < 2) {
    // One destination is not a choice, and a tab strip with a single tab in it
    // just takes a row off the top of every sheet.
    return null;
  }
  return (
    <div
      role="tablist"
      aria-label="Destinations"
      className="flex gap-0.5 p-0.5 rounded-md bg-bg-float-raised"
    >
      {items.map(({ panel, label, icon: Icon }) => (
        <button
          key={panel}
          type="button"
          role="tab"
          aria-selected={openPanel === panel}
          onClick={() => onSelect(panel)}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 h-7 rounded text-[0.6875rem]",
            openPanel === panel
              ? "bg-bg-float text-fg-primary shadow-sm font-medium"
              : "text-fg-secondary",
          )}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The sticky mobile bottom bar. Preview and Publish are always reachable
 * here; auto save, dev mode and branch move behind the status button rather
 * than taking a permanent row.
 */
export function MobileBottomBar({
  pendingChanges,
  onPreview,
  onPublish,
  publishSlot,
  onOpenStatus,
  onToggleCanvas,
  isCanvasOpen,
}: {
  pendingChanges: number;
  onPreview: () => void;
  onPublish: () => void;
  /** The real publish control, when there is one. See `TopBarProps`. */
  publishSlot?: ReactNode;
  onOpenStatus: () => void;
  /** Absent when the selection has no route Val can put on a canvas. */
  onToggleCanvas?: () => void;
  isCanvasOpen?: boolean;
}) {
  return (
    <div className="absolute z-full bottom-0 inset-x-0 flex items-center gap-2 px-3 py-2.5 bg-bg-float border-t border-border-float">
      <button
        type="button"
        onClick={onOpenStatus}
        aria-label="Status and settings"
        className="grid place-items-center w-9 h-9 shrink-0 rounded-md text-fg-secondary border border-border-float"
      >
        <Info size={16} />
      </button>
      {onToggleCanvas && (
        <button
          type="button"
          onClick={onToggleCanvas}
          aria-label="Canvas"
          aria-pressed={isCanvasOpen}
          className={cn(
            "grid place-items-center w-9 h-9 shrink-0 rounded-md border border-border-float",
            isCanvasOpen
              ? "bg-bg-float-raised text-fg-primary"
              : "text-fg-secondary",
          )}
        >
          <Columns2 size={16} />
        </button>
      )}
      <button
        type="button"
        onClick={onPreview}
        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-xs font-medium text-fg-secondary border border-border-float"
      >
        <Eye size={14} />
        Preview
      </button>
      {publishSlot ?? (
        <PublishButton
          pendingChanges={pendingChanges}
          onPublish={onPublish}
          className="flex-1 h-9"
        />
      )}
    </div>
  );
}
