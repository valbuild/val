/**
 * Which items of one sequence are which items of another.
 *
 * The question a diff of a list has to answer before it can say anything: an
 * array has no keys, so "the third item changed" is only true if the third
 * item is still the same item. Comparing by position gets it wrong the moment
 * something is inserted: every later index names a different element, and one
 * insertion reads as a run of edits (see `architecture/known-issues.md`).
 *
 * So items are matched by what they ARE, in four passes, each over what the
 * one before left:
 *
 * 1. **Equal, in order.** The longest common subsequence of the items' keys.
 * 2. **Equal, anywhere.** An item with the same key on both sides that pass 1
 *    did not take is the same item in another place.
 * 3. **Similar.** An item that is mostly the same on both sides is the same
 *    item, edited. Scored by the caller, since only the caller knows what an
 *    item is made of. This is how git finds a renamed file that was also
 *    changed.
 * 4. **Replaced where it stood.** A removal and an addition left in the same
 *    place, between the same two neighbours, are one item rewritten.
 *
 * Then, of everything matched, the fewest items that have to be called MOVED:
 * the matches outside the longest run that kept its order. Moving one item
 * from the end to the start shifts every index, and moves one item.
 */
export type SequenceMatch =
  | {
      kind: "kept";
      /** Index before, and now. */
      before: number;
      after: number;
      /** The same key on both sides: nothing inside it changed. */
      equal: boolean;
      /** It changed place relative to the items that did not. */
      moved: boolean;
    }
  | { kind: "added"; after: number }
  | { kind: "removed"; before: number };

export type SequenceMatching = {
  /**
   * In the order of the sequence now, with each removal where the item used
   * to be.
   */
  matches: SequenceMatch[];
  /**
   * The sequences were too long to match by content, and this is index against
   * index. Said, because a positional diff of a reordered list is misleading
   * in exactly the way this module exists to prevent.
   */
  positional: boolean;
};

export type MatchOptions<T> = {
  /** Two items with the same key are the same item, unchanged. */
  keyOf: (item: T) => string;
  /**
   * How much two different items have in common, from 0 to 1. At or above
   * {@link SIMILAR} they are one item, edited. Absent: only equal items match.
   */
  similarity?: (before: T, after: T) => number;
  /**
   * Whether one item could have been rewritten into the other: the same kind
   * of thing. Absent: a removal and an addition are never paired by place.
   */
  comparable?: (before: T, after: T) => boolean;
};

/** Above this many items on either side, matching by content is abandoned. */
export const MATCH_MAX_ITEMS = 1000;

/**
 * Above this many unmatched items on either side, similarity is not tried:
 * it scores every pair.
 */
const SIMILARITY_MAX_ITEMS = 200;

/** The share two items must have in common to be one item, edited. */
export const SIMILAR = 0.5;

export function matchSequence<T>(
  before: readonly T[],
  after: readonly T[],
  options: MatchOptions<T>,
): SequenceMatching {
  const beforeKeys = before.map(options.keyOf);
  const afterKeys = after.map(options.keyOf);
  if (before.length > MATCH_MAX_ITEMS || after.length > MATCH_MAX_ITEMS) {
    return positional(beforeKeys, afterKeys);
  }

  /** after index -> before index, for every item found on both sides. */
  const pairs = new Map<number, number>();
  const taken = new Set<number>();
  const pair = (beforeIndex: number, afterIndex: number): void => {
    pairs.set(afterIndex, beforeIndex);
    taken.add(beforeIndex);
  };

  // 1. Equal, in order.
  for (const [beforeIndex, afterIndex] of commonSubsequence(
    beforeKeys,
    afterKeys,
  )) {
    pair(beforeIndex, afterIndex);
  }

  // 2. Equal, anywhere. Duplicates pair one for one, in order.
  const leftByKey = new Map<string, number[]>();
  for (let i = 0; i < beforeKeys.length; i++) {
    if (taken.has(i)) continue;
    const list = leftByKey.get(beforeKeys[i]);
    if (list === undefined) leftByKey.set(beforeKeys[i], [i]);
    else list.push(i);
  }
  for (let j = 0; j < afterKeys.length; j++) {
    if (pairs.has(j)) continue;
    const beforeIndex = leftByKey.get(afterKeys[j])?.shift();
    if (beforeIndex !== undefined) pair(beforeIndex, j);
  }

  // 3. Similar: the best-scoring pairs first, so an item is matched to the
  // one it most resembles and not to the first that clears the bar.
  const { similarity } = options;
  if (similarity !== undefined) {
    const leftBefore = unmatched(before.length, (i) => taken.has(i));
    const leftAfter = unmatched(after.length, (j) => pairs.has(j));
    if (
      leftBefore.length <= SIMILARITY_MAX_ITEMS &&
      leftAfter.length <= SIMILARITY_MAX_ITEMS
    ) {
      const candidates: { i: number; j: number; score: number }[] = [];
      for (const i of leftBefore) {
        for (const j of leftAfter) {
          const score = similarity(before[i], after[j]);
          if (score >= SIMILAR) candidates.push({ i, j, score });
        }
      }
      candidates.sort(
        (a, b) =>
          b.score - a.score || Math.abs(a.i - a.j) - Math.abs(b.i - b.j),
      );
      for (const { i, j } of candidates) {
        if (taken.has(i) || pairs.has(j)) continue;
        pair(i, j);
      }
    }
  }

  // The matches that kept their order. Everything else that matched, moved.
  const inOrder = [...pairs.keys()].sort((a, b) => a - b);
  const stable = new Set(
    longestIncreasing(inOrder.map((j) => pairs.get(j) ?? -1)).map(
      (position) => inOrder[position],
    ),
  );

  // 4. Replaced where it stood: between two neighbours that did not move, as
  // many removals as additions, each of a kind with the one it faces.
  const { comparable } = options;
  if (comparable !== undefined) {
    const anchors = [...stable].sort((a, b) => a - b);
    let beforeFrom = 0;
    let afterFrom = 0;
    const gap = (beforeTo: number, afterTo: number): void => {
      const removed: number[] = [];
      for (let i = beforeFrom; i < beforeTo; i++) {
        if (!taken.has(i)) removed.push(i);
      }
      const added: number[] = [];
      for (let j = afterFrom; j < afterTo; j++) {
        if (!pairs.has(j)) added.push(j);
      }
      if (
        removed.length > 0 &&
        removed.length === added.length &&
        removed.every((i, k) => comparable(before[i], after[added[k]]))
      ) {
        removed.forEach((i, k) => {
          pair(i, added[k]);
          stable.add(added[k]);
        });
      }
    };
    for (const afterIndex of anchors) {
      const beforeIndex = pairs.get(afterIndex);
      if (beforeIndex === undefined) continue;
      gap(beforeIndex, afterIndex);
      beforeFrom = beforeIndex + 1;
      afterFrom = afterIndex + 1;
    }
    gap(before.length, after.length);
  }

  // In the order things are now. A removal goes in front of the first item
  // that stayed put and used to come after it.
  const removed = unmatched(before.length, (i) => taken.has(i));
  let nextRemoved = 0;
  const matches: SequenceMatch[] = [];
  for (let j = 0; j < after.length; j++) {
    const beforeIndex = pairs.get(j);
    if (beforeIndex === undefined) {
      matches.push({ kind: "added", after: j });
      continue;
    }
    const moved = !stable.has(j);
    if (!moved) {
      while (
        nextRemoved < removed.length &&
        removed[nextRemoved] < beforeIndex
      ) {
        matches.push({ kind: "removed", before: removed[nextRemoved++] });
      }
    }
    matches.push({
      kind: "kept",
      before: beforeIndex,
      after: j,
      equal: beforeKeys[beforeIndex] === afterKeys[j],
      moved,
    });
  }
  while (nextRemoved < removed.length) {
    matches.push({ kind: "removed", before: removed[nextRemoved++] });
  }
  return { matches, positional: false };
}

function unmatched(length: number, has: (index: number) => boolean): number[] {
  const out: number[] = [];
  for (let index = 0; index < length; index++) {
    if (!has(index)) out.push(index);
  }
  return out;
}

/** Index against index, for sequences too long to match by content. */
function positional(before: string[], after: string[]): SequenceMatching {
  const matches: SequenceMatch[] = [];
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i++) {
    matches.push({
      kind: "kept",
      before: i,
      after: i,
      equal: before[i] === after[i],
      moved: false,
    });
  }
  for (let j = shared; j < after.length; j++) {
    matches.push({ kind: "added", after: j });
  }
  for (let i = shared; i < before.length; i++) {
    matches.push({ kind: "removed", before: i });
  }
  return { matches, positional: true };
}

/**
 * The longest common subsequence of two lists of keys, as index pairs.
 *
 * What the two share at the start and at the end is set aside first: most
 * edits touch a few items of a list, and the table is only as big as the
 * middle that differs.
 */
function commonSubsequence(a: string[], b: string[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0) {
    const width = m + 1;
    const table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  }

  for (let k = 0; endA + k < a.length; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/**
 * The positions of a longest strictly increasing subsequence.
 *
 * Patience sorting: `tails[k]` is the position of the smallest value that
 * ends an increasing run of length `k + 1`, and each position remembers the
 * one before it in its run.
 */
export function longestIncreasing(values: number[]): number[] {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (let position = 0; position < values.length; position++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < values[position]) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[position] = tails[low - 1];
    tails[low] = position;
  }
  const out: number[] = [];
  let position = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (position !== -1) {
    out.push(position);
    position = previous[position];
  }
  return out.reverse();
}
