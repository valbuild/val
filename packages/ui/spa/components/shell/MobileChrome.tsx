import { Info, PanelRight } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { PreviewButton, PublishButton } from "./TopBar";
import { visibleRailItems } from "./LeftRail";
import { ShellDestination, ShellPanel } from "./types";
import { LocaleFilter } from "./LocaleFilter";

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
  previewHref,
  onPublish,
  publishSlot,
  onOpenStatus,
  locales,
  locale = null,
  onLocaleChange,
  onOpenQuickActions,
  onToggleCanvas,
  isCanvasOpen,
  canvasActionLabel,
  onExitCanvas,
}: {
  pendingChanges: number;
  onPreview: () => void;
  /** The preview URL, so "Open in a new tab" is a link. See `PreviewButton`. */
  previewHref?: string;
  onPublish: () => void;
  /** The real publish control, when there is one. See `TopBarProps`. */
  publishSlot?: ReactNode;
  onOpenStatus: () => void;
  /** The project's languages, for the locale filter. Empty hides it. */
  locales?: string[];
  /** The language being shown, or `null` for all of them. */
  locale?: string | null;
  onLocaleChange?: (locale: string | null) => void;
  /**
   * Quick actions — the same panel the top bar opens above the mobile
   * breakpoint. It holds the validation errors, Review changes, New page and
   * Upload media, none of which were reachable on a phone at all.
   */
  onOpenQuickActions?: () => void;
  /** Absent when the selection has no route Val can put on a canvas. */
  onToggleCanvas?: () => void;
  isCanvasOpen?: boolean;
  /** What the canvas half does next. See `PreviewButton`. */
  canvasActionLabel?: string;
  /** Leaving the canvas, where that is a separate act. See `PreviewButton`. */
  onExitCanvas?: () => void;
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
      {onOpenQuickActions && (
        <button
          type="button"
          onClick={onOpenQuickActions}
          aria-label="Quick actions"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-float text-fg-secondary"
        >
          <PanelRight size={16} />
        </button>
      )}
      {/*
       * The phone's home for the locale filter, since the top bar here is the
       * project name and a menu button. `above`, or the menu opens off the
       * bottom of the screen.
       */}
      {locales !== undefined && onLocaleChange !== undefined && (
        <LocaleFilter
          locales={locales}
          value={locale}
          onChange={onLocaleChange}
          menuPlacement="above"
          className="h-9 shrink-0"
        />
      )}
      {/*
       * The same control as on desktop, not a second design of it.
       *
       * A phone had a canvas icon and a Preview button side by side, which made
       * "show me the page" a choice about chrome rather than about the page —
       * the exact thing the split button was built to stop. It also meant the
       * two behaviours drifted: the desktop menu explains what each one does and
       * the phone's pair of icons explained nothing.
       */}
      <PreviewButton
        onPreview={onPreview}
        previewHref={previewHref}
        onToggleCanvas={onToggleCanvas}
        isCanvasOpen={isCanvasOpen}
        canvasActionLabel={canvasActionLabel}
        onExitCanvas={onExitCanvas}
        menuPlacement="above"
        alwaysShowLabel
        className="h-9 flex-1"
      />
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
