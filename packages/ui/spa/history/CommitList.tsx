import { GitCommitHorizontal } from "lucide-react";
import type { HistoricalCommit } from "@valbuild/shared/internal";
import { cn } from "../components/designSystem/cn";
import { PanelEmptyState } from "../components/shell/FloatingPanel";
import { formatDateToString } from "../utils/formatDateToString";
import type { CommitListState } from "./useCommitList";

export type CommitListProps = {
  state: CommitListState;
  /** The commit the right pane is currently showing, if any. */
  selectedCommitSha: string | null;
  onSelect: (commitSha: string) => void;
  onStopComparing: () => void;
  onLoadMore: () => void;
};

/**
 * The list of publishes, and the way into the history view.
 *
 * This is the door. Everything behind it — the archives, the reconstruction,
 * the two-pane compare, the restore — shipped before this did, and until it
 * existed the whole feature was reachable only by reading a commit sha out of
 * the database and assembling a URL by hand.
 *
 * Presentational: the fetching is `useCommitList` and the navigation is
 * `setHistory`, both wired up in ValShell. Selecting a commit sets `?commit=`
 * and the rest of the Studio reacts to that — this list does not know what a
 * right pane is.
 */
export function CommitList({
  state,
  selectedCommitSha,
  onSelect,
  onStopComparing,
  onLoadMore,
}: CommitListProps) {
  if (state.status === "loading") {
    return <PanelEmptyState>Reading the history…</PanelEmptyState>;
  }
  if (state.status === "error") {
    return <PanelEmptyState>{state.message}</PanelEmptyState>;
  }
  if (state.commits.length === 0) {
    return (
      <PanelEmptyState>
        Nothing has been published on this branch yet. Publish a change and it
        will show up here.
      </PanelEmptyState>
    );
  }
  return (
    <>
      {selectedCommitSha !== null && (
        <div className="px-4 py-2.5 border-b border-border-float">
          <button
            type="button"
            onClick={onStopComparing}
            className="w-full h-8 rounded-md text-xs text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
          >
            Stop comparing
          </button>
        </div>
      )}
      <ul className="divide-y divide-border-float">
        {state.commits.map((commit) => (
          <CommitRow
            key={commit.commitSha}
            commit={commit}
            selected={commit.commitSha === selectedCommitSha}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {state.nextCursor !== null && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={state.loadingMore}
            className="w-full h-8 rounded-md text-xs text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary disabled:opacity-60"
          >
            {state.loadingMore
              ? "Loading…"
              : state.loadMoreError !== null
                ? "Try again"
                : "Load more"}
          </button>
          {/*
           * A failed page is reported here rather than replacing the list: the
           * commits already read are still good. Without this the button just
           * stops working, which reads as the feature being broken.
           */}
          {state.loadMoreError !== null && !state.loadingMore && (
            <p className="pt-2 text-[0.6875rem] text-fg-error-primary">
              {state.loadMoreError}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function CommitRow({
  commit,
  selected,
  onSelect,
}: {
  commit: HistoricalCommit;
  selected: boolean;
  onSelect: (commitSha: string) => void;
}) {
  /*
   * A commit with no archive cannot be opened.
   *
   * These are commits made before Val recorded history, and ones made outside
   * Val — a push straight to the repo. They are still listed, because leaving
   * them out would make the history look like it holds fewer changes than it
   * does, but there is nothing behind them to show.
   */
  const openable = commit.hasArchive;
  return (
    <li>
      <button
        type="button"
        /*
         * `aria-disabled`, not `disabled`.
         *
         * A `disabled` button fires no pointer events in most browsers and is
         * out of the tab order, so the `title` saying WHY the row cannot be
         * opened is the one thing nobody could reach - not by hovering, and
         * not at all with a keyboard. `aria-disabled` announces the state and
         * keeps the row focusable, so the explanation is reachable both ways;
         * the click is guarded here instead of by the browser.
         */
        aria-disabled={!openable}
        onClick={() => {
          if (!openable) return;
          onSelect(commit.commitSha);
        }}
        aria-current={selected ? "true" : undefined}
        title={
          openable
            ? undefined
            : "Made before Val started recording history, or pushed straight to the repository, so there is nothing to compare against."
        }
        className={cn(
          "flex gap-2.5 w-full px-4 py-2.5 text-left",
          openable
            ? "hover:bg-bg-float-raised"
            : "opacity-55 cursor-not-allowed",
          selected && "bg-bg-float-raised",
        )}
      >
        <span
          className={cn(
            "grid place-items-center w-6 h-6 mt-0.5 shrink-0 rounded-md",
            selected
              ? "bg-bg-brand-primary text-fg-brand-primary"
              : "bg-bg-float-raised text-fg-secondary",
          )}
        >
          <GitCommitHorizontal size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-fg-primary truncate">
            {commit.message?.trim() || "No message"}
          </span>
          <span className="block text-[0.6875rem] text-fg-secondary-alt">
            {describeCommit(commit)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The second line of a row: when, who, and how much.
 *
 * Assembled from the parts that are actually there rather than from a template
 * with holes in it — `creator` is null for a commit Val did not make, and
 * "· by " with nothing after it reads like a bug.
 */
export function describeCommit(commit: HistoricalCommit): string {
  const parts: string[] = [formatDateToString(new Date(commit.createdAt))];
  if (commit.creator) {
    parts.push(commit.creator);
  }
  if (commit.patchCount > 0) {
    parts.push(
      commit.patchCount === 1 ? "1 change" : `${commit.patchCount} changes`,
    );
  }
  return parts.join(" · ");
}
