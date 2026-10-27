import {
  diffPrimitiveList,
  LIST_DIFF_MAX_ITEMS,
  listDiffHasChanges,
  summarizeListDiff,
  type ListDiffLine,
} from "./listDiff";

/**
 * Compact notation for a diff, so a case reads as the thing it claims.
 *
 * The assertions are on this rather than on the objects because a list diff is a
 * SEQUENCE, and a test that checks the lines one field at a time stops saying
 * what shape the whole answer has.
 */
function render(lines: ListDiffLine[]): string[] {
  return lines.map((line) => {
    switch (line.kind) {
      case "unchanged":
        return `  ${line.index} ${JSON.stringify(line.value)}`;
      case "added":
        return `+ ${line.index} ${JSON.stringify(line.value)}`;
      case "removed":
        return `- ${line.beforeIndex} ${JSON.stringify(line.value)}`;
      case "moved":
        return `~ ${line.index} ${JSON.stringify(line.value)} from ${line.beforeIndex}`;
      case "changed":
        return `* ${line.index} ${JSON.stringify(line.before)} -> ${JSON.stringify(line.after)}`;
    }
  });
}

function diff(
  before: readonly (string | number | boolean | null)[],
  after: readonly (string | number | boolean | null)[],
): string[] {
  return render(diffPrimitiveList(before, after).lines);
}

describe("diffPrimitiveList", () => {
  test("an untouched list is all unchanged", () => {
    expect(diff(["a", "b", "c"], ["a", "b", "c"])).toEqual([
      '  0 "a"',
      '  1 "b"',
      '  2 "c"',
    ]);
    expect(listDiffHasChanges(diffPrimitiveList(["a"], ["a"]))).toBe(false);
  });

  test("two empty lists produce nothing", () => {
    expect(diff([], [])).toEqual([]);
  });

  test("an append is one added line at the end", () => {
    expect(diff(["a", "b"], ["a", "b", "c"])).toEqual([
      '  0 "a"',
      '  1 "b"',
      '+ 2 "c"',
    ]);
  });

  /**
   * The case that drove this module.
   *
   * An insert at index 1 shifts every later index, and the positional reading
   * that produced was "index 1 changed a→x, index 2 changed b→a, index 3 added".
   * Three changes for one insertion, and each "before" naming the wrong element.
   */
  test("an insert in the middle is ONE added line, not a cascade", () => {
    expect(diff(["a", "b", "c"], ["a", "x", "b", "c"])).toEqual([
      '  0 "a"',
      '+ 1 "x"',
      '  2 "b"',
      '  3 "c"',
    ]);
  });

  test("a deletion in the middle shows where it was", () => {
    expect(diff(["a", "b", "c"], ["a", "c"])).toEqual([
      '  0 "a"',
      '- 1 "b"',
      '  1 "c"',
    ]);
  });

  test("an edit in place is one changed line carrying both values", () => {
    expect(diff(["a", "fig", "c"], ["a", "figs", "c"])).toEqual([
      '  0 "a"',
      '* 1 "fig" -> "figs"',
      '  2 "c"',
    ]);
  });

  test("a move names where the item came from", () => {
    // "d" went from the end to the front.
    expect(diff(["a", "b", "c", "d"], ["d", "a", "b", "c"])).toEqual([
      '~ 0 "d" from 3',
      '  1 "a"',
      '  2 "b"',
      '  3 "c"',
    ]);
  });

  test("a move from the front to the back", () => {
    expect(diff(["a", "b", "c"], ["b", "c", "a"])).toEqual([
      '  0 "b"',
      '  1 "c"',
      '~ 2 "a" from 0',
    ]);
  });

  test("a swap of two neighbours moves one of them, not both", () => {
    /*
     * WHICH one is not asserted, on purpose.
     *
     * Either answer describes the swap correctly — the LCS is length 1 and both
     * choices of anchor are equally long — so pinning one would be pinning an
     * implementation detail of the tie-break. What matters is that a two-item
     * swap costs the reader ONE line of "this moved", not two.
     */
    const result = diffPrimitiveList(["a", "b"], ["b", "a"]);
    expect(summarizeListDiff(result)).toEqual({
      added: 0,
      removed: 0,
      moved: 1,
      changed: 0,
      unchanged: 1,
    });
    const moved = result.lines.find((line) => line.kind === "moved");
    if (moved === undefined || moved.kind !== "moved") {
      throw new Error("expected exactly one moved line");
    }
    // And wherever it went, it says where it came from.
    expect(moved.beforeIndex).not.toBe(moved.index);
  });

  /**
   * A move is matched globally, an edit locally, and this pins the difference.
   *
   * "d" travels the length of the list, which only a global search finds. The
   * edit to "b" stays local to its own gap, so it does not get paired with the
   * far-away deletion instead.
   */
  test("a long-range move and a local edit at once", () => {
    expect(diff(["a", "b", "c", "d"], ["d", "a", "bee", "c"])).toEqual([
      '~ 0 "d" from 3',
      '  1 "a"',
      '* 2 "b" -> "bee"',
      '  3 "c"',
    ]);
  });

  test("add then edit reads as one addition of the final value", () => {
    // What an editor actually does: append an empty string, then type into it.
    // The list they end up with has one new item, and that is what this says.
    expect(diff(["a", "b"], ["a", "b", "typed"])).toEqual([
      '  0 "a"',
      '  1 "b"',
      '+ 2 "typed"',
    ]);
  });

  test("an insert and a later edit stay separate, each against the right item", () => {
    // The bug this replaces showed the edit's "before" as the element that used
    // to occupy the index — here, "b" rather than "c".
    expect(diff(["a", "b", "c"], ["a", "x", "b", "see"])).toEqual([
      '  0 "a"',
      '+ 1 "x"',
      '  2 "b"',
      '* 3 "c" -> "see"',
    ]);
  });

  test("everything replaced is a change per slot, then the surplus", () => {
    expect(diff(["a", "b"], ["x", "y", "z"])).toEqual([
      '* 0 "a" -> "x"',
      '* 1 "b" -> "y"',
      '+ 2 "z"',
    ]);
  });

  test("emptying a list removes every line", () => {
    expect(diff(["a", "b"], [])).toEqual(['- 0 "a"', '- 1 "b"']);
  });

  test("filling an empty list adds every line", () => {
    expect(diff([], ["a", "b"])).toEqual(['+ 0 "a"', '+ 1 "b"']);
  });

  /**
   * Duplicates, which is where a value-matched diff can double-count.
   *
   * Each leftover is claimed at most once, so three "a"s before and two after
   * cannot produce two moves of the same item.
   */
  test("duplicate values pair one-for-one", () => {
    expect(diff(["a", "a", "a"], ["a", "a"])).toEqual([
      '  0 "a"',
      '  1 "a"',
      '- 2 "a"',
    ]);
  });

  test("a duplicate that moves is reported once", () => {
    const result = diffPrimitiveList(["a", "b", "a"], ["a", "a", "b"]);
    const moved = result.lines.filter((line) => line.kind === "moved");
    expect(moved.length).toBeLessThanOrEqual(1);
    // And the result still describes the right list.
    expect(
      result.lines
        .filter((line) => line.kind !== "removed")
        .map((line) => (line.kind === "changed" ? line.after : line.value)),
    ).toEqual(["a", "a", "b"]);
  });

  test("non-string primitives are diffed the same way", () => {
    // 2 went, 4 arrived — a removal and an addition, not one substitution: they
    // are in different gaps, either side of the surviving 3.
    expect(diff([1, 2, 3], [1, 3, 4])).toEqual([
      "  0 1",
      "- 1 2",
      "  1 3",
      "+ 2 4",
    ]);
    const booleans = diffPrimitiveList([true, false], [false, true]);
    expect(summarizeListDiff(booleans).moved).toBe(1);
  });

  test("null is a value, not a gap", () => {
    expect(diff(["a", null], ["a", "b"])).toEqual([
      '  0 "a"',
      '* 1 null -> "b"',
    ]);
  });

  /**
   * The lines always describe the after list, whatever the diff decided.
   *
   * A property rather than a case: every line that is not a removal, read in
   * order, has to reconstruct the list the editor is looking at. Anything else is
   * a diff of a list that does not exist.
   */
  test.each([
    [
      ["a", "b", "c"],
      ["c", "b", "a"],
    ],
    [
      ["a", "b", "c", "d", "e"],
      ["e", "a", "x", "c"],
    ],
    [
      ["a", "a", "b"],
      ["b", "a", "a", "a"],
    ],
    [[], ["a"]],
    [["a"], []],
    [
      ["1", "2", "3", "4"],
      ["4", "3", "2", "1"],
    ],
  ])("reconstructs the after list from %j -> %j", (before, after) => {
    const result = diffPrimitiveList(before, after);
    const reconstructed = result.lines
      .filter((line) => line.kind !== "removed")
      .sort((a, b) => {
        const ai = "index" in a ? a.index : 0;
        const bi = "index" in b ? b.index : 0;
        return ai - bi;
      })
      .map((line) => (line.kind === "changed" ? line.after : line.value));
    expect(reconstructed).toEqual(after);
  });

  test("every removed line points at the item it removed", () => {
    const before = ["a", "b", "c", "d"];
    const result = diffPrimitiveList(before, ["a", "d"]);
    for (const line of result.lines) {
      if (line.kind === "removed") {
        expect(line.value).toBe(before[line.beforeIndex]);
      }
    }
  });

  test("every moved line points at the item it moved", () => {
    const before = ["a", "b", "c", "d"];
    const result = diffPrimitiveList(before, ["d", "c", "a", "b"]);
    for (const line of result.lines) {
      if (line.kind === "moved") {
        expect(line.value).toBe(before[line.beforeIndex]);
      }
    }
  });

  test("a list too long to match by content falls back, and says so", () => {
    const before = Array.from(
      { length: LIST_DIFF_MAX_ITEMS + 1 },
      (_, i) => `item-${i}`,
    );
    const after = [...before];
    after[3] = "edited";
    const result = diffPrimitiveList(before, after);
    expect(result.positional).toBe(true);
    // Still correct, just positional: one changed line and nothing else.
    expect(summarizeListDiff(result)).toEqual({
      added: 0,
      removed: 0,
      moved: 0,
      changed: 1,
      unchanged: LIST_DIFF_MAX_ITEMS,
    });
  });

  test("a list within the limit is matched by content", () => {
    const before = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const after = [before[49], ...before.slice(0, 49)];
    const result = diffPrimitiveList(before, after);
    expect(result.positional).toBe(false);
    expect(summarizeListDiff(result).moved).toBe(1);
  });
});

describe("summarizeListDiff", () => {
  test("counts each kind", () => {
    const result = diffPrimitiveList(["a", "b", "c", "d"], ["d", "a", "x"]);
    const counts = summarizeListDiff(result);
    expect(counts.added + counts.changed).toBeGreaterThan(0);
    expect(
      counts.added +
        counts.removed +
        counts.moved +
        counts.changed +
        counts.unchanged,
    ).toBe(result.lines.length);
  });
});
