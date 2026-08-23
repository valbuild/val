import { ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { ShellBreakpoint } from "./types";

export type FloatingPanelProps = {
  /** Which edge the panel floats against on desktop/tablet. */
  side: "left" | "right";
  /** Panel width on desktop/tablet, in px. Ignored on mobile. */
  width: number;
  title: string;
  /**
   * On mobile, `sheet` fills the height from the left edge (navigation),
   * `bottom-sheet` rises from the bottom (utilities, AI, notifications).
   */
  mobileVariant: "sheet" | "bottom-sheet";
  breakpoint: ShellBreakpoint;
  onClose: () => void;
  /** Rendered to the right of the title, e.g. a "New" button. */
  headerAction?: ReactNode;
  /**
   * Rendered directly below the header, above `sticky`. Used on mobile to
   * carry the destination switcher, since there is no left rail there.
   */
  subheader?: ReactNode;
  /** Pinned below the header, outside the scroll area, e.g. a search field. */
  sticky?: ReactNode;
  /** Pinned to the bottom, outside the scroll area, e.g. a chat input. */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * A floating overlay surface.
 *
 * Panels overlay the editor: they are absolutely positioned inside the shell
 * and never take part in its layout, so opening one cannot resize or shift
 * the content canvas. Closing works from the header button, a click on the
 * scrim, or Escape.
 */
export function FloatingPanel({
  side,
  width,
  title,
  mobileVariant,
  breakpoint,
  onClose,
  headerAction,
  subheader,
  sticky,
  footer,
  children,
}: FloatingPanelProps) {
  const isMobile = breakpoint === "mobile";
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <>
      {/* Scrim: dark and dismissive on mobile where the sheet dominates the
          screen, invisible but still click-to-close on larger screens where
          the editor stays visible behind the panel. */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "absolute inset-0 z-window",
          isMobile ? "bg-black/40" : "bg-transparent",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        style={isMobile ? undefined : { width }}
        className={cn(
          "absolute z-full flex flex-col",
          "bg-bg-float border border-border-float shadow-xl",
          isMobile
            ? mobileVariant === "sheet"
              ? "inset-y-0 left-0 w-[min(20rem,88vw)] border-l-0 rounded-r-lg"
              : "inset-x-0 bottom-0 max-h-[85svh] rounded-t-xl border-b-0"
            : cn(
                // Inset to clear the floating bars: below the top bar, above
                // the status bar, and — for left panels on desktop — to the
                // right of the rail, which has to stay reachable while a
                // panel is open.
                "top-16 bottom-14 rounded-lg",
                side === "right"
                  ? "right-3"
                  : breakpoint === "desktop"
                    ? "left-[4.75rem]"
                    : "left-3",
              ),
        )}
      >
        <div className="flex items-center gap-2 shrink-0 h-11 pl-4 pr-2 border-b border-border-float">
          <span className="text-sm font-medium truncate">{title}</span>
          <div className="ml-auto flex items-center gap-1">
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="grid place-items-center w-7 h-7 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        {subheader !== undefined && (
          <div className="shrink-0 px-2 py-2 border-b border-border-float">
            {subheader}
          </div>
        )}
        {sticky !== undefined && (
          <div className="shrink-0 px-3 py-2 border-b border-border-float">
            {sticky}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer !== undefined && (
          <div className="shrink-0 border-t border-border-float">{footer}</div>
        )}
      </div>
    </>
  );
}

/** A small uppercase divider label used inside panels. */
export function PanelSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-4 pt-4 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-secondary-alt",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Empty-state copy inside a panel. */
export function PanelEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-6 text-xs text-fg-secondary-alt">{children}</div>
  );
}
