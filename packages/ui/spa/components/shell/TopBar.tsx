import {
  AlertTriangle,
  Bell,
  ChevronDown,
  Columns2,
  Eye,
  GitCompare,
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
  /**
   * Opens the review view. Absent in layouts that have none.
   *
   * Review sits beside Publish because it is the step before it: a reader who
   * is about to ship wants to see what they are shipping, and the action lived
   * only in the Quick actions panel — two clicks away, behind an icon that does
   * not say "review".
   */
  onCompare?: () => void;
  /**
   * The number on Review's badge. 0 shows the button with no badge.
   *
   * The same count the Quick actions panel puts on "Review N changes" — one
   * number, so the two cannot disagree — but zeroed when every pending patch
   * has been reverted. There is still something to review THERE (Discard lives
   * in that view, and Publish is off until it is used), so the button stays;
   * what it must not do is advertise changes that will not ship.
   */
  reviewCount?: number;
  publishState?: PublishState;
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
  /**
   * The preview URL, so "Open in a new tab" is a link. See `PreviewButton`.
   */
  previewHref?: string;
  /**
   * Whether this project has an assistant. See `ShellProps.aiEnabled`.
   *
   * Absent hides the button rather than disabling it: it is the only thing in
   * the bar that opens a panel with nothing behind it.
   */
  aiEnabled?: boolean;
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
  onCompare,
  reviewCount,
  publishState = "idle",
  accountError,
  isLoading,
  aiEnabled = false,
  previewHref,
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
              previewHref={previewHref}
              onToggleCanvas={onToggleCanvas}
              isCanvasOpen={isCanvasOpen}
            />
            <ReviewButton
              onCompare={onCompare}
              pendingChanges={pendingChanges}
              reviewCount={reviewCount}
            />
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
        {aiEnabled && (
          <IconButton
            label="AI assistant"
            active={openPanel === "ai"}
            onClick={() => onTogglePanel("ai")}
          >
            <Sparkles size={16} />
          </IconButton>
        )}
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
  previewHref,
  onToggleCanvas,
  isCanvasOpen,
  className,
  menuPlacement = "below",
  alwaysShowLabel,
}: {
  onPreview: () => void;
  /**
   * The preview URL, when the shell can name one.
   *
   * Turns "Open in a new tab" into a real link — see `PreviewMenuItem`. Absent
   * falls back to `onPreview`, which is what the stories use.
   */
  previewHref?: string;
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
            /*
             * An `href` where there is one, so this behaves like a link: middle
             * click, modifier click, and "Copy link address" — which is the
             * point, because the link turns preview ON for whoever opens it and
             * is therefore worth sending to someone.
             */
            href={previewHref}
            onClick={() => {
              setIsOpen(false);
              if (previewHref === undefined) onPreview();
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
  href,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  onClick: () => void;
  /** Renders the item as a link. See "Open in a new tab" above. */
  href?: string;
}) {
  const shared =
    "flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary";
  const inner = (
    <>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-xs">{label}</span>
        <span className="block text-[0.6875rem] text-fg-secondary-alt">
          {detail}
        </span>
      </span>
    </>
  );
  if (href !== undefined) {
    return (
      <a
        role="menuitem"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={shared}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onClick} className={shared}>
      {inner}
    </button>
  );
}

/** Groups the bar's controls: actions, then surfaces, then the account. */
function BarDivider() {
  return <span aria-hidden className="w-px h-5 mx-0.5 bg-border-float" />;
}

/**
 * Review, beside Publish.
 *
 * Shown only when there is unpublished work: with nothing pending there is
 * nothing to review, and an always-present button that opens an empty list is
 * one more thing in a bar that already has six.
 *
 * The badge shows `reviewCount`, which is the pending patch count zeroed when
 * all of it has been reverted. In that case the button stays — the review view
 * is where Discard lives, and Publish is disabled until it is used, so removing
 * the only route to it would strand the editor — but it carries no number,
 * because the honest number is zero and a "0" badge reads as a bug.
 */
function ReviewButton({
  onCompare,
  pendingChanges,
  reviewCount,
}: {
  onCompare?: () => void;
  pendingChanges: number;
  reviewCount?: number;
}) {
  if (!onCompare || pendingChanges === 0) return null;
  const showCount = reviewCount !== undefined && reviewCount > 0;
  return (
    <button
      type="button"
      onClick={onCompare}
      aria-label={
        showCount
          ? `Review ${reviewCount} ${reviewCount === 1 ? "change" : "changes"}`
          : "Review changes"
      }
      className="relative inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md shrink-0 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      <GitCompare size={15} />
      <span className="text-[0.8125rem]">Review</span>
      {showCount && (
        // The notification bell's badge, to the pixel: two counters in one bar
        // that are shaped differently read as two different kinds of thing.
        <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 grid place-items-center rounded-full bg-fg-primary text-bg-float text-[0.625rem] font-semibold tabular-nums">
          {reviewCount > 9 ? "9+" : reviewCount}
        </span>
      )}
    </button>
  );
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
