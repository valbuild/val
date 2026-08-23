import {
  AlertTriangle,
  Bell,
  Check,
  ChevronsUpDown,
  Eye,
  Loader2,
  Menu,
  PanelRight,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { Avatar } from "./Avatar";
import { ValLogo } from "./ValLogo";
import { ShellBreakpoint, ShellPanel } from "./types";

export type TopBarProps = {
  breakpoint: ShellBreakpoint;
  projectName: string;
  projects: string[];
  onSelectProject: (project: string) => void;
  openPanel: ShellPanel | null;
  onTogglePanel: (panel: ShellPanel) => void;
  /** Opens the navigation: the rail's panels, reached from a menu button. */
  onOpenMenu: () => void;
  unreadNotifications: number;
  user: { name: string; initials: string };
  onOpenSearch: () => void;
  onPreview: () => void;
  onPublish: () => void;
  /** Number of changes Publish would ship. 0 disables the button. */
  pendingChanges: number;
  publishState?: PublishState;
  /**
   * Number of validation errors across the project. Publishing with errors is
   * blocked, so the count is surfaced next to the button that is blocked.
   */
  validationErrorCount?: number;
  onShowErrors?: () => void;
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
  projects,
  onSelectProject,
  openPanel,
  onTogglePanel,
  onOpenMenu,
  unreadNotifications,
  user,
  onOpenSearch,
  onPreview,
  onPublish,
  pendingChanges,
  publishState = "idle",
  validationErrorCount = 0,
  onShowErrors,
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
        <div className="grid place-items-center w-7 h-7 rounded-md bg-bg-accent-primary text-fg-on-accent shrink-0">
          <ValLogo className="w-4 h-4" />
        </div>
      )}
      <ProjectSwitcher
        projectName={projectName}
        projects={projects}
        onSelectProject={onSelectProject}
      />
      <SearchTrigger breakpoint={breakpoint} onClick={onOpenSearch} />
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {!isMobile && (
          <>
            <button
              type="button"
              onClick={onPreview}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <Eye size={14} />
              <span className="hidden md:inline">Preview</span>
              <span className="hidden lg:inline text-fg-secondary-alt">
                (draft)
              </span>
            </button>
            {validationErrorCount > 0 && onShowErrors && (
              <ValidationErrorPill
                count={validationErrorCount}
                onClick={onShowErrors}
              />
            )}
            <PublishButton
              pendingChanges={pendingChanges}
              onPublish={onPublish}
              publishState={publishState}
            />
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
            <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 grid place-items-center rounded-full bg-bg-accent-primary text-fg-on-accent text-[0.625rem] font-semibold tabular-nums">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </IconButton>
        <BarDivider />
        <button
          type="button"
          aria-label={`Account: ${user.name}`}
          onClick={() => onTogglePanel("settings")}
          className="rounded-full shrink-0"
        >
          <Avatar initials={user.initials} size="sm" />
        </button>
      </div>
    </header>
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
          ? "bg-bg-accent-subtle text-fg-accent-primary"
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
          : "bg-bg-accent-primary text-fg-on-accent hover:bg-bg-accent-primary-hover",
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

function ProjectSwitcher({
  projectName,
  projects,
  onSelectProject,
}: {
  projectName: string;
  projects: string[];
  onSelectProject: (project: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-8 min-w-0 px-2 rounded-md text-[0.8125rem] font-semibold tracking-tight hover:bg-bg-float-raised"
        >
          <span className="truncate">{projectName}</span>
          <ChevronsUpDown size={13} className="shrink-0 text-fg-secondary" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-secondary-alt">
          Projects
        </div>
        {projects.map((project) => (
          <button
            key={project}
            type="button"
            onClick={() => onSelectProject(project)}
            className="flex w-full items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-bg-secondary-hover"
          >
            <span className="truncate">{project}</span>
            {project === projectName && (
              <Check
                size={14}
                className="ml-auto shrink-0 text-fg-accent-primary"
              />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
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
