import {
  AlertTriangle,
  Bell,
  ChevronDown,
  Columns2,
  Eye,
  Link2,
  Loader2,
  LucideIcon,
  Menu,
  PanelRight,
  Search,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { Avatar } from "./Avatar";
import { AccountErrorDot } from "./AccountError";
import { ValLogo } from "./ValLogo";
import { ShellBreakpoint, ShellPanel } from "./types";
import { useDismissOnOutsidePointer } from "./useDismissOnOutsidePointer";

export type TopBarProps = {
  breakpoint: ShellBreakpoint;
  projectName: string;
  openPanel: ShellPanel | null;
  onTogglePanel: (panel: ShellPanel) => void;
  /** Opens the navigation: the rail's panels, reached from a menu button. */
  onOpenMenu: () => void;
  /**
   * `undefined` means Val has no notification feed to show, and the bell is
   * hidden; a number — including 0 — means show it.
   */
  unreadNotifications?: number;
  /** Absent until a profile loads, and in modes that have none. */
  user?: { name: string; initials: string };
  onOpenSearch: () => void;
  onPreview: () => void;
  /**
   * Opens the canvas beside the editor.
   *
   * `undefined` means the current selection has no route Val can put on a
   * canvas, and the button is not shown — an inert one would be worse.
   */
  onToggleCanvas?: () => void;
  isCanvasOpen?: boolean;
  onPublish: () => void;
  /**
   * The real publish control, when there is one.
   *
   * Publishing is not a button press: it needs a commit summary, it is
   * disabled by validation errors and conflicting patches, and in `fs` mode it
   * says "Save" instead. That behaviour already exists, so the app passes the
   * control itself rather than the shell growing a second copy of the rules.
   */
  publishSlot?: ReactNode;
  /** Number of changes Publish would ship. 0 disables the button. */
  pendingChanges: number;
  publishState?: PublishState;
  /**
   * Number of validation errors across the project. Publishing with errors is
   * blocked, so the count is surfaced next to the button that is blocked.
   */
  validationErrorCount?: number;
  onShowErrors?: () => void;
  /**
   * Set when the account could not be loaded, and the studio has stopped trying.
   *
   * This is the case where `user` is absent, so it also has to *put* a control
   * here: with nothing to show, the top bar dropped the account button
   * altogether and there was no way left to reach the panel that explains it.
   */
  accountError?: { message: string };
  /** Blinks the mark, as a terminal caret does while it waits. */
  isLoading?: boolean;
};

/** `blocked` means validation errors are stopping the publish. */
export type PublishState = "idle" | "publishing" | "error" | "blocked";

/**
 * The floating top bar.
 *
 * Preview and Publish stay visible at every breakpoint above mobile; on
 * mobile they move to the sticky bottom bar and the top bar keeps only
 * navigation, notifications, AI and account.
 */
export function TopBar({
  breakpoint,
  projectName,
  openPanel,
  onTogglePanel,
  onOpenMenu,
  unreadNotifications,
  user,
  onOpenSearch,
  onPreview,
  onToggleCanvas,
  isCanvasOpen,
  onPublish,
  publishSlot,
  pendingChanges,
  publishState = "idle",
  validationErrorCount = 0,
  onShowErrors,
  accountError,
  isLoading,
}: TopBarProps) {
  const isMobile = breakpoint === "mobile";
  const isDesktop = breakpoint === "desktop";
  return (
    <header
      className={cn(
        "absolute z-full top-3 h-11 flex items-center gap-1.5 px-2 rounded-lg",
        "bg-bg-float border border-border-float shadow-sm",
        // Leaves room for the rail on desktop; full-bleed below that.
        isDesktop ? "left-[4.75rem] right-3" : "left-3 right-3",
      )}
    >
      {!isDesktop && (
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onOpenMenu}
          className="grid place-items-center w-8 h-8 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary shrink-0"
        >
          <Menu size={17} />
        </button>
      )}
      {!isDesktop && (
        <div className="grid place-items-center w-7 h-7 shrink-0 text-fg-primary">
          <ValLogo className="h-5" blinking={isLoading} />
        </div>
      )}
      <ProjectName projectName={projectName} />
      <SearchTrigger breakpoint={breakpoint} onClick={onOpenSearch} />
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {!isMobile && (
          <>
            <PreviewButton
              onPreview={onPreview}
              onToggleCanvas={onToggleCanvas}
              isCanvasOpen={isCanvasOpen}
            />
            {validationErrorCount > 0 && onShowErrors && (
              <ValidationErrorPill
                count={validationErrorCount}
                onClick={onShowErrors}
              />
            )}
            {publishSlot ?? (
              <PublishButton
                pendingChanges={pendingChanges}
                onPublish={onPublish}
                publishState={publishState}
              />
            )}
            <BarDivider />
          </>
        )}
        <IconButton
          label="AI assistant"
          active={openPanel === "ai"}
          onClick={() => onTogglePanel("ai")}
        >
          <Sparkles size={16} />
        </IconButton>
        {!isMobile && (
          <IconButton
            label="Quick actions"
            active={openPanel === "utility"}
            onClick={() => onTogglePanel("utility")}
          >
            <PanelRight size={16} />
          </IconButton>
        )}
        {unreadNotifications !== undefined && (
          <IconButton
            label={
              unreadNotifications > 0
                ? `Notifications (${unreadNotifications} unread)`
                : "Notifications"
            }
            active={openPanel === "notifications"}
            onClick={() => onTogglePanel("notifications")}
          >
            <Bell size={16} />
            {unreadNotifications > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 grid place-items-center rounded-full bg-fg-primary text-bg-float text-[0.625rem] font-semibold tabular-nums">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </IconButton>
        )}
        {(user || accountError) && (
          <>
            <BarDivider />
            <button
              type="button"
              aria-label={
                accountError
                  ? `Account: ${accountError.message}`
                  : `Account: ${user?.name}`
              }
              title={accountError?.message}
              onClick={() => onTogglePanel("settings")}
              className="relative shrink-0 rounded-full"
            >
              {user ? (
                <Avatar initials={user.initials} size="sm" />
              ) : (
                <span className="grid h-6 w-6 place-items-center rounded-full text-fg-secondary">
                  <UserRound size={15} />
                </span>
              )}
              {accountError && <AccountErrorDot />}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

/**
 * Preview, with the canvas as its other half.
 *
 * One control, because they are one intention — "show me the page" — that
 * differs only in where it opens. Two buttons side by side made that a choice
 * about chrome rather than about the page, and the canvas is the one people
 * want most of the time, so it is the default action and the tab stays for the
 * times it is not.
 *
 * Shaped like a split button: the main half acts, the caret offers the other
 * way. The canvas half disappears when there is nothing to put on one, and the
 * control quietly becomes an ordinary Preview button rather than offering a
 * dead option.
 */
export function PreviewButton({
  onPreview,
  onToggleCanvas,
  isCanvasOpen,
  className,
  menuPlacement = "below",
  alwaysShowLabel,
}: {
  onPreview: () => void;
  onToggleCanvas?: () => void;
  isCanvasOpen?: boolean;
  /** For the mobile bar, where this shares a row with Publish. */
  className?: string;
  /**
   * Which way the menu opens.
   *
   * `above` for the mobile bottom bar: a menu that drops down from a control at
   * the bottom of the screen opens off the screen.
   */
  menuPlacement?: "below" | "above";
  /**
   * Keep the word "Preview" at every width.
   *
   * The top bar hides it below `md` because it is competing with the project
   * name, the search box and four icons. The mobile bottom bar has room, and a
   * bare icon there is the least discoverable control in the app.
   */
  alwaysShowLabel?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const labelClassName = alwaysShowLabel ? undefined : "hidden md:inline";

  // Without a canvas there is nothing to choose between, so there is no menu.
  if (!onToggleCanvas) {
    return (
      <button
        type="button"
        onClick={onPreview}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary",
          className,
        )}
      >
        <Eye size={14} />
        <span className={labelClassName}>Preview</span>
      </button>
    );
  }

  return (
    // The height is on the wrapper so a caller can change it — `tailwind-merge`
    // lets `h-9` from the mobile bar replace the default rather than fight it.
    <div ref={containerRef} className={cn("relative h-8", className)}>
      <div
        className={cn(
          "inline-flex h-full w-full items-stretch overflow-hidden rounded-md border",
          isCanvasOpen
            ? "border-border-float bg-bg-float-raised text-fg-primary"
            : "border-border-float text-fg-secondary",
        )}
      >
        <button
          type="button"
          aria-label={isCanvasOpen ? "Close the canvas" : "Open the canvas"}
          aria-pressed={isCanvasOpen}
          onClick={onToggleCanvas}
          className="inline-flex flex-1 items-center justify-center gap-1.5 px-2.5 text-xs font-medium hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Columns2 size={14} />
          <span className={labelClassName}>Preview</span>
        </button>
        <span aria-hidden className="w-px self-stretch bg-border-float" />
        <button
          type="button"
          aria-label="Other ways to preview"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="grid w-6 place-items-center hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {isOpen && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-full w-56 rounded-md border border-border-float bg-bg-float py-1 shadow-lg",
            menuPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          <PreviewMenuItem
            icon={Columns2}
            label={isCanvasOpen ? "Close the canvas" : "Open the canvas"}
            detail="Beside the editor, in the studio"
            onClick={() => {
              setIsOpen(false);
              onToggleCanvas();
            }}
          />
          <PreviewMenuItem
            icon={Link2}
            label="Open in a new tab"
            detail="The page with your unpublished changes"
            onClick={() => {
              setIsOpen(false);
              onPreview();
            }}
          />
        </div>
      )}
    </div>
  );
}

function PreviewMenuItem({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-xs">{label}</span>
        <span className="block text-[0.6875rem] text-fg-secondary-alt">
          {detail}
        </span>
      </span>
    </button>
  );
}

/** Groups the bar's controls: actions, then surfaces, then the account. */
function BarDivider() {
  return <span aria-hidden className="w-px h-5 mx-0.5 bg-border-float" />;
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative grid place-items-center w-8 h-8 rounded-md shrink-0",
        active
          ? "bg-bg-float-raised text-fg-primary"
          : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

export function PublishButton({
  pendingChanges,
  onPublish,
  publishState = "idle",
  className,
}: {
  pendingChanges: number;
  onPublish: () => void;
  publishState?: PublishState;
  className?: string;
}) {
  // Nothing to ship, mid-flight, or blocked by validation errors: all three
  // mean the button must not accept another click.
  const disabled =
    pendingChanges === 0 ||
    publishState === "publishing" ||
    publishState === "blocked";
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={disabled}
      title={
        publishState === "blocked"
          ? "Fix the validation errors before publishing"
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
        publishState === "error"
          ? "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover"
          : "bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary hover:bg-bg-brand-primary-hover",
        "disabled:bg-bg-disabled disabled:text-fg-disabled",
        className,
      )}
    >
      {publishState === "publishing" ? (
        <Loader2 size={14} className="animate-spin" />
      ) : publishState === "error" ? (
        <AlertTriangle size={14} />
      ) : (
        <Upload size={14} />
      )}
      {publishState === "publishing"
        ? "Publishing…"
        : publishState === "error"
          ? "Publish failed"
          : "Publish"}
      {publishState === "idle" && pendingChanges > 0 && (
        <span className="tabular-nums opacity-80">{pendingChanges}</span>
      )}
    </button>
  );
}

/** How many validation errors stand between here and a publish. */
function ValidationErrorPill({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${count} validation ${count === 1 ? "error" : "errors"} — fix these before publishing`}
      aria-label={`${count} validation ${count === 1 ? "error" : "errors"}`}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-fg-error-on-surface border border-border-error-primary hover:bg-bg-error-secondary"
    >
      <AlertTriangle size={14} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

/**
 * The project's name. Val runs one project per config, so this is a label
 * rather than a switcher — there is nothing to switch to.
 */
function ProjectName({ projectName }: { projectName: string }) {
  return (
    <span className="min-w-0 px-2 text-[0.8125rem] font-semibold tracking-tight truncate">
      {projectName}
    </span>
  );
}

/**
 * The way into the global search. A hinted pill on wide screens so the
 * shortcut is discoverable; an icon once space is tight.
 */
function SearchTrigger({
  breakpoint,
  onClick,
}: {
  breakpoint: ShellBreakpoint;
  onClick: () => void;
}) {
  if (breakpoint === "mobile") {
    return (
      <button
        type="button"
        aria-label="Search"
        onClick={onClick}
        className="grid place-items-center w-8 h-8 shrink-0 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
      >
        <Search size={16} />
      </button>
    );
  }
  return (
    <button
      type="button"
      // Labelled as well as captioned: the word and the shortcut are both
      // `lg:inline`, so between the mobile breakpoint and `lg` this button has
      // an icon and nothing else to take its name from.
      aria-label="Search"
      onClick={onClick}
      className="inline-flex items-center gap-2 h-8 pl-2 pr-1.5 rounded-md text-xs text-fg-secondary-alt border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
    >
      <Search size={14} />
      <span className="hidden lg:inline">Search</span>
      <kbd className="hidden lg:inline px-1.5 py-0.5 rounded border border-border-float text-[0.625rem] font-sans">
        ⌘K
      </kbd>
    </button>
  );
}
