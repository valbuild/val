import { useMemo, useState } from "react";
import { GitCompareArrows, History, Undo2 } from "lucide-react";
import { Button } from "../components/designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
import { Checkbox } from "../components/designSystem/checkbox";
import { cn } from "../components/designSystem/cn";
import { FieldPatchAuthorsPure } from "../components/FieldPatchAuthors";
import { CompareAuthorFilterMenu } from "../compare/CompareAuthorFilter";
import { undoWords } from "../compare/undoWords";
import { UNKNOWN_AUTHOR } from "../utils/computeChangedSourcePaths";
import type { ReviewModel, ReviewModuleGroup, ReviewRow } from "./types";

/**
 * The words, from the one place that owns them.
 *
 * `undoWords` documents the trap and it applies here too: the mechanic called
 * `discard` is the one an editor reads as **Revert** — dropping a pending patch
 * that never shipped — and `revert` against a commit is what they read as
 * **Restore**. This page shows both, three inches apart, so taking the labels
 * from anywhere else is how they end up saying the same word for the two
 * opposite things.
 */
const PENDING = undoWords("discard");
const COMMITTED = undoWords("revert");

/**
 * What is about to be published, as a list of the things that will go.
 *
 * This is NOT the compare view with the diffs taken out. The two answer
 * different questions and that is why both exist:
 *
 * - `ComparePatchSets` (`/val/compare`) answers **what changed** — every patch
 *   set expanded into its before and after, which is the right shape when you
 *   are checking a value.
 * - This answers **what is going out** — one line per patch set, and whose it
 *   is. Nothing is expanded, because a publish decision is made over the whole
 *   list and a list of diffs cannot be read whole.
 *
 * The diff is one button away rather than absent: `onCompare` opens the compare
 * dialog over the pending set, which is the same question this page is asking,
 * answered in detail. There is deliberately no per-row way into it — a publish
 * ships the pending set as a unit, and a per-row dialog would be a one-pane
 * compare whose nav had a single entry in it.
 *
 * ## The checkbox is a selection
 *
 * The checkbox picks rows to act on — today Revert, which is why the bar
 * beside it exists. It says nothing about whether a row is going out: every
 * row on this page is, with the next publish.
 */
export function ReviewView({
  model,
  initialSelection,
  onCompare,
  onRestore,
  onDiscard,
  onDiscardAll,
  discardAllDescription,
  portalContainer = null,
}: {
  model: ReviewModel;
  /** Rows selected on arrival. For stories, and for a future "mine" default. */
  initialSelection?: string[];
  /** Open the compare dialog over what is pending. */
  onCompare: () => void;
  /**
   * Go to the history page, to bring back a value that was published.
   *
   * OPTIONAL, and absent hides the button entirely rather than disabling it.
   * There is no published history in fs mode — the content host is a directory
   * and `ValOpsFS` answers `not-supported-in-fs-mode` — so the button would
   * lead to a page whose only content is an apology. Same rule, and the same
   * reason, as `historyEnabled` on the top bar.
   */
  onRestore?: () => void;
  onDiscard: (rowIds: string[]) => void;
  /**
   * Revert everything pending.
   *
   * OPTIONAL, and absent hides the control rather than disabling it — the same
   * rule {@link onRestore} follows. Not every row on this page can be taken
   * back: a patch that is already in a commit is history, so a publish can
   * leave a list where the button would confirm, run, and do nothing. A
   * destructive control that no-ops is worse than one that is not offered,
   * because the reader is left believing the work is gone.
   */
  onDiscardAll?: () => void;
  /**
   * What reverting everything would lose, phrased by `discardAllDescription`.
   *
   * Absent means no confirm — which is the right shape for a story and the
   * wrong one for a project, so the caller that has the numbers is the caller
   * that turns it on.
   */
  discardAllDescription?: string;
  /** Where popups portal to, inside the shadow root. See `ValPortalProvider`. */
  portalContainer?: HTMLElement | null;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSelection ?? []),
  );
  /*
   * Whose changes are on screen. Null is everyone's.
   *
   * A FILTER, not a selection: it decides what the page shows, and the
   * checkboxes then decide what an action reaches. Those were one control —
   * a row of per-author chips that ticked that person's rows — and it meant
   * pressing "Linus Pauling" silently selected rows you could not see without
   * scrolling past everyone else's. Narrowing first and selecting second is
   * both the safer order and the one every other list in the Studio uses.
   */
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const allRows = useMemo(
    () => model.modules.flatMap((group) => group.rows),
    [model.modules],
  );
  const authorIds = useMemo(() => {
    const seen: string[] = [];
    for (const row of allRows) {
      for (const id of Object.keys(row.authors)) {
        if (!seen.includes(id)) seen.push(id);
      }
    }
    return seen;
  }, [allRows]);
  const modules = useMemo(
    () => filterByAuthor(model.modules, authorFilter),
    [model.modules, authorFilter],
  );
  const rows = useMemo(() => modules.flatMap((group) => group.rows), [modules]);
  const picked = [...selected];

  const toggle = (rowId: string, next: boolean): void =>
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(rowId);
      else out.delete(rowId);
      return out;
    });
  /** Run a bulk action and clear, since the rows it acted on are gone. */
  const act = (run: (ids: string[]) => void): void => {
    run(picked);
    setSelected(new Set());
  };

  if (allRows.length === 0) {
    return <EmptyReview />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border-primary px-6 py-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium text-fg-primary">
            Review changes
          </h1>
          {/*
           * The whole publish, never the filtered view. A filter narrows what
           * you are reading; it does not change what Publish would ship, and a
           * heading that moved when you picked a colleague would say the
           * opposite.
           */}
          <p className="truncate text-sm text-fg-tertiary">
            {publishSummary(allRows)}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {onDiscardAll !== undefined && (
            <RevertAll
              count={allRows.length}
              description={discardAllDescription}
              onConfirm={onDiscardAll}
              portalContainer={portalContainer}
            />
          )}
          {/*
           * Restore is here because this is the page you are on when you find
           * out something is wrong, and the fix is as often "put back what was
           * there last week" as "drop what I just did". Those are different
           * mechanics — one writes a new change, the other throws one away —
           * and having only the second on screen made a published mistake look
           * unfixable from the screen that showed it to you.
           *
           * It opens the history page rather than a panel over this one: a
           * restore is reviewed, sometimes by somebody else, and a link is what
           * makes that possible. See `VAL_HISTORY_ROUTE`.
           *
           * Gone entirely where there is no published history, rather than
           * disabled: local dev has git, not a commit archive.
           */}
          {onRestore !== undefined && (
            <Button size="sm" variant="secondary" onClick={onRestore}>
              <History size={13} aria-hidden />
              {COMMITTED.shortMode} from history
            </Button>
          )}
          {/*
           * `secondary`, not the accent: the primary action here is Publish,
           * which the shell owns, and a second filled button beside it would
           * compete with the thing this page exists to lead to.
           */}
          <Button size="sm" variant="secondary" onClick={onCompare}>
            <GitCompareArrows size={13} aria-hidden />
            Compare changes
          </Button>
        </div>
      </header>

      <SelectionBar
        model={model}
        rows={rows}
        authorIds={authorIds}
        authorFilter={authorFilter}
        onAuthorFilter={(next) => {
          setAuthorFilter(next);
          /*
           * Narrowing clears the selection. A tick you can no longer see is a
           * row an action would still reach, and "Revert" acting on something
           * off screen is the one outcome this page must never produce.
           */
          setSelected(new Set());
        }}
        selected={selected}
        onSelect={setSelected}
        onDiscard={() => act(onDiscard)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {/*
         * A filter that matched nothing is not an empty publish, and saying
         * "changes show up here" to someone looking at a colleague's empty
         * list would be answering a question they did not ask.
         */}
        {rows.length === 0 ? (
          <p className="text-sm text-fg-tertiary">
            {`Nothing in this publish is ${
              authorFilter === model.currentAuthorId
                ? "yours"
                : `by ${
                    model.profiles[authorFilter ?? ""]?.fullName ??
                    (authorFilter === UNKNOWN_AUTHOR
                      ? model.mode === "fs"
                        ? "anyone but you"
                        : "an unknown author"
                      : "this person")
                  }`
            }.`}
          </p>
        ) : (
          modules.map((group) => (
            <ModuleGroup
              key={group.id}
              group={group}
              model={model}
              selected={selected}
              onToggle={toggle}
              onDiscard={(id) => onDiscard([id])}
              portalContainer={portalContainer}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Only the rows this person touched, dropping modules left with none.
 *
 * A row with several authors survives a filter on any one of them: it IS
 * partly theirs, and hiding a shared row from the person who half-wrote it is
 * how somebody publishes a change they were never shown.
 */
function filterByAuthor(
  modules: ReviewModuleGroup[],
  authorId: string | null,
): ReviewModuleGroup[] {
  if (authorId === null) return modules;
  return modules
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => authorId in row.authors),
    }))
    .filter((group) => group.rows.length > 0);
}

/** What this publish is, in one line — the whole of it, filter or no. */
function publishSummary(rows: ReviewRow[]): string {
  return `${rows.length} ${rows.length === 1 ? "change" : "changes"}`;
}

/**
 * Who is on screen, who is picked, and what to do to them — in that order.
 *
 * The order is the design. The filter narrows the LIST; the tick boxes pick
 * from what the list is showing; the buttons act on the ticks. Before this the
 * first two were one control — a chip per author that ticked that person's
 * rows — so pressing a name selected rows that were not on screen, and the
 * count said "4 selected" over a list of nine you had to scroll to audit.
 *
 * Always on screen rather than appearing with the first tick: a bar that
 * arrives on selection moves every row under the cursor at the exact moment
 * someone is aiming at a checkbox.
 */
function SelectionBar({
  model,
  rows,
  authorIds,
  authorFilter,
  onAuthorFilter,
  selected,
  onSelect,
  onDiscard,
}: {
  model: ReviewModel;
  /** The rows the filter is letting through — what "Select all" means. */
  rows: ReviewRow[];
  /** Everyone in the publish, so the menu does not shrink as you use it. */
  authorIds: string[];
  authorFilter: string | null;
  onAuthorFilter: (next: string | null) => void;
  selected: ReadonlySet<string>;
  onSelect: (next: ReadonlySet<string>) => void;
  onDiscard: () => void;
}) {
  const count = selected.size;
  const allShown = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-primary px-6 py-3">
      {/*
       * The compare dialog's own filter, not one of this page's. Same menu,
       * same avatars, same "(you)" — and one place to change when the way we
       * pick a person changes. It hides itself when one person did everything.
       */}
      <CompareAuthorFilterMenu
        profiles={model.profiles}
        authorIds={authorIds}
        selected={authorFilter}
        onSelect={onAuthorFilter}
        currentAuthorId={model.currentAuthorId}
        mode={model.mode}
        className="w-[200px]"
      />
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={() =>
            onSelect(allShown ? new Set() : new Set(rows.map((r) => r.id)))
          }
          className="text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
        >
          {/*
           * One control, because "select all" and "clear" are never both
           * useful at once, and the label says which one you are about to get.
           * "Showing" rather than "all" when a filter is on: it reaches what
           * is on screen, and saying "all" over a narrowed list would be a
           * lie about the one thing this bar must not lie about.
           */}
          {allShown
            ? "Clear selection"
            : authorFilter === null
              ? "Select all"
              : "Select all showing"}
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "text-xs",
            count === 0 ? "text-fg-tertiary" : "text-fg-primary",
          )}
        >
          {count === 0 ? "Nothing selected" : `${count} selected`}
        </span>
        {/*
         * Red, and the only red on the page: reverting a pending change throws
         * away work that exists nowhere else.
         */}
        <Button
          size="sm"
          variant="destructive"
          disabled={count === 0}
          onClick={onDiscard}
        >
          {PENDING.verb}
        </Button>
      </div>
    </div>
  );
}

/**
 * Reverting everything, behind a confirm.
 *
 * The one control on this page that can undo an afternoon in a click, and the
 * only one whose consequence cannot be read off the row it is on — so it says
 * what goes, including whose work is in it, BEFORE the click rather than in a
 * toast after it. Same popover the utility panel's version uses, for the same
 * reason: a dialog for this would take the list off screen at the moment
 * someone is deciding about it.
 */
function RevertAll({
  count,
  description,
  onConfirm,
  portalContainer,
}: {
  count: number;
  description?: string;
  onConfirm: () => void;
  portalContainer: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-sm text-fg-secondary underline underline-offset-2 hover:text-fg-primary">
          {PENDING.all}
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="z-[9001] flex w-64 flex-col gap-3"
      >
        <div>
          <p className="text-xs font-semibold text-fg-primary">
            {`${PENDING.all}?`}
          </p>
          <p className="mt-1 text-xs text-fg-secondary">
            {description ??
              `${count} ${count === 1 ? "change goes" : "changes go"} away. This cannot be undone.`}
          </p>
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
            {PENDING.all}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmptyReview() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16">
      <p className="text-sm text-fg-tertiary">
        Nothing is pending. Changes you make show up here before they publish.
      </p>
    </div>
  );
}

function ModuleGroup({
  group,
  model,
  selected,
  onToggle,
  onDiscard,
  portalContainer,
}: {
  group: ReviewModuleGroup;
  model: ReviewModel;
  selected: ReadonlySet<string>;
  onToggle: (rowId: string, next: boolean) => void;
  onDiscard: (rowId: string) => void;
  portalContainer: HTMLElement | null;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-2 flex min-w-0 items-baseline gap-2">
        <h3 className="truncate text-sm font-medium text-fg-primary">
          {group.description.title}
        </h3>
        {/*
         * WHERE it is, beside what it is called — and never the file path.
         *
         * The name can be a preview, which moves as an editor types, so
         * something has to tell two modules called `Page` apart. That used to
         * be `/app/blogs/[blog]/page.val.ts` in a monospace font, which names
         * a file an editor has no checkout of and cannot open. The folders say
         * the same thing in words they can read: `App / Blogs / Blog`.
         *
         * Dropped when it would only repeat the name. A page nobody previewed
         * is CALLED its route, and its location is that same route — printing
         * both gave `/blogs/blog1  /blogs/blog1`, which spends the line on
         * nothing and reads as though the two were different.
         */}
        {group.location !== null &&
          group.location !== group.description.title && (
            <span className="truncate text-xs text-fg-tertiary">
              {group.location}
            </span>
          )}
      </div>
      <div className="rounded-lg border border-border-secondary">
        {group.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            model={model}
            checked={selected.has(row.id)}
            onToggle={(next) => onToggle(row.id, next)}
            onDiscard={() => onDiscard(row.id)}
            portalContainer={portalContainer}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * What a screen reader reads out for a row's checkbox.
 *
 * The visible row says the name and the trail side by side, and needs both:
 * a preview names the thing, and the trail says which of several like it this
 * is. The accessible name is the same sentence, so the two cannot disagree —
 * the label used to carry the title alone, and `items/0/title` and
 * `items/1/title` were then announced identically.
 *
 * The trail is joined with "in" rather than the visible "\u203a": read aloud, a
 * chevron is either silence or the word "chevron", and neither says that the
 * left side contains the right one. Deepest first for the same reason the
 * visible row is not — what this row IS matters more than where it lives, and
 * a listener cannot skim back to the end of the line.
 */
export function accessibleRowName(row: ReviewRow): string {
  if (row.trail.length === 0) {
    // The module itself, which is what the visible row says here too.
    return `Select ${row.description.title}, the whole module`;
  }
  const trail = [...row.trail].reverse().join(" in ");
  // A row whose title came from a preview is named twice otherwise: the
  // preview of `items/0` is already "Kim Midtlid", and so is the last trail
  // segment for a record keyed by it.
  if (row.trail[row.trail.length - 1] === row.description.title) {
    return `Select ${trail}`;
  }
  return `Select ${row.description.title}, ${trail}`;
}

function Row({
  row,
  model,
  checked,
  onToggle,
  onDiscard,
  portalContainer,
}: {
  row: ReviewRow;
  model: ReviewModel;
  checked: boolean;
  onToggle: (next: boolean) => void;
  onDiscard: () => void;
  /** Where the author popover portals to, inside the shadow root. */
  portalContainer: HTMLElement | null;
}) {
  const named = row.description.origin.title === "preview";
  return (
    <div
      className={cn(
        "group/row flex min-w-0 items-center gap-3 border-b border-border-secondary px-4 py-3 last:border-b-0",
        checked && "bg-bg-secondary",
      )}
    >
      {/*
       * The design system's checkbox, not a bare `<input type="checkbox">`.
       *
       * A native checkbox is painted by the browser from `color-scheme`, which
       * nothing sets here — Val's dark mode is `[data-mode="dark"]` on a shadow
       * root, and the UA has no way to know. So in the dark theme the UNCHECKED
       * box came out as a solid white square: indistinguishable from a ticked
       * one, on the control this whole page turns on. `accent-color` does not
       * save it, because it only recolours the checked fill.
       *
       * The themed one is also the only one that can be themed at all — the
       * brand fill is `--bg-brand-primary` and projects change it — and it is
       * where `indeterminate` lives, which is a DOM property with no HTML
       * attribute and therefore not something to re-implement per surface.
       */}
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onToggle(next === true)}
        /*
         * The trail as well as the title, because the title alone does not
         * tell two rows apart — which is the same thing the trail is drawn
         * for, three lines below. Two `title` fields in one array are both
         * called `title`, so a screen reader read out a column of "Select
         * title" and the one control this page turns on became unusable
         * exactly where the list is longest.
         */
        aria-label={accessibleRowName(row)}
        className="shrink-0 cursor-pointer"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {named && (
            <span className="min-w-0 max-w-[45%] shrink truncate text-sm text-fg-primary">
              {row.description.title}
            </span>
          )}
          {/*
           * The trail, always — demoted when a name is beside it. It is what
           * tells two rows in one module apart, and for a page it is the URL,
           * which is the page's identity rather than a nicer name for it.
           */}
          <span
            className={cn(
              "min-w-0 truncate font-mono text-xs",
              named ? "text-fg-tertiary" : "text-fg-primary",
            )}
          >
            {row.trail.length === 0
              ? "the whole module"
              : row.trail.join(" › ")}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2 text-xs text-fg-tertiary">
          <span className="truncate">{row.summary}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {row.patchCount} {row.patchCount === 1 ? "edit" : "edits"}
          </span>
        </div>
      </div>
      <span className="shrink-0">
        <FieldPatchAuthorsPure
          patchesByAuthorIds={row.authors}
          profilesByAuthorIds={model.profiles}
          now={model.now}
          /*
           * Into the shadow root, not `document.body`.
           *
           * This was `null`, which is Radix's default: portal to the body —
           * OUTSIDE the shadow root the Studio lives in, where `index.css` is
           * not. The avatars rendered fine and the popover behind them opened
           * into an unstyled void, so the one place an author's full NAME is
           * written out was invisible. Caught by `attribution.spec.ts`, which
           * asserts exactly that name inside `#val-shadow-root`.
           */
          portalContainer={portalContainer}
          mode={model.mode}
        />
      </span>
      {/*
       * On hover, now that it is a shortcut rather than the only way.
       *
       * It was always visible while the row's own control was the single route
       * to reverting one thing. The selection bar is that route now — tick and
       * press Revert — so the per-row button can go quiet and give the row back
       * its air.
       *
       * An undo arrow rather than a bin, for the reason `undoWords` gives: the
       * promise is "put this back the way it was", and a bin says the work is
       * being thrown in one.
       */}
      <button
        onClick={onDiscard}
        aria-label={`${PENDING.verb} ${row.description.title}`}
        className={cn(
          "shrink-0 rounded p-1 text-fg-tertiary transition-opacity",
          "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          "hover:bg-bg-primary hover:text-fg-error-primary",
        )}
      >
        <Undo2 size={13} aria-hidden />
      </button>
    </div>
  );
}
