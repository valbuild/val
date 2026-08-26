import {
  AlertTriangle,
  Braces,
  Clock,
  FilePlus2,
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
  onNewDataFile: () => void;
  onOpenAI: () => void;
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
  onNewDataFile,
  onOpenAI,
  onSelectActivity,
  onClose,
}: UtilityPanelProps) {
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
          <QuickAction icon={FilePlus2} label="New page" onClick={onNewPage} />
          <QuickAction
            icon={ImagePlus}
            label="Upload media"
            onClick={onUploadMedia}
          />
          <QuickAction
            icon={Braces}
            label="New data file"
            onClick={onNewDataFile}
          />
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
