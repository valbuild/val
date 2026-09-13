import type { ReactNode } from "react";
import { cn } from "../components/designSystem/cn";
import {
  ChangeKindIcon,
  changeKindLabel,
  sideRailClass,
} from "./ChangeKindIcon";
import { FieldPatchAuthorsPure } from "../components/FieldPatchAuthors";
import { passesAuthorFilter, useCompareAuthors } from "./CompareAuthorsContext";
import type {
  CompareAuthorship,
  CompareFieldRow,
  CompareGroup,
  CompareListItemRow,
  CompareMove,
  ComparePane,
} from "./types";

/**
 * One selected thing, as two columns of rows.
 *
 * The layout contract with {@link CompareColumns} is the only subtle part:
 * this renders the LEFT column and the RIGHT column as two separate calls, and
 * the two have to line up row for row. So every row occupies the same vertical
 * space on both sides whether or not it has a value there — an added field is
 * an empty, dashed placeholder on the left, not a missing row that shifts
 * everything below it out of step.
 *
 * That is also why the labels are drawn on BOTH sides rather than once in a
 * gutter. A label in the middle would align the two columns at the cost of
 * making each one unreadable on its own, which is exactly what the phone
 * layout needs them to be.
 */
export function ComparePaneSide({
  pane,
  side,
  showUnchanged,
}: {
  pane: ComparePane;
  side: "before" | "after";
  showUnchanged: boolean;
}) {
  return (
    <div className="min-w-0">
      {pane.groups.map((group) => (
        <GroupSide
          key={group.id}
          group={group}
          side={side}
          showUnchanged={showUnchanged}
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

function GroupSide({
  group,
  side,
  showUnchanged,
}: {
  group: CompareGroup;
  side: "before" | "after";
  showUnchanged: boolean;
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
          <FieldRowSide key={row.id} row={row} side={side} />
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
        <ListItemRowSide
          key={row.id}
          row={row}
          side={side}
          showUnchanged={showUnchanged}
        />
      ))}
    </section>
  );
}

/**
 * A heading drawn on both sides, identically.
 *
 * Repeated rather than placed once in a gutter, for the alignment reason in
 * this file's header: the two columns are separate grids, so a heading present
 * in one and absent in the other puts every row below it out of step. Repeating
 * it is also what lets either column stand alone, which is what the phone
 * layout needs.
 */
function GroupHeading({ title, summary }: { title: string; summary?: string }) {
  return (
    <div className="mb-1 flex min-w-0 items-baseline gap-2 border-b border-border-secondary pb-1">
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
 * The avatar stack for one row, on the right column only.
 *
 * `FieldPatchAuthorsPure` is the component the current review screen uses, so
 * attribution looks and behaves the same in both — one avatar stack, a popover
 * listing each patch with its op icon and a relative date. Rendering a second
 * one here would be a thing to keep in step for no gain.
 */
function RowAuthors({
  authors,
  side,
}: {
  authors: CompareAuthorship | undefined;
  side: "before" | "after";
}) {
  const ctx = useCompareAuthors();
  if (side !== "after" || authors === undefined || ctx === null) {
    return null;
  }
  return (
    <FieldPatchAuthorsPure
      patchesByAuthorIds={authors}
      profilesByAuthorIds={ctx.profiles}
      now={ctx.now}
      portalContainer={ctx.portalContainer}
      mode={ctx.mode}
    />
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

function FieldRowSide({
  row,
  side,
  indent = false,
}: {
  row: CompareFieldRow;
  side: "before" | "after";
  indent?: boolean;
}) {
  const value = side === "before" ? row.before : row.after;
  /*
   * An unchanged row is the same value twice, and drawing it with rails on both
   * sides would make it look like something happened. It gets no rail and a
   * dimmed value, so the eye skips it — which is the whole reason it is allowed
   * on screen at all.
   */
  const isUnchanged = row.change === "unchanged";
  const absent = value === undefined;
  return (
    <div className={cn("py-1", indent && "pl-3")}>
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
         * Pushed to the end of the row rather than placed after the label: a
         * label's length varies per row, and avatars that started at a
         * different x on every line would read as noise rather than as a
         * column you can scan down.
         */}
        <span className="ml-auto shrink-0">
          <RowAuthors authors={row.authors} side={side} />
        </span>
      </div>
      {absent ? (
        <AbsentValue side={side} change={row.change} />
      ) : (
        <div
          className={cn(
            "mt-0.5 min-w-0 py-0.5 pl-2 text-sm",
            isUnchanged ? "text-fg-tertiary" : sideRailClass(side),
          )}
        >
          {value}
        </div>
      )}
    </div>
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
 */
function ListItemRowSide({
  row,
  side,
  showUnchanged,
}: {
  row: CompareListItemRow;
  side: "before" | "after";
  showUnchanged: boolean;
}) {
  const ctx = useCompareAuthors();
  const fields = visibleFieldRows(
    row.fields ?? [],
    showUnchanged,
    ctx?.authorFilter ?? null,
  );
  /*
   * An added entry has no left side and a removed one has no right side, but
   * the ROW still has to exist on both so the columns stay in step. The empty
   * side keeps the key, dimmed, which also happens to be the most useful thing
   * it could say.
   */
  const presentOnThisSide =
    row.change === "added"
      ? side === "after"
      : row.change === "removed"
        ? side === "before"
        : true;
  /*
   * A renamed entry is called something different on each side, so each column
   * shows the key ITS side knows it by. Anything else makes one of the two
   * columns a lie — and the left column is supposed to be readable on its own,
   * which is what the phone layout depends on.
   */
  const keyOnThisSide =
    row.change === "moved" && row.move?.kind === "rename"
      ? side === "before"
        ? row.move.from
        : row.move.to
      : row.label;

  return (
    <div className="border-b border-border-secondary py-1.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <ChangeKindIcon kind={row.change} size={12} hideLabel />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-xs",
            presentOnThisSide ? "text-fg-primary" : "text-fg-tertiary",
          )}
        >
          {keyOnThisSide}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-tertiary">
          {row.change === "moved"
            ? moveBadge(row.move)
            : presentOnThisSide
              ? changeKindLabel(row.change)
              : ""}
        </span>
        <span className="shrink-0">
          <RowAuthors authors={row.authors} side={side} />
        </span>
      </div>
      {/*
       * A rename gets its own line, on both sides, showing the key each side
       * knows it by.
       *
       * Not folded into the badge: for a router record the key is the URL, so
       * this is a page changing address — the line most likely to break links,
       * and the one an editor scans a publish for. A badge reading "RENAMED"
       * would say that something happened without saying what, and the two keys
       * are the whole content of the change.
       */}
      {row.change === "moved" && row.move?.kind === "rename" && (
        <div className="mt-1 min-w-0 border-l-2 border-l-border-secondary py-0.5 pl-2 font-mono text-xs">
          <span
            className={
              side === "before" ? "text-fg-primary" : "text-fg-tertiary"
            }
          >
            {row.move.from}
          </span>
          <span className="px-1 text-fg-tertiary" aria-hidden>
            →
          </span>
          <span
            className={
              side === "after" ? "text-fg-primary" : "text-fg-tertiary"
            }
          >
            {row.move.to}
          </span>
        </div>
      )}
      {/*
       * The preview, or a placeholder of the same height where there is none.
       *
       * The two columns are separate grids that have to stay in step row for
       * row, so an added entry — which has a preview on the right and nothing
       * on the left — cannot simply omit the block: everything below it on the
       * left would ride up, and two lists that disagree about which row is
       * which are worse than no diff at all.
       */}
      {row.preview !== undefined &&
        (presentOnThisSide ? (
          <div
            className={cn(
              "mt-1 min-w-0 py-0.5 pl-2 text-sm",
              /*
               * A moved entry gets a NEUTRAL rail, not a red one and a green
               * one. Its value is the same on both sides — only its position
               * changed — and the before/after rails would claim an edit that
               * did not happen. The position badge on the row is the change.
               */
              row.change === "moved"
                ? "border-l-2 border-l-border-secondary"
                : sideRailClass(side),
            )}
          >
            {row.preview}
          </div>
        ) : (
          <div
            className="mt-1 min-w-0 border-l-2 border-l-border-secondary py-0.5 pl-2 text-sm italic text-fg-tertiary"
            aria-hidden
          >
            {row.change === "added" ? "Did not exist" : "Removed"}
          </div>
        ))}
      {fields.length > 0 && (
        <div className="mt-1">
          {fields.map((field) => (
            <FieldRowSide key={field.id} row={field} side={side} indent />
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
