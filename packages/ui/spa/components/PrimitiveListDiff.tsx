import { useMemo } from "react";
import type { SourcePath } from "@valbuild/core";
import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react";
import {
  diffPrimitiveList,
  listDiffHasChanges,
  summarizeListDiff,
  type ListDiffLine,
  type ListPrimitive,
} from "../utils/listDiff";
import { useServerSourceAtPath, useSourceAtPath } from "./ValFieldProvider";
import { cn } from "./designSystem/cn";

/**
 * A whole list of primitives as one diff, in final order.
 *
 * Replaces one row per touched index, which for a list was the wrong unit twice
 * over. Array paths are positional, so inserting an item shifts every later
 * index: the row list then showed a cascade of "changes" for one insertion, and
 * each row's "before" — read from the base source at the row's own index — named
 * a DIFFERENT element than the one on its "after" side. See `listDiff.ts` for why
 * matching by content is the fix for both at once.
 *
 * Rendered as one block rather than as rows because a list is read as a list:
 * "what does this end up being, and what moved" is a question about the sequence,
 * and answering it a row at a time asks the reader to reassemble the sequence in
 * their head.
 *
 * ## It is the NET difference, not a replay of the ops
 *
 * Base against patched, so several patches to one list collapse into one answer
 * about where it started and where it ended up. Mostly that is the point — an
 * item appended and then typed into is one addition of the final value, not an
 * addition followed by an edit. It does mean a deletion and an insertion in the
 * same place read as a substitution ("content → inserted") rather than as the two
 * separate acts they were, which is the same summary `git diff` gives for the
 * same pair, and the right one: it describes the list the editor is about to
 * publish.
 */
export function PrimitiveListDiff({
  sourcePath,
}: {
  sourcePath: SourcePath;
}): React.ReactNode {
  const before = useServerSourceAtPath(sourcePath);
  const after = useSourceAtPath(sourcePath);

  const beforeList = asPrimitiveList(
    before.status === "success" ? before.data : undefined,
  );
  const afterList = asPrimitiveList(
    after.status === "success" ? after.data : undefined,
  );

  const diff = useMemo(
    () =>
      beforeList === null || afterList === null
        ? null
        : diffPrimitiveList(beforeList, afterList),
    [beforeList, afterList],
  );

  if (diff === null) {
    // Not a list of primitives after all — a schema said one thing and the value
    // is another. Saying nothing is better than rendering a diff of a shape this
    // cannot describe; the row's own header still names the change.
    return null;
  }
  if (!listDiffHasChanges(diff)) {
    return (
      <div className="text-sm text-fg-tertiary">
        The list ended up the same as it started.
      </div>
    );
  }

  const counts = summarizeListDiff(diff);
  return (
    <div className="min-w-0">
      <ListDiffSummary counts={counts} />
      {diff.positional && <PositionalNotice />}
      {/*
       * A list, semantically: this is a sequence and a screen reader should be
       * able to walk it as one. `tabular-nums` so the indices down the left edge
       * line up, which is the whole reason they are there.
       */}
      <ol className="mt-3 flex flex-col gap-px font-mono text-sm tabular-nums">
        {diff.lines.map((line, at) => (
          <ListDiffRow key={`${line.kind}-${at}`} line={line} />
        ))}
      </ol>
    </div>
  );
}

/** What changed, before anyone reads the lines. */
function ListDiffSummary({
  counts,
}: {
  counts: ReturnType<typeof summarizeListDiff>;
}) {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  if (counts.moved > 0) parts.push(`${counts.moved} moved`);
  if (counts.changed > 0) parts.push(`${counts.changed} changed`);
  return (
    <p className="text-sm text-fg-secondary">
      {parts.join(", ")}
      {counts.unchanged > 0 && (
        <span className="text-fg-tertiary">
          {parts.length > 0 ? " · " : ""}
          {counts.unchanged} unchanged
        </span>
      )}
    </p>
  );
}

/**
 * Said out loud, because a positional diff of a reordered list is misleading in
 * exactly the way the content matching exists to prevent.
 */
function PositionalNotice() {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-secondary">
      <TriangleAlert
        size={12}
        className="mt-0.5 shrink-0 text-fg-warning-primary-alt"
        aria-hidden
      />
      This list is too long to match items by content, so it is compared
      position by position. A reorder will read as a run of changes.
    </p>
  );
}

/** The colour and the marker for one line. One place, so they cannot drift. */
function ListDiffRow({ line }: { line: ListDiffLine }) {
  /*
   * A removed line has no position in the list you end up with, so it shows none.
   *
   * It used to print its BEFORE index here, which collided: deleting item 3 put a
   * "3" on the removed line and another "3" on the line that now occupies that
   * slot, one under the other. Both were right and the pair read as a bug. Where
   * the item used to be is still worth saying, so it moved into the tag —
   * "removed from 3" — which is the one place it cannot be mistaken for an
   * position in the current list.
   */
  const index = "index" in line ? line.index : null;
  return (
    <li
      className={cn(
        "flex min-w-0 items-baseline gap-2 rounded border-l-[3px] py-1 pl-2 pr-1",
        line.kind === "added" &&
          "border-fg-brand-primary bg-bg-brand-primary/5",
        line.kind === "removed" && "border-fg-error bg-bg-error-secondary/30",
        line.kind === "moved" && "border-fg-warning bg-bg-secondary/40",
        line.kind === "changed" && "border-fg-warning",
        line.kind === "unchanged" && "border-transparent",
      )}
    >
      {/*
       * The marker is `aria-hidden` and the word beside it is not: "+" is a
       * colour and a glyph, and a reader who gets neither needs the word.
       */}
      <span
        aria-hidden
        className={cn(
          "w-3 shrink-0 select-none text-center",
          line.kind === "added" && "text-fg-brand-primary",
          line.kind === "removed" && "text-fg-error",
          line.kind === "moved" && "text-fg-warning",
          line.kind === "changed" && "text-fg-warning",
          line.kind === "unchanged" && "text-fg-quaternary",
        )}
      >
        {markerFor(line.kind)}
      </span>
      <span className="w-8 shrink-0 text-right text-xs text-fg-quaternary">
        {index === null ? "" : index + 1}
      </span>
      <span className="min-w-0 flex-1 break-words">
        <ListDiffValue line={line} />
      </span>
      <ListDiffTag line={line} />
    </li>
  );
}

function markerFor(kind: ListDiffLine["kind"]): string {
  switch (kind) {
    case "added":
      return "+";
    case "removed":
      return "−";
    case "moved":
      return "↕";
    case "changed":
      return "~";
    case "unchanged":
      return "";
  }
}

/** The value, with a changed line showing both. */
function ListDiffValue({ line }: { line: ListDiffLine }) {
  if (line.kind === "changed") {
    return (
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-fg-tertiary line-through decoration-fg-error/60">
          <Value value={line.before} />
        </span>
        <span aria-hidden className="text-fg-quaternary">
          →
        </span>
        <span>
          <Value value={line.after} />
        </span>
      </span>
    );
  }
  return (
    <span className={line.kind === "removed" ? "text-fg-tertiary" : undefined}>
      <Value value={line.value} />
    </span>
  );
}

/**
 * One value, rendered so an empty string is visible.
 *
 * An added item that has not been typed into yet IS the empty string, and a blank
 * line reads as a rendering failure rather than as a value.
 */
function Value({ value }: { value: ListPrimitive }) {
  if (value === null) {
    return <span className="italic text-fg-tertiary">null</span>;
  }
  if (value === "") {
    return <span className="italic text-fg-tertiary">empty</span>;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return <>{String(value)}</>;
  }
  return <>{value}</>;
}

/** The words the marker cannot say — including where a move came from. */
function ListDiffTag({ line }: { line: ListDiffLine }) {
  if (line.kind === "unchanged") {
    return null;
  }
  if (line.kind === "moved") {
    const up = line.index < line.beforeIndex;
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap font-sans text-xs text-fg-warning">
        {up ? (
          <ArrowUp size={11} aria-hidden />
        ) : (
          <ArrowDown size={11} aria-hidden />
        )}
        {/* Both positions, 1-based to match the numbers down the left edge. */}
        moved from {line.beforeIndex + 1}
      </span>
    );
  }
  const label =
    line.kind === "added"
      ? "added"
      : line.kind === "removed"
        ? // Where it was, since the gutter no longer says.
          `removed from ${line.beforeIndex + 1}`
        : "changed";
  return (
    <span
      className={cn(
        "ml-auto shrink-0 whitespace-nowrap font-sans text-xs",
        line.kind === "added" && "text-fg-brand-primary",
        line.kind === "removed" && "text-fg-error",
        line.kind === "changed" && "text-fg-warning",
      )}
    >
      {label}
    </span>
  );
}

/**
 * The value as a list of primitives, or `null` if it is not one.
 *
 * Checked rather than asserted: the schema says this is an array of primitives
 * and the source is whatever the patches made it, so the two can disagree — and a
 * diff built on the assumption they agree would render nonsense for the one case
 * where knowing is useful.
 */
function asPrimitiveList(value: unknown): ListPrimitive[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: ListPrimitive[] = [];
  for (const item of value) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      out.push(item);
    } else {
      return null;
    }
  }
  return out;
}
