import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { GripHorizontal, X } from "lucide-react";
import { useLockBodyScroll, useVisualViewport } from "./useVisualViewport";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "./useDismissOnOutsidePointer";
import {
  OverlayMenuOrientation,
  OverlayPlacement,
  placementGrowth,
  placementOrientation,
} from "./overlayPlacement";

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

export type { OverlayDock, OverlayMenuOrientation } from "./overlayPlacement";

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
        // A pill in both orientations and in both states, so expanding it
        // only ever changes its length: no radius or padding to animate.
        "flex relative items-center rounded-full p-1",
        "bg-bg-float border border-border-float text-fg-primary shadow-lg",
        orientation === "vertical" ? "flex-col" : "flex-row",
        compact ? "gap-0.5" : "gap-1",
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
  /** Where it is docked: decides its orientation and which way it grows. */
  placement: OverlayPlacement;
  compact?: boolean;
  /** Reduced opacity, and always expanded so you see the whole bar. */
  ghost?: boolean;
  /**
   * Being dragged: collapsed, whatever hover or a click had said, and deaf
   * to hover until it is let go. A bar that reshapes under the pointer while
   * it is carried is the wonkiest thing it could do.
   */
  dragging?: boolean;
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
  /**
   * Stay expanded whatever the pointer does, for as long as this is true.
   *
   * For something opened FROM the bar that is not inside it: a popover is
   * portalled out of the menu, so moving onto it is a mouse-leave and pressing
   * in it is an outside press, and either collapsed the bar — taking the
   * button the popover is anchored to with it, so the popover slid away under
   * the pointer. While held, neither collapses it and neither does Escape,
   * which belongs to the thing holding it. Hover keeps being tracked, so when
   * the hold ends the bar is exactly as open as the pointer says it should be.
   */
  holdOpen?: boolean;
};

/*
 * One curve for the whole menu: fast out of the gate, long settle. The
 * length animates with it; the buttons fade in a beat behind the length, so
 * they appear into room that is already there instead of being uncovered
 * edge first, and fade out ahead of it on the way back.
 */
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const EXPAND_MS = 260;
const COLLAPSE_MS = 200;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

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
 * It grows away from the nearer end of the edge it is docked to (or both
 * ways, from the middle of one), so it opens into the page rather than off
 * it. Dismissal is the circle itself, a tap outside, or Escape.
 *
 * Collapsed it still has one thing to say — whether there is unpublished work
 * or a validation error — so that shows as a dot on the circle rather than
 * making people expand it to find out.
 *
 * The length is animated to a MEASURED size, not to a `max-width` cap. A cap
 * has to be larger than any bar could be, so a collapse spent most of its
 * time shrinking the cap through sizes the bar never had, and the bar sat
 * still and then snapped shut; and the two axes reached their ends at
 * different moments. That was most of what made the menu feel wonky.
 */
export function OverlayMenuLauncher({
  placement,
  compact,
  ghost,
  dragging = false,
  status = "none",
  mark,
  children,
  expanded: controlledExpanded,
  onExpandedChange,
  defaultExpanded = false,
  holdOpen = false,
}: OverlayMenuLauncherProps) {
  // Two reasons to be open, and they expire differently: a hover lasts as
  // long as the pointer is over the menu, a click lasts until dismissed.
  const [pinned, setPinned] = useState(defaultExpanded);
  const [hovered, setHovered] = useState(false);
  const uncontrolled = pinned || hovered;
  const expanded =
    ghost === true ||
    (!dragging && (holdOpen || (controlledExpanded ?? uncontrolled)));
  // Controlled only when a callback comes with the value: a controlled prop
  // with no setter is a menu that cannot be opened, which is worse than either.
  const isControlled = controlledExpanded !== undefined && !!onExpandedChange;
  const setExpanded = useCallback(
    (next: boolean) => {
      if (isControlled) {
        onExpandedChange?.(next);
        return;
      }
      setPinned(next);
      if (!next) setHovered(false);
    },
    [isControlled, onExpandedChange],
  );
  // A drag forgets why it was open: it is let go of somewhere else, and
  // should arrive there as the circle it was carried as.
  useEffect(() => {
    if (!dragging) return;
    setPinned(false);
    setHovered(false);
    if (isControlled) onExpandedChange?.(false);
    // Only on the start of a drag: the setters are not reasons to rerun it.
  }, [dragging]);
  const rootRef = useRef<HTMLDivElement>(null);

  const collapse = useCallback(() => setExpanded(false), [setExpanded]);
  useDismissOnOutsidePointer(rootRef, expanded && !holdOpen, collapse);
  useEffect(() => {
    if (!expanded || holdOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, holdOpen, setExpanded]);

  const orientation = placementOrientation(placement);
  const isVertical = orientation === "vertical";
  const growsBackward = placementGrowth(placement) === "backward";

  // The natural size of the buttons, which is what the clip animates to.
  // Both axes: the bar's buttons are not all as wide as the circle (Publish
  // carries a count), so a clip that collapsed only its length left a
  // vertical bar as an oval when closed.
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () =>
      setContentSize((prev) =>
        prev?.width === el.offsetWidth && prev?.height === el.offsetHeight
          ? prev
          : { width: el.offsetWidth, height: el.offsetHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isVertical]);

  const reducedMotion = usePrefersReducedMotion();
  const ms = expanded ? EXPAND_MS : COLLAPSE_MS;
  const sizeTransition = `width ${ms}ms ${EASE}, height ${ms}ms ${EASE}`;
  // The clip is padded across the short axis (see below), and its box is
  // border-box, so that padding has to be added back or the widest button
  // is cut off at the clip's edge.
  const BADGE_ROOM = 16;
  const clipStyle: React.CSSProperties = {
    width: expanded
      ? contentSize
        ? contentSize.width + (isVertical ? BADGE_ROOM : 0)
        : "auto"
      : 0,
    height: expanded
      ? contentSize
        ? contentSize.height + (isVertical ? 0 : BADGE_ROOM)
        : "auto"
      : 0,
    opacity: expanded ? 1 : 0,
    // Not just hidden: `visibility` also takes the buttons out of the tab
    // order and the accessibility tree while collapsed, and it flips only at
    // the end of the collapse, so they still fade.
    visibility: expanded ? "visible" : "hidden",
    transition: reducedMotion
      ? "none"
      : expanded
        ? `${sizeTransition}, opacity 180ms ease-out 70ms, visibility 0s`
        : `${sizeTransition}, opacity 110ms ease-in, visibility 0s linear ${COLLAPSE_MS}ms`,
  };

  return (
    <div
      ref={rootRef}
      // Hover is an enhancement, not the mechanism: touch has none, so the
      // circle is a real button that pins.
      onMouseEnter={() => {
        if (dragging) return;
        if (isControlled) setExpanded(true);
        else setHovered(true);
      }}
      onMouseLeave={() => {
        if (dragging) return;
        if (isControlled) setExpanded(false);
        else setHovered(false);
      }}
      className={cn("inline-flex", isVertical ? "flex-col" : "flex-row")}
    >
      <OverlayMenuBar
        orientation={orientation}
        compact={compact}
        ghost={ghost}
        className={cn(
          // The circle and the buttons are laid out by the inner row.
          "gap-0",
          dragging ? "shadow-xl cursor-grabbing" : undefined,
        )}
      >
        {/* Order flips so the circle stays at the end of the edge it is
            nearest and the pill unrolls inwards. */}
        <div
          className={cn(
            "flex items-center",
            isVertical
              ? growsBackward
                ? "flex-col-reverse"
                : "flex-col"
              : growsBackward
                ? "flex-row-reverse"
                : "flex-row",
          )}
        >
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Close Val menu" : "Open Val menu"}
            data-overlay-launcher-circle=""
            onClick={() => setExpanded(isControlled ? !expanded : !pinned)}
            className={cn(
              "relative grid place-items-center shrink-0 rounded-full transition-colors",
              // Collapsed, this is the only thing to tap, so it keeps the full
              // size on a phone too.
              "w-8 h-8",
              "text-fg-primary hover:bg-bg-float-raised",
            )}
          >
            {mark}
            {status !== "none" && !expanded && (
              <span
                aria-hidden
                className={cn(
                  // Top right, clear of the mark's own dot at its foot. Grey
                  // for pending work, like every other draft marker; green is
                  // reserved for controls that commit something.
                  "absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full ring-2 ring-bg-float",
                  status === "errors"
                    ? "bg-bg-error-primary"
                    : "bg-fg-secondary",
                )}
              />
            )}
          </button>
          {/* The clip. Padded across the short axis, with a matching negative
              margin, so a button's badge is not cut off while the layout
              stays where it was. Collapsed to 0 the padding is all that is
              left, and the margin cancels it, so the circle stays round. */}
          <div
            style={clipStyle}
            className={cn(
              "overflow-hidden",
              isVertical ? "px-2 -mx-2" : "py-2 -my-2",
            )}
          >
            <div
              ref={contentRef}
              className={cn(
                "flex items-center w-max h-max",
                isVertical ? "flex-col" : "flex-row",
                compact ? "gap-0.5" : "gap-1",
                // Keeps the circle from touching the first button, on
                // whichever side the circle is.
                isVertical
                  ? growsBackward
                    ? "pb-1"
                    : "pt-1"
                  : growsBackward
                    ? "pr-1"
                    : "pl-1",
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
