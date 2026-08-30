import { ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { ShellBreakpoint } from "./types";
import { useLockBodyScroll, useVisualViewport } from "./useVisualViewport";

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
  /**
   * Render, but out of sight — no scrim, no Escape, no scroll lock.
   *
   * For a panel whose CONTENTS have to outlive being dismissed. The assistant
   * is the one: it holds a conversation, a composer draft and, while a turn is
   * running, the only thing that can answer the model's tool calls. Unmounting
   * it on close meant a click anywhere in the editor — the scrim covers the
   * whole viewport — killed a turn in flight with no error anywhere.
   *
   * Not the default, because for every other panel unmounting is the point:
   * they hold a filter and a scroll position, and reopening one should start
   * from the top rather than from where you left it a page ago.
   */
  hidden?: boolean;
  /**
   * Give a `bottom-sheet` a definite height instead of letting content decide.
   *
   * A bottom sheet is sized by `maxHeight` alone, which is right for a short
   * list — quick actions, notifications — that should be as tall as it needs
   * and no taller. It is wrong for a panel whose child is a `h-full` column,
   * because a percentage height resting on an `auto` height collapses: the
   * assistant is a transcript above a pinned composer, and it rendered about
   * one message tall and then resized on every token that streamed in.
   *
   * With `fill`, the sheet takes the height outright and the column inside it
   * has something to be 100% OF. It also drops this panel's own scroller —
   * such a child brings its own, and two nested scrollers is what let the
   * composer scroll up out of sight.
   */
  fill?: boolean;
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
  hidden = false,
  fill = false,
  children,
}: FloatingPanelProps) {
  const isMobile = breakpoint === "mobile" && !hidden;
  const panelRef = useRef<HTMLDivElement>(null);
  // A mobile sheet is measured against the part of the screen the user can
  // actually see. With the keyboard up that is not the layout viewport, and
  // a panel with a text field in its footer — the assistant's input, a
  // filter — would otherwise put it underneath the keyboard. See
  // `useVisualViewport`.
  const viewport = useVisualViewport(isMobile);
  useLockBodyScroll(isMobile);
  useEffect(() => {
    if (hidden) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, hidden]);
  return (
    <>
      {/* Scrim: dark and dismissive on mobile where the sheet dominates the
          screen, invisible but still click-to-close on larger screens where
          the editor stays visible behind the panel. */}
      {!hidden && (
        <div
          onClick={onClose}
          aria-hidden
          className={cn(
            "absolute inset-0 z-window",
            isMobile ? "bg-black/40" : "bg-transparent",
          )}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        style={
          isMobile
            ? mobileVariant === "sheet"
              ? // Full height of the visible area, not of the layout viewport.
                { top: viewport.offsetTop, height: viewport.height }
              : // Sitting on top of the keyboard rather than behind it, and
                // never taller than what is left above it.
                {
                  bottom: viewport.keyboardInset,
                  // `height` rather than `maxHeight` when the sheet has to be
                  // a container for a full-height child. See `fill`.
                  ...(fill
                    ? { height: viewport.height * 0.85 }
                    : { maxHeight: viewport.height * 0.85 }),
                }
            : { width }
        }
        className={cn(
          "absolute z-full flex flex-col",
          "bg-bg-float border border-border-float shadow-lg",
          // `display: none`, so the subtree keeps its state and its effects but
          // takes no space, catches no clicks and leaves the accessibility tree.
          hidden && "hidden",
          isMobile
            ? mobileVariant === "sheet"
              ? "fixed left-0 w-[min(20rem,88vw)] border-l-0 rounded-r-lg"
              : "fixed inset-x-0 rounded-t-xl border-b-0"
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
          <span className="text-[0.8125rem] font-semibold tracking-tight truncate">
            {title}
          </span>
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
        <div
          className={cn(
            "flex-1 min-h-0",
            // A filled sheet's child scrolls itself; a second scroller here
            // would move that child's pinned footer off screen.
            fill
              ? "overflow-hidden"
              : "overflow-y-auto overscroll-contain scrollbar-slim",
          )}
        >
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
  /** Hairline above the label, to separate it from the section before it. */
  divided,
}: {
  children: ReactNode;
  className?: string;
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 pt-4 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-secondary-alt",
        divided && "mt-3 border-t border-border-float",
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
