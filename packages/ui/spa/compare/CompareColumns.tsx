import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../components/designSystem/cn";
import type { CompareSide } from "./types";

/**
 * The two columns, and the promise that you never have to guess which is which.
 *
 * Left is older. That is the rule, and it is the opposite of what `HistorySplit`
 * does today (left is "Now", right is the commit) — a conflict that is
 * deliberately NOT resolved by this component. Flipping a shipped view is a
 * separate decision; what this does instead is make the direction impossible to
 * read wrong in either place, by never relying on position to carry it:
 *
 * 1. **A persistent header per column.** Not a caption that scrolls away — the
 *    header is sticky, because the question "which side am I looking at" is
 *    asked halfway down a long diff, which is exactly where a header at the top
 *    of the page has stopped answering it.
 * 2. **A direction arrow between them**, pointing left to right, with the
 *    relationship spelled out for screen readers.
 * 3. **A caption under each label** — a date on the left, a count on the right.
 *    Two columns headed "Published" and "After publish" are already unambiguous;
 *    two headed with commit messages are not, and the caption is what separates
 *    them.
 *
 * Below `lg` there is no room for two columns, so it becomes one pane and a
 * tab pair — the same move `HistorySplit` makes, deliberately: this dialog is a
 * second place to do the thing that view already does, and two different mobile
 * gestures for it would be worse than one.
 */
export function CompareColumns({
  children,
  leftSide,
  rightSide,
  /**
   * Extra chrome that belongs to the pane rather than to a column — the "show
   * all fields" toggle. Sits above the headers so it is not mistaken for
   * belonging to either side.
   */
  toolbar,
  className,
}: {
  /**
   * The rows. ONE body, not a left and a right.
   *
   * This used to take two nodes and lay them out as two grids side by side,
   * which meant every label was drawn twice and the two halves had to be kept
   * in step row for row. `ComparePaneRows` now owns the pairing — each row is
   * one grid with two cells — so all this has to do is put the headers over the
   * same column template the rows use.
   */
  children: ReactNode;
  leftSide: CompareSide;
  rightSide: CompareSide;
  toolbar?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      {toolbar !== undefined && (
        <div className="flex items-center justify-end gap-2 pb-2">
          {toolbar}
        </div>
      )}
      <ColumnHeaders leftSide={leftSide} rightSide={rightSide} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * The sticky pair of column headings, with the arrow between them.
 *
 * Hidden below `lg`, where the tabs in {@link CompareMobileColumns} are the
 * header — two of them at once would be the same claim made twice, and the tab
 * is the one that is also a control.
 */
function ColumnHeaders({
  leftSide,
  rightSide,
}: {
  leftSide: CompareSide;
  rightSide: CompareSide;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 grid bg-bg-primary pb-2",
        // The same template every row uses, so a header sits over its column.
        "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-3",
      )}
    >
      <SideHeading side={leftSide} align="left" />
      <div
        className="flex w-4 items-center justify-center pb-1 text-fg-tertiary"
        /*
         * The relationship, for anyone not seeing the layout. The visual arrow
         * is decorative; this sentence is the actual statement, and it names
         * both sides so it survives being read out of order.
         */
        role="presentation"
      >
        <span className="sr-only">
          {`${leftSide.label} becomes ${rightSide.label}`}
        </span>
        <ArrowRight size={16} aria-hidden />
      </div>
      <SideHeading side={rightSide} align="left" />
    </div>
  );
}

function SideHeading({
  side,
  align,
}: {
  side: CompareSide;
  align: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "min-w-0 border-b border-border-primary pb-1",
        align === "center" && "text-center",
      )}
    >
      {/*
       * `title`, because a side's label is not always a short word.
       *
       * "Published" and "After publish" fit; a commit message is prose and
       * routinely does not — `ValServer` generates one and `commit-summary`
       * writes them with a model. Truncation keeps the two columns aligned,
       * which matters more than showing the whole string, so the whole string
       * has to be available some other way.
       */}
      <div
        className="truncate text-xs font-semibold uppercase tracking-wider text-fg-secondary"
        title={side.label}
      >
        {side.label}
      </div>
      {/*
       * The byline and the caption on one line.
       *
       * A commit has ONE author, so naming them in the header is the whole
       * attribution for that side — the per-row avatars on the right answer a
       * different question (who staged this particular change) and would be
       * wrong here. "Published" has no byline: it is the accumulation of many
       * commits and no single person made it.
       */}
      {(side.caption !== undefined || side.byline !== undefined) && (
        <div className="truncate text-xs text-fg-tertiary">
          {side.byline !== undefined && (
            <span className="text-fg-secondary">by {side.byline}</span>
          )}
          {side.byline !== undefined && side.caption !== undefined && " · "}
          {side.caption}
        </div>
      )}
    </div>
  );
}

/**
 * The phone form: one pane at a time, with the two sides as tabs.
 *
 * Only the showing side's cells are rendered now, rather than both with one
 * hidden. `HistorySplit` keeps both mounted to preserve scroll position across
 * a toggle; here the rows themselves do not change — only which cell of each
 * row is drawn — so the scroll position is the same list either way and there
 * is nothing to lose.
 *
 * Which side is showing is local state, not URL state. It is a property of the
 * screen you are on rather than of what you are looking at, so a shared link
 * must not force someone else's phone to the other tab.
 */
export function CompareMobileColumns({
  children,
  leftSide,
  rightSide,
  showing,
  onShow,
  toolbar,
}: {
  /** The rows, already narrowed to the showing side by `ComparePaneRows`. */
  children: ReactNode;
  leftSide: CompareSide;
  rightSide: CompareSide;
  showing: "left" | "right";
  onShow: (side: "left" | "right") => void;
  toolbar?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div
        className="flex gap-1 rounded-lg border border-border-primary p-1"
        role="tablist"
        aria-label="Which side to show"
      >
        {(
          [
            ["left", leftSide],
            ["right", rightSide],
          ] as ["left" | "right", CompareSide][]
        ).map(([key, side]) => (
          <button
            key={key}
            role="tab"
            aria-selected={showing === key}
            onClick={() => onShow(key)}
            className={cn(
              "min-w-0 flex-1 rounded px-3 py-1.5 text-left",
              showing === key
                ? "bg-bg-brand-primary text-fg-brand-primary-alt"
                : "text-fg-tertiary",
            )}
          >
            <span
              className="block truncate text-sm font-medium"
              title={side.label}
            >
              {side.label}
            </span>
            {side.caption !== undefined && (
              <span className="block truncate text-xs opacity-80">
                {side.caption}
              </span>
            )}
          </button>
        ))}
      </div>
      {toolbar !== undefined && (
        <div className="flex items-center justify-end gap-2">{toolbar}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
