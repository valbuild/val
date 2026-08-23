import { Eye, Info } from "lucide-react";
import { cn } from "../designSystem/cn";
import { PublishButton } from "./TopBar";
import { RAIL_ITEMS } from "./LeftRail";
import { ShellPanel } from "./types";

/**
 * The destination switcher shown at the top of every navigation sheet on
 * mobile, standing in for the left rail.
 */
export function MobileNavSwitcher({
  openPanel,
  onSelect,
}: {
  openPanel: ShellPanel | null;
  onSelect: (panel: ShellPanel) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Destinations"
      className="flex gap-0.5 p-0.5 rounded-md bg-bg-float-raised"
    >
      {RAIL_ITEMS.map(({ panel, label, icon: Icon }) => (
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
  onOpenStatus,
}: {
  pendingChanges: number;
  onPreview: () => void;
  onPublish: () => void;
  onOpenStatus: () => void;
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
      <button
        type="button"
        onClick={onPreview}
        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-xs font-medium text-fg-secondary border border-border-float"
      >
        <Eye size={14} />
        Preview
      </button>
      <PublishButton
        pendingChanges={pendingChanges}
        onPublish={onPublish}
        className="flex-1 h-9"
      />
    </div>
  );
}
