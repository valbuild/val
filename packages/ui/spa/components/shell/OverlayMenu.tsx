import { forwardRef, ReactNode, useEffect, useRef, useState } from "react";
import { GripHorizontal, X } from "lucide-react";
import { useLockBodyScroll, useVisualViewport } from "./useVisualViewport";
import { cn } from "../designSystem/cn";

/**
 * Chrome for the floating menu that sits over the user's own site.
 *
 * This bar is the most invasive surface Val has: it is drawn on top of
 * somebody else's design, in a corner they did not choose, while they are
 * looking at their own brand. So it is deliberately quiet — near-neutral
 * greys, one hairline, one shadow, and colour only where an action commits
 * something. Anything more competes with the page it is floating over.
 *
 * Presentational only: the overlay owns the state, the hover cards and the
 * popovers, and composes these pieces.
 */

export type OverlayMenuOrientation = "horizontal" | "vertical";

/** The eight positions the menu can be docked to. */
export type OverlayDock =
  | "left-top"
  | "left-center"
  | "left-bottom"
  | "center-top"
  | "center-bottom"
  | "right-top"
  | "right-center"
  | "right-bottom";

export function dockOrientation(dock: OverlayDock): OverlayMenuOrientation {
  return dock === "left-center" || dock === "right-center"
    ? "vertical"
    : "horizontal";
}

export type OverlayMenuBarProps = {
  orientation: OverlayMenuOrientation;
  /** Drag preview: the same bar at reduced opacity. */
  ghost?: boolean;
  /** Denser padding and smaller gaps, for phone-width viewports. */
  compact?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * The bar itself. Sized by its buttons rather than a fixed height so a
 * vertical dock and a horizontal dock share one implementation.
 */
export function OverlayMenuBar({
  orientation,
  ghost,
  compact,
  children,
  className,
}: OverlayMenuBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Val"
      aria-orientation={orientation}
      className={cn(
        "flex relative items-center rounded-lg",
        "bg-bg-float border border-border-float text-fg-primary shadow-lg",
        orientation === "vertical" ? "flex-col" : "flex-row",
        compact
          ? orientation === "vertical"
            ? "flex-col gap-0.5 px-1 py-1.5"
            : "flex-row gap-0.5 px-1.5 py-1"
          : orientation === "vertical"
            ? "flex-col gap-1 px-1.5 py-2"
            : "flex-row gap-1 px-2 py-1.5",
        ghost && "opacity-70",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type OverlayMenuButtonProps = {
  /** Accessible name. Also the `title`, since the bar is icons only. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** Renders an anchor instead of a button. */
  href?: string;
  compact?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

/**
 * One icon button.
 *
 * Active state is a raised neutral surface, not a brand fill: several of
 * these can be active at once, and a row of green buttons over someone's
 * homepage is exactly the noise this design is trying to avoid.
 */
export const OverlayMenuButton = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  OverlayMenuButtonProps
>(function OverlayMenuButton(
  {
    label,
    icon,
    active,
    disabled,
    href,
    compact,
    onClick,
    onMouseEnter,
    onMouseLeave,
    ...rest
  },
  ref,
) {
  const className = cn(
    "inline-flex items-center justify-center shrink-0 rounded-md transition-colors",
    compact ? "w-7 h-7" : "w-8 h-8",
    active
      ? "bg-bg-float-raised text-fg-primary"
      : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
    disabled && "text-fg-disabled pointer-events-none",
  );
  if (href) {
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={className}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-label={label}
        title={label}
        {...rest}
      >
        {icon}
      </a>
    );
  }
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      disabled={disabled}
      aria-pressed={active}
      className={className}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon}
    </button>
  );
});

/** Separates the bar's groups: a hairline across the short axis. */
export function OverlayMenuDivider({
  orientation,
}: {
  orientation: OverlayMenuOrientation;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 bg-border-float",
        orientation === "vertical" ? "h-px w-5 my-0.5" : "w-px h-5 mx-0.5",
      )}
    />
  );
}

/**
 * A count on a menu button — pending changes, or validation errors.
 *
 * Errors are red because they block publishing; a plain count inverts to the
 * foreground colour so it carries on both themes without introducing a hue.
 */
export function OverlayMenuBadge({
  count,
  tone = "neutral",
}: {
  count: number;
  tone?: "neutral" | "error";
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 grid place-items-center rounded-full",
        "text-[0.625rem] font-semibold tabular-nums",
        tone === "error"
          ? "bg-bg-error-primary text-fg-error-primary"
          : "bg-fg-primary text-bg-float",
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** The docked position, as fixed-position classes. */
export function overlayDockClassName(dock: OverlayDock): string {
  switch (dock) {
    case "left-top":
      return "fixed left-3 top-3";
    case "left-center":
      return "fixed left-3 top-1/2 -translate-y-1/2";
    case "left-bottom":
      return "fixed left-3 bottom-3";
    case "center-top":
      return "fixed left-1/2 -translate-x-1/2 top-3";
    case "center-bottom":
      return "fixed left-1/2 -translate-x-1/2 bottom-3";
    case "right-top":
      return "fixed right-3 top-3";
    case "right-center":
      return "fixed right-3 top-1/2 -translate-y-1/2";
    case "right-bottom":
      return "fixed right-3 bottom-3";
  }
}

/**
 * A floating window over the user's page — the edit window, the assistant.
 *
 * Same surface as the bar, one size up: hairline, shadow, rounded corners,
 * and a title bar that is a drag handle on desktop.
 */
export function OverlayWindow({
  title,
  compact,
  onClose,
  footer,
  children,
  className,
  style,
  fullScreen,
}: {
  title: string;
  compact?: boolean;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Fill the phone screen, tracking the visual viewport so the footer stays
   * above the software keyboard instead of under it. See
   * `useVisualViewport`.
   */
  fullScreen?: boolean;
}) {
  const viewport = useVisualViewport(fullScreen === true);
  useLockBodyScroll(fullScreen === true);
  // Pinned to the visual viewport rather than the layout viewport: with the
  // keyboard up those are different rectangles, and only the first one is
  // the part of the screen the user can see.
  const fullScreenStyle: React.CSSProperties | undefined = fullScreen
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        top: viewport.offsetTop,
        height: viewport.height,
      }
    : undefined;
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{ ...fullScreenStyle, ...style }}
      className={cn(
        "flex flex-col bg-bg-float text-fg-primary",
        fullScreen
          ? "rounded-none border-0 z-full"
          : "rounded-lg border border-border-float shadow-xl",
        className,
      )}
    >
      <div className="grid grid-cols-3 items-center shrink-0 px-3 h-11 border-b border-border-float">
        <div className="text-[0.8125rem] font-semibold tracking-tight truncate">
          {title}
        </div>
        <div className="flex justify-center text-fg-secondary-alt">
          {!compact && !fullScreen && <GripHorizontal size={16} />}
        </div>
        <div className="flex justify-end">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="grid place-items-center w-7 h-7 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-slim">
        {children}
      </div>
      {footer !== undefined && (
        <div className="shrink-0 border-t border-border-float">{footer}</div>
      )}
    </div>
  );
}

/** A small floating card anchored to a menu button — the settings popover. */
export function OverlayCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg bg-bg-float text-fg-primary border border-border-float shadow-lg p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The outline drawn around an editable region of the user's page.
 *
 * Deliberately not themed: this sits on their design, not on ours, so it uses
 * the fixed page-selection green that reads on a light and a dark page alike.
 */
export function OverlaySelectionBox({
  rect,
  emphasis = "all",
  className,
}: {
  /** Any CSS length: the real overlay measures pixels, stories use percentages. */
  rect: {
    top: number | string;
    left: number | string;
    width: number | string;
    height: number | string;
  };
  /** `all` marks every editable region; `hover` is the one a click would open. */
  emphasis?: "all" | "hover";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      style={rect}
      className={cn(
        "absolute rounded-sm border-2 border-bg-page-selection pointer-events-none",
        emphasis === "hover" ? "bg-bg-page-selection-fill" : "opacity-70",
        className,
      )}
    />
  );
}

/** The hover hint on a menu button. */
export function OverlayTooltip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tooltip"
      className={cn(
        "max-w-[16rem] px-2.5 py-1.5 rounded-md text-xs",
        "bg-bg-float text-fg-primary border border-border-float shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type OverlayMenuLauncherProps = {
  orientation: OverlayMenuOrientation;
  /** Which edge it grows from, so it expands into the page, not off it. */
  dock: OverlayDock;
  compact?: boolean;
  /** Drag preview: reduced opacity, and always expanded so you see what
      you are dragging. */
  ghost?: boolean;
  /** Shown on the collapsed circle: unpublished changes, or errors. */
  status?: "none" | "changes" | "errors";
  /** The Val mark, or whatever identifies the collapsed control. */
  mark: ReactNode;
  /** The bar's buttons. Only reachable once expanded. */
  children: ReactNode;
  /** Controlled expansion. Omit to let the launcher manage its own. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Starting state when uncontrolled. Hover and tap still work from there. */
  defaultExpanded?: boolean;
};

/**
 * The overlay menu at rest: a circle, expanding to the full pill.
 *
 * At rest this is the smallest mark Val can leave on someone else's page.
 *
 * Hover gives a peek and a click pins it: hovering expands the pill, moving
 * away collapses it again, but once it has been clicked or tapped it stays
 * open until it is dismissed. Hover alone cannot pin it, or crossing the
 * corner of the page on the way to something else would leave a bar open
 * over the user's site indefinitely — and hover does not exist on touch,
 * which is why the click is what makes it stick.
 *
 * It grows from the edge it is docked to, so it opens into the page rather
 * than off the side of it. Dismissal is the circle itself, a tap outside, or
 * Escape.
 *
 * Collapsed it still has one thing to say — whether there is unpublished work
 * or a validation error — so that shows as a dot on the circle rather than
 * making people expand it to find out.
 */
export function OverlayMenuLauncher({
  orientation,
  dock,
  compact,
  ghost,
  status = "none",
  mark,
  children,
  expanded: controlledExpanded,
  onExpandedChange,
  defaultExpanded = false,
}: OverlayMenuLauncherProps) {
  // Two reasons to be open, and they expire differently: a hover lasts as
  // long as the pointer is over the menu, a click lasts until dismissed.
  const [pinned, setPinned] = useState(defaultExpanded);
  const [hovered, setHovered] = useState(false);
  const uncontrolled = pinned || hovered;
  const expanded = ghost === true || (controlledExpanded ?? uncontrolled);
  // Controlled only when a callback comes with the value: a controlled prop
  // with no setter is a menu that cannot be opened, which is worse than either.
  const isControlled = controlledExpanded !== undefined && !!onExpandedChange;
  const setExpanded = (next: boolean) => {
    if (isControlled) {
      onExpandedChange?.(next);
      return;
    }
    setPinned(next);
    if (!next) setHovered(false);
  };
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    // `pointerdown` rather than `click` so a tap outside closes the menu
    // before the tap reaches the user's page and activates something there.
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, setExpanded]);

  const growsFromEnd =
    dock === "right-top" || dock === "right-center" || dock === "right-bottom";
  const isVertical = orientation === "vertical";

  return (
    <div
      ref={rootRef}
      // Hover is an enhancement, not the mechanism: touch has none, so the
      // circle is a real button that pins.
      onMouseEnter={() => (isControlled ? setExpanded(true) : setHovered(true))}
      onMouseLeave={() =>
        isControlled ? setExpanded(false) : setHovered(false)
      }
      className={cn("inline-flex", isVertical ? "flex-col" : "flex-row")}
    >
      <OverlayMenuBar
        orientation={orientation}
        compact={compact}
        ghost={ghost}
        className={cn(
          "transition-[border-radius,padding] duration-200",
          // The bar's padding differs per orientation, which makes a
          // collapsed vertical menu an oval rather than a circle. Uniform
          // padding while collapsed keeps it round in both.
          !expanded && ["rounded-full", "p-1.5"],
        )}
      >
        {/* Order flips so the circle stays against the edge it is docked to
            and the pill unrolls inwards. */}
        <div
          className={cn(
            "flex items-center",
            isVertical ? "flex-col" : "flex-row",
            growsFromEnd
              ? isVertical
                ? "flex-col-reverse"
                : "flex-row-reverse"
              : undefined,
          )}
        >
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Close Val menu" : "Open Val menu"}
            onClick={() => setExpanded(isControlled ? !expanded : !pinned)}
            className={cn(
              "relative grid place-items-center shrink-0 rounded-full transition-colors",
              // Collapsed, this is the only thing to tap, so it keeps the full
              // size on a phone too — the compact sizing is for a bar of eight
              // buttons, not for a lone 44px target.
              compact && expanded ? "w-7 h-7" : "w-8 h-8",
              "text-fg-primary hover:bg-bg-float-raised",
            )}
          >
            {mark}
            {status !== "none" && !expanded && (
              <span
                aria-hidden
                className={cn(
                  // Top right, clear of the mark's own dot at its foot — two
                  // dots on one 46px circle need to be told apart. Grey for
                  // pending work, like every other draft marker; green is
                  // reserved for controls that commit something, and the mark
                  // already spends it.
                  "absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full ring-2 ring-bg-float",
                  status === "errors"
                    ? "bg-bg-error-primary"
                    : "bg-fg-secondary",
                )}
              />
            )}
          </button>
          {/* Animating the max size rather than the size itself: a width
              transition cannot animate to `auto`, and the 0fr→1fr grid trick
              needs `min-width: 0` on the content, which lets the bar size
              itself smaller than the buttons it contains — they then spill
              out of its background. A max-width cap keeps the content at its
              natural size and only clips it, so the bar always fits.

              The padding with a matching negative margin widens the clip box
              across the short axis, so a button's badge is not cut off, while
              leaving the layout where it was. */}
          <div
            className={cn(
              "overflow-hidden",
              "transition-[max-width,max-height,opacity,visibility] duration-200 ease-out",
              // Both axes collapse, or a vertical menu keeps the width of its
              // widest button and the circle comes out an oval. The padding
              // that keeps a badge from being clipped is only applied while
              // expanded, since a negative margin would otherwise eat into
              // the collapsed circle.
              expanded
                ? isVertical
                  ? "max-h-[32rem] max-w-[32rem] px-2 -mx-2"
                  : "max-w-[32rem] max-h-[32rem] py-2 -my-2"
                : "max-w-0 max-h-0",
              expanded ? "opacity-100" : "opacity-0",
              // Not just hidden: `visibility` also takes the buttons out of
              // the tab order and the accessibility tree while collapsed, and
              // it flips only at the end of the collapse, so they still fade.
              expanded ? "visible" : "invisible",
            )}
          >
            <div
              className={cn(
                "flex items-center",
                isVertical ? "flex-col" : "flex-row",
                compact ? "gap-0.5" : "gap-1",
                // Keeps the circle from touching the first button.
                isVertical ? "pt-1" : "pl-1",
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </OverlayMenuBar>
    </div>
  );
}
