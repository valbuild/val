import { forwardRef, ReactNode } from "react";
import { GripHorizontal, X } from "lucide-react";
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
}: {
  title: string;
  compact?: boolean;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      style={style}
      className={cn(
        "flex flex-col rounded-lg bg-bg-float text-fg-primary",
        "border border-border-float shadow-xl",
        className,
      )}
    >
      <div className="grid grid-cols-3 items-center shrink-0 px-3 h-11 border-b border-border-float">
        <div className="text-[0.8125rem] font-semibold tracking-tight truncate">
          {title}
        </div>
        <div className="flex justify-center text-fg-secondary-alt">
          {!compact && <GripHorizontal size={16} />}
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
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
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
