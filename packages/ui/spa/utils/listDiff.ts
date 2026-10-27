/**
 * Diffing a list of primitives by VALUE, so a reorder reads as a reorder.
 *
 * ## Why this is not a presentation choice
 *
 * An array item's path is positional — `?p="0"`, `?p="1"` — so a reorder does not
 * move paths, it moves content between fixed paths (see `architecture/quirks.md`).
 * Everything downstream of that is positional too, and that is where the compare
 * view went wrong: it read the "before" side of a row from the BASE source at the
 * row's own index. Insert one item at index 1 and every later index now names a
 * different element, so a subsequent edit rendered a before/after of two
 * unrelated strings. Not a confusing diff — the wrong element.
 *
 * A diff that matches by CONTENT cannot make that mistake, because it never asks
 * "what used to be at this index". It asks which items are the same items, and
 * the answer carries where each one came from. So the fix for the legibility
 * complaint and the fix for the correctness bug are the same fix.
 *
 * ## Primitives only, and why the line is there
 *
 * Values have to be comparable for content matching to mean anything, and a line
 * of the rendered diff has to fit on a row. Both hold for `string`, `number` and
 * `boolean` and neither obviously holds for `s.array(s.object(...))`, where
 * matching needs a notion of item identity that the schema does not currently
 * carry. Arrays of objects therefore keep the per-index rendering; the case is
 * written up in `architecture/known-issues.md` rather than guessed at.
 */

/** What a list of this kind holds. `null` included: `s.string().nullable()`. */
export type ListPrimitive = string | number | boolean | null;

/**
 * One line of the rendered diff, in FINAL order.
 *
 * `removed` lines are interleaved where the item used to be, which is what makes
 * the result readable top to bottom: the list you end up with, with the deletions
 * still visible in place.
 *
 * `index` is the position in the AFTER list; `beforeIndex` the position in the
 * BEFORE list. A line has both exactly when it is the same item in both.
 */
export type ListDiffLine =
  | {
      kind: "unchanged";
      index: number;
      beforeIndex: number;
      value: ListPrimitive;
    }
  | { kind: "added"; index: number; value: ListPrimitive }
  | { kind: "removed"; beforeIndex: number; value: ListPrimitive }
  | { kind: "moved"; index: number; beforeIndex: number; value: ListPrimitive }
  | {
      kind: "changed";
      index: number;
      beforeIndex: number;
      before: ListPrimitive;
      after: ListPrimitive;
    };

export type ListDiff = {
  lines: ListDiffLine[];
  /**
   * True when the lists were too long to match by content and the result is a
   * positional comparison instead.
   *
   * Surfaced rather than hidden: a positional diff of a reordered list is
   * misleading in exactly the way this module exists to prevent, so a reader has
   * to be able to be told that is what they are looking at.
   */
  positional: boolean;
};

/**
 * Above this many items on either side, matching by content is abandoned.
 *
 * The LCS below is O(n·m) in time and space, so 1000×1000 is a million cells —
 * already more than a compare view should spend, and a list that long is not
 * being read line by line anyway. The fallback is the positional comparison the
 * view did before this existed, so nothing gets worse; it is just labelled.
 */
export const LIST_DIFF_MAX_ITEMS = 1000;

/** Same item, for matching purposes. Primitives, so identity is equality. */
function same(a: ListPrimitive, b: ListPrimitive): boolean {
  return a === b;
}

/**
 * The longest common subsequence, as index pairs.
 *
 * These are the items that did NOT move relative to each other, and everything
 * else is derived from what is left over. Classic DP: the table is built once and
 * walked back once.
 */
function longestCommonSubsequence(
  before: readonly ListPrimitive[],
  after: readonly ListPrimitive[],
): { beforeIndex: number; index: number }[] {
  const n = before.length;
  const m = after.length;
  // (n+1)×(m+1) so row 0 / column 0 are the empty-prefix base cases.
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = same(before[i], after[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: { beforeIndex: number; index: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(before[i], after[j])) {
      pairs.push({ beforeIndex: i, index: j });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** The positional fallback, for lists too long to match by content. */
function positionalDiff(
  before: readonly ListPrimitive[],
  after: readonly ListPrimitive[],
): ListDiff {
  const lines: ListDiffLine[] = [];
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i++) {
    if (same(before[i], after[i])) {
      lines.push({
        kind: "unchanged",
        index: i,
        beforeIndex: i,
        value: after[i],
      });
    } else {
      lines.push({
        kind: "changed",
        index: i,
        beforeIndex: i,
        before: before[i],
        after: after[i],
      });
    }
  }
  for (let i = shared; i < after.length; i++) {
    lines.push({ kind: "added", index: i, value: after[i] });
  }
  for (let i = shared; i < before.length; i++) {
    lines.push({ kind: "removed", beforeIndex: i, value: before[i] });
  }
  return { lines, positional: true };
}

/**
 * Diff two lists of primitives.
 *
 * Three passes, and the order between them is what makes each answer the right
 * one:
 *
 * 1. **LCS** — the items that kept their relative order. These are `unchanged`.
 * 2. **Moves, matched GLOBALLY.** An item outside the LCS whose value also
 *    appears outside the LCS on the other side is the same item in a new place,
 *    wherever in the list that place is. Global, because a move is precisely a
 *    change of position and restricting the search to a neighbourhood would only
 *    find the small ones.
 * 3. **Changes, matched WITHIN A GAP.** What is left is a leftover removal and a
 *    leftover addition between the same two anchors — an item edited in place.
 *    Local, because "the third item became something else" is only meaningful
 *    against the items either side of it; pairing across the whole list would
 *    invent an edit out of one deletion here and one insertion at the far end.
 *
 * Whatever survives all three is a plain `added` or `removed`.
 */
export function diffPrimitiveList(
  before: readonly ListPrimitive[],
  after: readonly ListPrimitive[],
): ListDiff {
  if (
    before.length > LIST_DIFF_MAX_ITEMS ||
    after.length > LIST_DIFF_MAX_ITEMS
  ) {
    return positionalDiff(before, after);
  }

  const anchors = longestCommonSubsequence(before, after);
  const anchoredBefore = new Set(anchors.map((pair) => pair.beforeIndex));
  const anchoredAfter = new Set(anchors.map((pair) => pair.index));
  const beforeAnchorOf = new Map(
    anchors.map((pair) => [pair.index, pair.beforeIndex]),
  );

  // Pass 2: pair up moves. Leftovers are consumed as they are claimed, so an
  // item is never both moved and changed, and duplicates pair one-for-one.
  const unmatchedBefore: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (!anchoredBefore.has(i)) unmatchedBefore.push(i);
  }
  const movedFrom = new Map<number, number>();
  const claimedBefore = new Set<number>();
  for (let j = 0; j < after.length; j++) {
    if (anchoredAfter.has(j)) continue;
    const match = unmatchedBefore.find(
      (i) => !claimedBefore.has(i) && same(before[i], after[j]),
    );
    if (match !== undefined) {
      claimedBefore.add(match);
      movedFrom.set(j, match);
    }
  }

  /*
   * Pass 3, walked as gaps between anchors.
   *
   * One cursor per side, advanced together through the anchors, so the items
   * between one anchor and the next are exactly the two gaps to pair. Emitting
   * as we go is also what puts `removed` lines where the items used to be.
   */
  const lines: ListDiffLine[] = [];
  let bi = 0;
  let aj = 0;
  const emitGap = (beforeEnd: number, afterEnd: number): void => {
    const removals: number[] = [];
    const additions: number[] = [];
    while (bi < beforeEnd) {
      if (!claimedBefore.has(bi)) removals.push(bi);
      bi++;
    }
    while (aj < afterEnd) {
      if (movedFrom.has(aj)) {
        // A move that landed in this gap. Emitted in place, so the line appears
        // where the item now is — which is the question a reader is asking.
        const from = movedFrom.get(aj);
        if (from === undefined) {
          throw new Error("unreachable: movedFrom.has without a value");
        }
        lines.push({
          kind: "moved",
          index: aj,
          beforeIndex: from,
          value: after[aj],
        });
      } else {
        additions.push(aj);
      }
      aj++;
    }
    // Pair leftovers 1:1 in order — those are edits in place. Whatever is left
    // over on either side is a genuine addition or deletion.
    const paired = Math.min(removals.length, additions.length);
    for (let k = 0; k < paired; k++) {
      lines.push({
        kind: "changed",
        index: additions[k],
        beforeIndex: removals[k],
        before: before[removals[k]],
        after: after[additions[k]],
      });
    }
    for (let k = paired; k < additions.length; k++) {
      lines.push({
        kind: "added",
        index: additions[k],
        value: after[additions[k]],
      });
    }
    for (let k = paired; k < removals.length; k++) {
      lines.push({
        kind: "removed",
        beforeIndex: removals[k],
        value: before[removals[k]],
      });
    }
  };

  for (const anchor of anchors) {
    emitGap(anchor.beforeIndex, anchor.index);
    const beforeIndex = beforeAnchorOf.get(anchor.index) ?? anchor.beforeIndex;
    lines.push({
      kind: "unchanged",
      index: anchor.index,
      beforeIndex,
      value: after[anchor.index],
    });
    bi = anchor.beforeIndex + 1;
    aj = anchor.index + 1;
  }
  emitGap(before.length, after.length);

  return { lines, positional: false };
}

/** Whether a diff has anything to show. An all-`unchanged` diff has not. */
export function listDiffHasChanges(diff: ListDiff): boolean {
  return diff.lines.some((line) => line.kind !== "unchanged");
}

/**
 * A count per kind, for the summary above the list.
 *
 * "3 added, 1 moved" is what tells someone whether to read the lines at all, and
 * deriving it here keeps the component from walking the diff a second time.
 */
export function summarizeListDiff(diff: ListDiff): {
  added: number;
  removed: number;
  moved: number;
  changed: number;
  unchanged: number;
} {
  const counts = { added: 0, removed: 0, moved: 0, changed: 0, unchanged: 0 };
  for (const line of diff.lines) {
    counts[line.kind] += 1;
  }
  return counts;
}
