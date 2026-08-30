import {
  AlertTriangle,
  Clock,
  FilePlus2,
  GitCompare,
  ImagePlus,
  Sparkles,
} from "lucide-react";
import {
  FloatingPanel,
  PanelEmptyState,
  PanelSectionLabel,
} from "./FloatingPanel";
import {
  ShellActivityEntry,
  ShellBreakpoint,
  ShellDestination,
  ShellValidationError,
} from "./types";

export type UtilityPanelProps = {
  breakpoint: ShellBreakpoint;
  /** Absent while the patch sets are still loading. */
  activity?: ShellActivityEntry[];
  /** Validation errors, grouped by item. Shown first when there are any. */
  validationErrors?: ShellValidationError[];
  onSelectValidationError?: (error: ShellValidationError) => void;
  onNewPage: () => void;
  onUploadMedia: () => void;
  /**
   * Open the assistant. Absent when the project has no assistant configured —
   * see `ShellProps.aiEnabled` — and the row is then not offered at all.
   */
  onOpenAI?: () => void;
  /**
   * The destinations this project has content for. All of them when absent.
   *
   * The shortcuts are shortcuts *to the destinations*, so they follow the same
   * rule the rail does: "Upload media" in a project with no gallery to upload
   * into is an action that cannot complete.
   */
  destinations?: readonly ShellDestination[];
  /**
   * Open the review view: every pending change, side by side with what it
   * replaces.
   *
   * A quick action rather than a permanent control, because it is a thing you
   * do before publishing rather than something to look at while editing — and
   * the publish button is right there when you are ready. Absent when there is
   * nothing to review.
   */
  onCompare?: () => void;
  /** How many changes `onCompare` would show. */
  pendingChanges?: number;
  onSelectActivity: (entry: ShellActivityEntry) => void;
  onClose: () => void;
};

/**
 * The right utility panel: 260px of quick actions and recent activity, plus
 * a way into the assistant. Narrow on purpose — it is a shortcut surface,
 * not a dashboard.
 */
export function UtilityPanel({
  breakpoint,
  activity = [],
  validationErrors = [],
  onSelectValidationError,
  onNewPage,
  onUploadMedia,
  onOpenAI,
  destinations,
  onCompare,
  pendingChanges = 0,
  onSelectActivity,
  onClose,
}: UtilityPanelProps) {
  const offers = (destination: ShellDestination) =>
    destinations === undefined || destinations.includes(destination);
  return (
    <FloatingPanel
      side="right"
      width={260}
      title="Quick actions"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
    >
      <div className="pb-4">
        {validationErrors.length > 0 && (
          <>
            {/* Errors come before the shortcuts: they block publishing, so
                they are the most useful thing this panel can say. */}
            <PanelSectionLabel className="pt-3 text-fg-error-on-surface">
              Validation errors
              <span className="ml-1.5 font-normal normal-case tracking-normal tabular-nums">
                {validationErrors.reduce((sum, e) => sum + e.count, 0)}
              </span>
            </PanelSectionLabel>
            <ul className="px-3 pt-0.5">
              {validationErrors.map((error) => (
                <li key={error.id}>
                  <button
                    type="button"
                    onClick={() => onSelectValidationError?.(error)}
                    className="flex gap-2 w-full px-1.5 py-1.5 rounded-md text-left hover:bg-bg-float-raised"
                  >
                    <AlertTriangle
                      size={13}
                      className="mt-0.5 shrink-0 text-fg-error-on-surface"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-fg-primary truncate">
                        {error.title}
                      </span>
                      <span className="block text-[0.6875rem] text-fg-secondary-alt truncate">
                        {error.detail}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.6875rem] tabular-nums text-fg-secondary-alt">
                      {error.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <PanelSectionLabel divided>Quick actions</PanelSectionLabel>
          </>
        )}
        <div className="px-3 pt-3 space-y-0.5">
          {onCompare && pendingChanges > 0 && (
            <QuickAction
              icon={GitCompare}
              label={`Review ${pendingChanges} ${
                pendingChanges === 1 ? "change" : "changes"
              }`}
              onClick={onCompare}
            />
          )}
          {offers("pages") && (
            <QuickAction
              icon={FilePlus2}
              label="New page"
              onClick={onNewPage}
            />
          )}
          {offers("media") && (
            <QuickAction
              icon={ImagePlus}
              label="Upload media"
              onClick={onUploadMedia}
            />
          )}
          {/*
           * No "New data file".
           *
           * A val module is a TypeScript file with a schema in it, so making one
           * is something you do in the editor and not something the Studio can
           * offer from a menu — the action existed as a shortcut to a flow that
           * was never built, and did nothing when pressed.
           */}
        </div>

        <PanelSectionLabel divided>Recent activity</PanelSectionLabel>
        {activity.length === 0 ? (
          <PanelEmptyState>
            No recent activity. Your changes will show up here.
          </PanelEmptyState>
        ) : (
          <ul className="px-3 pt-0.5">
            {activity.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelectActivity(entry)}
                  className="flex gap-2 w-full px-1.5 py-1.5 rounded-md text-left hover:bg-bg-float-raised"
                >
                  <Clock
                    size={13}
                    className="mt-0.5 shrink-0 text-fg-secondary-alt"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs text-fg-primary truncate">
                      {entry.title}
                    </span>
                    <span className="block text-[0.6875rem] text-fg-secondary-alt">
                      {entry.author ? `${entry.author} · ` : ""}
                      {entry.timestamp}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {onOpenAI && (
          <div className="px-3 pt-4">
            <button
              type="button"
              onClick={onOpenAI}
              className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <Sparkles size={14} />
              Ask the assistant
            </button>
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FilePlus2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
    >
      <Icon size={14} className="text-fg-secondary-alt" />
      {label}
    </button>
  );
}
