import { useMemo, useState } from "react";
import { GitCompareArrows, History, Info, Undo2 } from "lucide-react";
import { Button } from "../components/designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
import { Checkbox } from "../components/designSystem/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/designSystem/tooltip";
import { cn } from "../components/designSystem/cn";
import { FieldPatchAuthorsPure } from "../components/FieldPatchAuthors";
import { CompareAuthorFilterMenu } from "../compare/CompareAuthorFilter";
import { undoWords } from "../compare/undoWords";
import type { ReviewModel, ReviewModuleGroup, ReviewRow } from "./types";

/**
 * The words, from the one place that owns them.
 *
 * `undoWords` documents the trap and it applies here too: the mechanic called
 * `discard` is the one an editor reads as **Revert** — dropping a staged patch
 * that never shipped — and `revert` against a commit is what they read as
 * **Restore**. This page shows both, three inches apart, so taking the labels
 * from anywhere else is how they end up saying the same word for the two
 * opposite things.
 */
const STAGED = undoWords("discard");
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
 * - This answers **what is going out** — one line per patch set, whose it is,
 *   and which half of the publish it is in. Nothing is expanded, because a
 *   publish decision is made over the whole list and a list of diffs cannot be
 *   read whole.
 *
 * The diff is one button away rather than absent: `onCompare` opens the compare
 * dialog over the STAGED set, which is the same question this page is asking,
 * answered in detail. There is deliberately no per-row way into it — a publish
 * ships the staged set as a unit, and a per-row dialog would be a one-pane
 * compare whose nav had a single entry in it.
 *
 * ## Two sections, and a checkbox that is not either of them
 *
 * Staged-ness is the SECTION a row sits in; the checkbox is a SELECTION of
 * rows to act on. They were one control at first — a ticked box meant staged —
 * and that cannot carry both meanings at once: "is this going out" and "am I
 * about to change that" have different answers, and a single tick makes each
 * one look like the other. Splitting them also gives the bulk actions somewhere
 * to live, which is what makes staging twelve rows one gesture instead of
 * twelve.
 *
 * A consequence worth stating: acting on a selection MOVES rows between the two
 * sections, so the thing you just ticked jumps. That is correct — the sections
 * are the truth about the publish — and it is why the action bar reports what
 * it did rather than leaving you to find the rows again.
 */
export function ReviewView({
  model,
  initialSelection,
  onCompare,
  onRestore,
  onStage,
  onUnstage,
  onDiscard,
  onDiscardAll,
  discardAllDescription,
  portalContainer = null,
}: {
  model: ReviewModel;
  /** Rows selected on arrival. For stories, and for a future "mine" default. */
  initialSelection?: string[];
  /** Open the compare dialog over what is staged. */
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
  onStage: (rowIds: string[]) => void;
  onUnstage: (rowIds: string[]) => void;
  onDiscard: (rowIds: string[]) => void;
  onDiscardAll: () => void;
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
  const stagedGroups = sectionOf(modules, "staged");
  const unstagedGroups = sectionOf(modules, "unstaged");
  const stagedCount = stagedGroups.reduce(
    (total, group) => total + group.rows.length,
    0,
  );
  const unstagedCount = rows.length - stagedCount;
  const picked = [...selected];

  const toggle = (rowId: string, next: boolean): void =>
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(rowId);
      else out.delete(rowId);
      return out;
    });
  /** Run a bulk action and clear, since the rows it acted on have moved. */
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
          <RevertAll
            count={allRows.length}
            description={discardAllDescription}
            onConfirm={onDiscardAll}
            portalContainer={portalContainer}
          />
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
           *
           * "staged" only where staging exists. Without patch groups there is
           * no staged half to compare — the compare view shows the whole
           * pending chain, which is what this button opens and what it should
           * therefore say. It was "Compare staged changes" in both, which made
           * a button that works perfectly well in fs mode read as one that
           * belongs to a feature fs mode does not have.
           */}
          <Button size="sm" variant="secondary" onClick={onCompare}>
            <GitCompareArrows size={13} aria-hidden />
            {model.stagingEnabled
              ? "Compare staged changes"
              : "Compare changes"}
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
        onStage={() => act(onStage)}
        onUnstage={() => act(onUnstage)}
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
                : `by ${model.profiles[authorFilter ?? ""]?.fullName ?? "this person"}`
            }.`}
          </p>
        ) : (
          <>
            {/*
             * "Staged" / "Unstaged", the same two words the compare dialog's
             * sections use and the same two the buttons in the bar use. This page
             * said "In this publish" and "Held back", which named the same two
             * facts in a third vocabulary — so an editor who pressed Unstage had
             * to work out for themselves that the row would turn up under "Held
             * back". What the two MEAN is behind the info icon — see `Section`.
             */}
            <Section
              title="Staged"
              /*
               * An fs project SAVES. There is nothing outside the editor's own
               * machine to publish to, and the button that finishes the job
               * says "Save" — so "Publish ships these" there names an act the
               * Studio does not offer.
               */
              explanation={
                model.mode === "fs"
                  ? "Save writes these to the files on disk. Everything you edit is staged unless you take it out, and nothing else is written."
                  : "Publish ships these, and only these. A change is staged by default; take one out and it stays pending until somebody stages it again."
              }
              count={stagedCount}
              groups={stagedGroups}
              model={model}
              selected={selected}
              onToggle={toggle}
              onDiscard={(id) => onDiscard([id])}
              emptyNote={
                model.mode === "fs"
                  ? "Nothing to save."
                  : "Nothing staged — Publish has nothing to ship."
              }
              portalContainer={portalContainer}
            />
            {/*
             * The unstaged section exists even when it is empty, because its absence
             * and its emptiness mean the same thing on screen and different things
             * in fact: "everything is going out" is worth reading, and a section
             * that vanishes leaves the reader to infer it from a count.
             */}
            <Section
              title="Unstaged"
              explanation={
                model.mode === "fs"
                  ? "Held out of the next save. They stay pending, and stay yours — nothing writes them until you stage them again."
                  : "Held out of the next publish. They stay pending and can be staged again — by you, or by whoever publishes next, so this is not a way to keep work private."
              }
              count={unstagedCount}
              groups={unstagedGroups}
              model={model}
              selected={selected}
              onToggle={toggle}
              onDiscard={(id) => onDiscard([id])}
              emptyNote="Nothing held back."
              portalContainer={portalContainer}
              muted
            />
          </>
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
  const staged = rows.filter((row) => row.staging !== "unstaged").length;
  const unstaged = rows.length - staged;
  if (unstaged === 0) {
    return `${staged} ${staged === 1 ? "change" : "changes"} staged`;
  }
  return `${staged} staged · ${unstaged} unstaged`;
}

function sectionOf(
  modules: ReviewModuleGroup[],
  which: "staged" | "unstaged",
): ReviewModuleGroup[] {
  return modules
    .map((group) => ({
      ...group,
      // `partial` is in flight towards staged, so it belongs with the staged
      // rows: a row halfway into the publish is in the publish.
      rows: group.rows.filter((row) =>
        which === "unstaged"
          ? row.staging === "unstaged"
          : row.staging !== "unstaged",
      ),
    }))
    .filter((group) => group.rows.length > 0);
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
  onStage,
  onUnstage,
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
  onStage: () => void;
  onUnstage: () => void;
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
        {model.stagingEnabled && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={count === 0}
              onClick={onStage}
            >
              Stage
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={count === 0}
              onClick={onUnstage}
            >
              Unstage
            </Button>
          </>
        )}
        {/*
         * Red, and the only red on the page. Reverting a staged change throws
         * away work that exists nowhere else; Stage and Unstage move a row
         * between two halves of a publish and can be pressed back. A screen
         * that shouts at all three teaches people to ignore the shouting.
         */}
        <Button
          size="sm"
          variant="destructive"
          disabled={count === 0}
          onClick={onDiscard}
        >
          {STAGED.verb}
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
          {STAGED.all}
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="z-[9001] flex w-64 flex-col gap-3"
      >
        <div>
          <p className="text-xs font-semibold text-fg-primary">
            {`${STAGED.all}?`}
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
            {STAGED.all}
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
        Nothing is staged. Changes you make show up here before they publish.
      </p>
    </div>
  );
}

function Section({
  title,
  explanation,
  count,
  groups,
  model,
  selected,
  onToggle,
  onDiscard,
  emptyNote,
  muted = false,
  portalContainer,
}: {
  title: string;
  /**
   * What being in this section MEANS, behind the info icon.
   *
   * On demand rather than under the heading, and the swap is what makes the
   * text worth reading: as a permanent subtitle it had to be short enough not
   * to cost two lines above every list — "Not in this publish." — which is a
   * restatement of the heading rather than an explanation of it. Asked for, it
   * has room to say the thing an editor actually needs: that unstaged work
   * stays pending, and that somebody else publishing will take it.
   */
  explanation: string;
  count: number;
  groups: ReviewModuleGroup[];
  model: ReviewModel;
  selected: ReadonlySet<string>;
  onToggle: (rowId: string, next: boolean) => void;
  onDiscard: (rowId: string) => void;
  emptyNote: string;
  muted?: boolean;
  /** Where the tooltip portals to, inside the shadow root. */
  portalContainer: HTMLElement | null;
}) {
  return (
    <section
      className={cn(
        "mb-10 last:mb-0",
        /*
         * A rule between the two halves, not just two headings.
         *
         * The sections are the truth about the publish — staging a row moves
         * it across this line — so the line has to be visible enough that the
         * move is legible as a move. Two headings alone read as one long list
         * with labels in it.
         */
        muted && "border-t border-border-primary pt-8",
      )}
    >
      <div className="mb-4 flex items-center gap-1.5">
        <h2
          className={cn(
            "text-xs font-semibold uppercase tracking-wider",
            muted ? "text-fg-tertiary" : "text-fg-secondary",
          )}
        >
          {title}
        </h2>
        <span className="text-xs tabular-nums text-fg-tertiary">{count}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={`What ${title.toLowerCase()} means`}
              className="rounded text-fg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <Info size={12} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent container={portalContainer} className="max-w-72">
            <p className="text-xs">{explanation}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-fg-tertiary">{emptyNote}</p>
      ) : (
        groups.map((group) => (
          <ModuleGroup
            key={group.moduleFilePath}
            group={group}
            model={model}
            selected={selected}
            onToggle={onToggle}
            onDiscard={onDiscard}
            muted={muted}
          />
        ))
      )}
    </section>
  );
}

function ModuleGroup({
  group,
  model,
  selected,
  onToggle,
  onDiscard,
  muted,
}: {
  group: ReviewModuleGroup;
  model: ReviewModel;
  selected: ReadonlySet<string>;
  onToggle: (rowId: string, next: boolean) => void;
  onDiscard: (rowId: string) => void;
  muted: boolean;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-2 flex min-w-0 items-baseline gap-2">
        <h3
          className={cn(
            "truncate text-sm font-medium",
            muted ? "text-fg-secondary" : "text-fg-primary",
          )}
        >
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
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  model,
  checked,
  onToggle,
  onDiscard,
}: {
  row: ReviewRow;
  model: ReviewModel;
  checked: boolean;
  onToggle: (next: boolean) => void;
  onDiscard: () => void;
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
        aria-label={`Select ${row.description.title}`}
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
          {row.staging === "partial" && (
            <span className="shrink-0 rounded-full border border-border-primary px-1.5 text-[10px] uppercase tracking-wider text-fg-tertiary">
              Partly staged
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2 text-xs text-fg-tertiary">
          <span className="truncate">{row.summary}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {row.patchCount} {row.patchCount === 1 ? "edit" : "edits"}
          </span>
        </div>
        {row.alsoStages !== undefined && row.alsoStages.length > 0 && (
          /*
           * Said on the row rather than at confirm time, because it changes
           * whether you stage it at all. A later patch set cannot publish
           * without its predecessors — the prefix invariant — so including this
           * row includes somebody else's work, and the names are the part that
           * makes that a decision rather than a surprise.
           */
          <p className="mt-0.5 truncate text-xs text-fg-warning-primary">
            {`Staging this also publishes work by ${row.alsoStages.join(", ")}`}
          </p>
        )}
      </div>
      <span className="shrink-0">
        <FieldPatchAuthorsPure
          patchesByAuthorIds={row.authors}
          profilesByAuthorIds={model.profiles}
          now={model.now}
          portalContainer={null}
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
        aria-label={`${STAGED.verb} ${row.description.title}`}
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
