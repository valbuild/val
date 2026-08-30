import {
  AlertTriangle,
  Clock,
  FilePlus2,
  GitCompare,
  ImagePlus,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
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
   * Throw away every pending change.
   *
   * A prop rather than something this panel does, because the shell is
   * presentational and this is the most destructive action in the Studio: the
   * confirm lives here, next to the button, and the deletion lives with the
   * store. Absent means the current mode cannot discard, and the row is not
   * offered — a disabled one would raise a question it cannot answer.
   */
  onDiscardAll?: () => void;
  /**
   * What the confirm says will be lost, phrased by `discardAllDescription`.
   *
   * Passed in rather than composed here: it names the other people whose work
   * is about to go, and this panel has no profiles to name them from. Sharing
   * the sentence with the review view's Discard all is the point — two
   * confirms for the same act that describe it differently are two chances to
   * mean something slightly untrue.
   */
  discardAllDescription?: string;
  /**
   * Where the discard confirm portals to.
   *
   * It has to be a node INSIDE the shadow root. Radix's default is
   * `document.body`, which is outside it — the popup then renders with none of
   * Val's styles, which is a confirm dialog that is there but cannot be seen or
   * read. `ValPortalProvider` owns that node; the shell takes it as a prop
   * rather than reading the context, so it stays presentational.
   */
  portalContainer?: HTMLElement | null;
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
  /**
   * The number Review announces — see `TopBarProps.reviewCount`.
   *
   * Separate from `pendingChanges`, which decides VISIBILITY: work that has all
   * been reverted is still worth reviewing (Discard lives there), it just is
   * not N changes. Without this the phone said "Review 3 changes" while the
   * desktop badge said none, about the same chain.
   */
  reviewCount?: number;
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
  reviewCount,
  onDiscardAll,
  discardAllDescription,
  portalContainer,
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
          {/*
           * Mobile only: above that the top bar carries Review, beside Publish.
           *
           * Two controls with the same name on one screen is one too many —
           * for a screen reader it is genuinely ambiguous, and for everyone
           * else it is a second place to look for something already in view.
           * The top bar hides Review on mobile, which is what this is for.
           */}
          {onCompare && pendingChanges > 0 && breakpoint === "mobile" && (
            <QuickAction
              icon={GitCompare}
              label={
                reviewCount === undefined || reviewCount > 0
                  ? `Review ${reviewCount ?? pendingChanges} ${
                      (reviewCount ?? pendingChanges) === 1
                        ? "change"
                        : "changes"
                    }`
                  : "Review changes"
              }
              onClick={onCompare}
            />
          )}
          {onDiscardAll && pendingChanges > 0 && (
            <DiscardAllQuickAction
              count={pendingChanges}
              description={discardAllDescription}
              onConfirm={onDiscardAll}
              portalContainer={portalContainer}
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

/**
 * Discard all, with the confirm it has to have.
 *
 * Shaped like the other quick actions until it is pressed, then it asks —
 * unpublished work is not recoverable once this runs, and a one-click row
 * between "New page" and "Upload media" would be a trap.
 */
function DiscardAllQuickAction({
  count,
  description,
  onConfirm,
  portalContainer,
}: {
  count: number;
  description?: string;
  onConfirm: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const label = `Discard ${count} ${count === 1 ? "change" : "changes"}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <Undo2 size={14} className="text-fg-secondary-alt" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        // Without this the confirm portals to `document.body`, outside the
        // shadow root, and renders unstyled — which looks exactly like the
        // button doing nothing. See `ValPortalProvider`.
        container={portalContainer}
        align="start"
        className="w-64 flex flex-col gap-3"
      >
        <div>
          <p className="text-xs font-semibold text-fg-primary">{`${label}?`}</p>
          {description !== undefined && (
            <p className="mt-1 text-xs text-fg-secondary">{description}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {`Discard ${count}`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
