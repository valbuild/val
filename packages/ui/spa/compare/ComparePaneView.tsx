import type { ReactNode } from "react";
import { cn } from "../components/designSystem/cn";
import {
  ChangeKindIcon,
  changeKindLabel,
  segmentClass,
  sideRailClass,
} from "./ChangeKindIcon";
import { FieldPatchAuthorsPure } from "../components/FieldPatchAuthors";
import { RowQuickUndo, UndoBlocked } from "./CompareUndoBar";
import { canUndo } from "./undoSelection";
import { isWorthDiffing, valueDiff, type DiffSegment } from "./wordDiff";
import { passesAuthorFilter, useCompareAuthors } from "./CompareAuthorsContext";
import type {
  CompareAuthorship,
  CompareFieldRow,
  CompareUndo,
  CompareGroup,
  CompareListItemRow,
  CompareMove,
  ComparePane,
} from "./types";

/**
 * One selected thing, as a list of rows with two cells each.
 *
 * The label spans BOTH columns and is drawn once. That is the whole layout, and
 * it is a change from the previous shape, where each column was rendered by its
 * own call and therefore repeated every label, every change icon and every
 * badge. Two independent grids had to be kept in step row for row, which is why
 * an added field needed an empty placeholder of matching height on the left —
 * without one, everything below it rode up and the two columns stopped
 * describing the same rows.
 *
 * Payload's compare view puts the field name once, full width, above the pair.
 * Nothing then has to be kept in step, because the two cells are in the same
 * grid row by construction. The placeholder that remains (see `AbsentValue`)
 * survives for the OTHER reason it existed: "did not exist" and "removed" are
 * statements, and a blank cell would be indistinguishable from a value that is
 * an empty string.
 *
 * It also gives the row's chrome one home. The undo action and the avatars used
 * to be drawn in the right column only — the one place they belong — which put
 * them in the middle of the screen. In the spanning head they sit at its end.
 *
 * `showing` is what the phone layout narrows: the same rows, one cell each.
 */
export function ComparePaneRows({
  pane,
  showUnchanged,
  showing,
}: {
  pane: ComparePane;
  showUnchanged: boolean;
  /** `"both"` on a wide screen; one side at a time on a phone. */
  showing: CompareShowing;
}) {
  return (
    <div className="min-w-0">
      {pane.groups.map((group) => (
        <Group
          key={group.id}
          group={group}
          showUnchanged={showUnchanged}
          showing={showing}
        />
      ))}
      {pane.groups.length === 0 && (
        <p className="px-1 py-6 text-sm text-fg-tertiary">
          Nothing changed in this module.
        </p>
      )}
    </div>
  );
}

export type CompareShowing = "both" | "before" | "after";

/**
 * The two cells of one row, in one grid.
 *
 * The template matches `CompareColumns`' sticky headers exactly — the middle
 * `auto` track is the arrow gutter — which is what makes the headers sit over
 * the columns they name. Collapsing to a single cell when `showing` narrows is
 * the entire phone layout.
 */
function Cells({
  showing,
  before,
  after,
}: {
  showing: CompareShowing;
  before: ReactNode;
  after: ReactNode;
}) {
  if (showing !== "both") {
    return (
      <div className="min-w-0">{showing === "before" ? before : after}</div>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3">
      <div className="min-w-0">{before}</div>
      <div className="w-4" aria-hidden />
      <div className="min-w-0">{after}</div>
    </div>
  );
}

function Group({
  group,
  showUnchanged,
  showing,
}: {
  group: CompareGroup;
  showUnchanged: boolean;
  showing: CompareShowing;
}) {
  const ctx = useCompareAuthors();
  const authorFilter = ctx?.authorFilter ?? null;
  if (group.kind === "fields") {
    const rows = visibleFieldRows(group.rows, showUnchanged, authorFilter);
    if (rows.length === 0) {
      return null;
    }
    return (
      <section className="mb-4">
        {group.title !== undefined && <GroupHeading title={group.title} />}
        {rows.map((row) => (
          <FieldRow key={row.id} row={row} showing={showing} />
        ))}
      </section>
    );
  }
  const items = group.rows.filter((row) =>
    passesAuthorFilter(row.authors, authorFilter),
  );
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="mb-4">
      <GroupHeading title={group.title} summary={group.summary} />
      {items.map((row) => (
        <ListItemRow
          key={row.id}
          row={row}
          showUnchanged={showUnchanged}
          showing={showing}
        />
      ))}
    </section>
  );
}

/** A heading over a group of rows, spanning both columns like the rows do. */
function GroupHeading({ title, summary }: { title: string; summary?: string }) {
  return (
    <div className="mb-1 flex min-w-0 items-center gap-2 border-b border-border-secondary pb-1">
      <span className="truncate text-sm font-medium text-fg-primary">
        {title}
      </span>
      {summary !== undefined && (
        <span className="truncate text-xs text-fg-tertiary">{summary}</span>
      )}
    </div>
  );
}

function visibleFieldRows(
  rows: CompareFieldRow[],
  showUnchanged: boolean,
  authorFilter: string | null,
): CompareFieldRow[] {
  return rows.filter(
    (row) =>
      (showUnchanged || row.change !== "unchanged") &&
      passesAuthorFilter(row.authors, authorFilter),
  );
}

/**
 * Why this row cannot be reverted, at the end of the head.
 *
 * Only in undo mode: outside it there is no control being explained, and a
 * standing "cannot revert" on a row nobody asked to revert is noise.
 */
function RowUndoReason({ undo }: { undo: CompareUndo | undefined }) {
  const ctx = useCompareAuthors();
  if (ctx?.undo == null || undo === undefined || canUndo(undo)) {
    return null;
  }
  return (
    <UndoBlocked reason={undo.kind === "revert" ? undo.reason : undefined} />
  );
}

/**
 * The hover action a row grows in undo mode, at the END of the head.
 *
 * At the end rather than the start because the two are reached for at different
 * moments: a checkbox is scanned down a column while deciding, and an action is
 * reached for after the row has already been read. Google Docs and Sanity both
 * put it after the content for the same reason.
 */
function RowQuickUndoControl({
  rowId,
  undo,
}: {
  rowId: string;
  undo: CompareUndo | undefined;
}) {
  const ctx = useCompareAuthors();
  if (ctx?.undo == null || undo === undefined || !canUndo(undo)) {
    return null;
  }
  return (
    <RowQuickUndo
      kind={ctx.undo.kind}
      tone={ctx.undo.tone}
      consequence={ctx.undo.consequenceOf(rowId)}
      profiles={ctx.profiles}
      onConfirm={() => ctx.undo?.onQuickUndo(rowId)}
      portalContainer={ctx.portalContainer}
    />
  );
}

/**
 * The avatar stack for one row, in the head.
 *
 * It used to be drawn in the right column only — attribution is about the
 * staged side, and the left column is published content nobody is currently
 * editing. With one spanning head there is no column to choose, and the claim
 * it makes is unchanged: these are the people who staged this change.
 */
function RowAuthors({ authors }: { authors: CompareAuthorship | undefined }) {
  const ctx = useCompareAuthors();
  if (authors === undefined || ctx === null) {
    return null;
  }
  /*
   * On hover, always.
   *
   * Google Docs shows the author of a suggestion on hover rather than beside
   * every one of them, and the reason it can is that authorship there is
   * curiosity rather than consequence. The one moment it IS consequence here —
   * undoing a change that drags a colleague's later work with it — is carried
   * by the confirmation instead, which names them before the click. See
   * `RowQuickUndo`.
   *
   * `opacity` rather than mounting on hover, so the avatars do not change the
   * row's width as the cursor crosses it: a row that reflows under the pointer
   * is how you mis-click the row below.
   */
  return (
    <span className="opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
      <FieldPatchAuthorsPure
        patchesByAuthorIds={authors}
        profilesByAuthorIds={ctx.profiles}
        now={ctx.now}
        portalContainer={ctx.portalContainer}
        mode={ctx.mode}
      />
    </span>
  );
}

/**
 * How many rows the "show all" toggle would reveal.
 *
 * Author-filtered rows are NOT counted. The toggle's label promises what
 * clicking it will show, and counting rows the filter is going to drop anyway
 * would make it promise more than it delivers.
 */
export function hiddenFieldCount(
  pane: ComparePane,
  authorFilter: string | null = null,
): number {
  let count = 0;
  const hidden = (rows: CompareFieldRow[]): number =>
    rows.filter(
      (row) =>
        row.change === "unchanged" &&
        passesAuthorFilter(row.authors, authorFilter),
    ).length;
  for (const group of pane.groups) {
    if (group.kind === "fields") {
      count += hidden(group.rows);
    } else {
      for (const item of group.rows) {
        if (passesAuthorFilter(item.authors, authorFilter)) {
          count += hidden(item.fields ?? []);
        }
      }
    }
  }
  return count;
}

function FieldRow({
  row,
  showing,
  indent = false,
}: {
  row: CompareFieldRow;
  showing: CompareShowing;
  indent?: boolean;
}) {
  /*
   * An unchanged row is the same value twice, and drawing it with rails on both
   * sides would make it look like something happened. It gets no rail and a
   * dimmed value, so the eye skips it — which is the whole reason it is allowed
   * on screen at all.
   */
  const isUnchanged = row.change === "unchanged";
  const segments = diffableSegments(row);
  const cell = (side: "before" | "after"): ReactNode => {
    const value = side === "before" ? row.before : row.after;
    if (value === undefined) {
      return <AbsentValue side={side} change={row.change} />;
    }
    return (
      <div
        className={cn(
          "mt-0.5 min-w-0 py-0.5 pl-2 text-sm",
          isUnchanged ? "text-fg-tertiary" : sideRailClass(side),
        )}
      >
        {segments === null ? (
          value
        ) : (
          <DiffedText segments={segments} side={side} />
        )}
      </div>
    );
  };
  return (
    <div className={cn("group/row py-1", indent && "pl-3")}>
      <div className="flex min-w-0 items-center gap-1.5">
        <ChangeKindIcon kind={row.change} size={12} hideLabel />
        <span className="min-w-0 truncate text-xs text-fg-secondary">
          {row.label}
        </span>
        {row.path !== undefined && (
          <span className="min-w-0 truncate text-xs text-fg-tertiary">
            {row.path}
          </span>
        )}
        {/*
         * Pushed to the end of the head rather than placed after the label: a
         * label's length varies per row, and controls that started at a
         * different x on every line would read as noise rather than as a column
         * you can scan down.
         */}
        <RowUndoReason undo={row.undo} />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <RowQuickUndoControl rowId={row.id} undo={row.undo} />
          <RowAuthors authors={row.authors} />
        </span>
      </div>
      <Cells showing={showing} before={cell("before")} after={cell("after")} />
    </div>
  );
}

/**
 * The word diff for a row, or null when there is nothing to highlight.
 *
 * Only when BOTH values are plain strings. `ReactNode` already admits strings,
 * so a field whose value is text says so by being text — a rendered cell (an
 * image, a colour swatch, a rich text tree) is an element and is passed through
 * untouched. That is why this needed no change to `CompareFieldRow`.
 */
function diffableSegments(row: CompareFieldRow): DiffSegment[] | null {
  if (row.change !== "changed") return null;
  if (typeof row.before !== "string" || typeof row.after !== "string") {
    return null;
  }
  const segments = valueDiff(row.before, row.after);
  return isWorthDiffing(segments) ? segments : null;
}

/**
 * One side of a diffed value: the shared text, plus this side's own changes.
 *
 * Each cell drops the segments belonging to the other side, so the two together
 * still show exactly the two stored values — `wordDiff.test.ts` pins that.
 */
function DiffedText({
  segments,
  side,
}: {
  segments: DiffSegment[];
  side: "before" | "after";
}) {
  const drop = side === "before" ? "added" : "removed";
  return (
    <span className="break-words">
      {segments
        .filter((segment) => segment.kind !== drop)
        .map((segment, index) => (
          <span
            key={index}
            className={cn("rounded-sm", segmentClass(segment.kind))}
          >
            {segment.text}
          </span>
        ))}
    </span>
  );
}

/**
 * The hole where a value would be, on the side that never had one.
 *
 * Not blank: a blank cell is indistinguishable from a value that is an empty
 * string, which is a real and different thing. The dash says "there was nothing
 * here", and the sentence says which nothing it is.
 */
function AbsentValue({
  side,
  change,
}: {
  side: "before" | "after";
  change: CompareFieldRow["change"];
}) {
  const what =
    change === "added"
      ? side === "before"
        ? "Did not exist"
        : null
      : change === "removed"
        ? side === "after"
          ? "Removed"
          : null
        : "—";
  return (
    <div className="mt-0.5 min-w-0 border-l-2 border-l-border-secondary py-0.5 pl-2 text-sm italic text-fg-tertiary">
      {what ?? "—"}
    </div>
  );
}

/**
 * One entry of a record or array.
 *
 * Added and removed entries are one line — a key and a preview — because that
 * is the whole statement, and opening them into a field-by-field diff against
 * nothing would be noise. Only a `changed` entry expands, and then only to the
 * fields inside it that actually differ.
 *
 * The key is now stated ONCE, in the head. For a rename that means `from → to`
 * on one line rather than a different key in each column plus a separate line
 * repeating both — which is what the spanning layout buys here, and it is the
 * row an editor scans a publish for.
 *
 * This is also where Payload gets it wrong, which is worth recording because
 * the cost is invisible: it diffs arrays BY INDEX. Remove the first of three
 * authors and it reports every remaining author as renamed, character by
 * character, and the actual change — one removed, one added, one edited — does
 * not appear anywhere. Everything here keys off `change` and `move` from
 * `computeChangedSourcePaths` instead, which is what that machinery is for.
 */
function ListItemRow({
  row,
  showUnchanged,
  showing,
}: {
  row: CompareListItemRow;
  showUnchanged: boolean;
  showing: CompareShowing;
}) {
  const ctx = useCompareAuthors();
  const fields = visibleFieldRows(
    row.fields ?? [],
    showUnchanged,
    ctx?.authorFilter ?? null,
  );
  const rename = row.change === "moved" && row.move?.kind === "rename";
  const cell = (side: "before" | "after"): ReactNode => {
    const present =
      row.change === "added"
        ? side === "after"
        : row.change === "removed"
          ? side === "before"
          : true;
    if (row.preview === undefined) return null;
    if (!present) {
      return (
        <div
          className="mt-1 min-w-0 border-l-2 border-l-border-secondary py-0.5 pl-2 text-sm italic text-fg-tertiary"
          aria-hidden
        >
          {row.change === "added" ? "Did not exist" : "Removed"}
        </div>
      );
    }
    return (
      <div
        className={cn(
          "mt-1 min-w-0 py-0.5 pl-2 text-sm",
          /*
           * A moved entry gets a NEUTRAL rail, not a red one and a blue one.
           * Its value is the same on both sides — only its position changed —
           * and the before/after rails would claim an edit that did not happen.
           * The badge on the head is the change.
           */
          row.change === "moved"
            ? "border-l-2 border-l-border-secondary"
            : sideRailClass(side),
        )}
      >
        {row.preview}
      </div>
    );
  };

  return (
    <div className="group/row border-b border-border-secondary py-1.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <ChangeKindIcon kind={row.change} size={12} hideLabel />
        {rename && row.move?.kind === "rename" ? (
          /*
           * Both keys on the head line, in order.
           *
           * For a router record the key is the URL, so this is a page changing
           * address — the line most likely to break links. A badge reading
           * "RENAMED" would say that something happened without saying what,
           * and the two keys are the whole content of the change.
           */
          <span className="flex min-w-0 items-center gap-1 font-mono text-xs">
            <span className="min-w-0 truncate text-fg-tertiary line-through decoration-rose-500/60">
              {row.move.from}
            </span>
            <span className="shrink-0 text-fg-tertiary" aria-hidden>
              →
            </span>
            <span className="min-w-0 truncate text-fg-primary">
              {row.move.to}
            </span>
          </span>
        ) : (
          <span className="min-w-0 truncate font-mono text-xs text-fg-primary">
            {row.label}
          </span>
        )}
        {/*
         * Beside the key, not at the end of the head.
         *
         * The head spans both columns now, so "pushed to the end" put the badge
         * a thousand pixels from the key it describes on a wide screen. The
         * controls keep the end — they are reached for rather than read, so
         * distance costs them nothing and a fixed column is what makes them
         * scannable.
         */}
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-tertiary">
          {row.change === "moved"
            ? moveBadge(row.move)
            : changeKindLabel(row.change)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <RowQuickUndoControl rowId={row.id} undo={row.undo} />
          <RowAuthors authors={row.authors} />
        </span>
      </div>
      {row.preview !== undefined && (
        <Cells
          showing={showing}
          before={cell("before")}
          after={cell("after")}
        />
      )}
      {fields.length > 0 && (
        <div className="mt-1">
          {fields.map((field) => (
            <FieldRow key={field.id} row={field} showing={showing} indent />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What a move says in one badge.
 *
 * A reorder is positions, 1-based because the rest of the Studio numbers list
 * items for people rather than for arrays. A rename says only "renamed" here —
 * the two keys get their own line, because they are too important and too long
 * to live in a badge.
 */
function moveBadge(move: CompareMove | undefined): string {
  if (move === undefined) {
    return "Moved";
  }
  return move.kind === "rename"
    ? "Renamed"
    : `${move.from + 1} → ${move.to + 1}`;
}

/** The "Show all fields" control, and what it would reveal. */
export function ShowAllFieldsToggle({
  showUnchanged,
  onChange,
  hiddenCount,
}: {
  showUnchanged: boolean;
  onChange: (next: boolean) => void;
  hiddenCount: number;
}) {
  if (hiddenCount === 0 && !showUnchanged) {
    /*
     * Nothing to reveal, so no control. A toggle that changes nothing when
     * clicked teaches people to distrust it.
     */
    return null;
  }
  return (
    <button
      onClick={() => onChange(!showUnchanged)}
      className="rounded border border-border-primary px-2 py-1 text-xs text-fg-secondary hover:bg-bg-secondary"
    >
      {showUnchanged
        ? "Changed fields only"
        : `Show all fields (${hiddenCount} hidden)`}
    </button>
  );
}

/** A plain string value, for stories and for values with no field renderer. */
export function CompareTextValue({ children }: { children: ReactNode }) {
  return <span className="break-words">{children}</span>;
}
