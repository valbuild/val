import { isWorthDiffing, valueDiff, wordDiff } from "./wordDiff";

/** Reconstruct one side from the segments, the way the two cells render them. */
function side(
  segments: { text: string; kind: string }[],
  which: "before" | "after",
): string {
  const drop = which === "before" ? "added" : "removed";
  return segments
    .filter((segment) => segment.kind !== drop)
    .map((segment) => segment.text)
    .join("");
}

describe("wordDiff", () => {
  /**
   * The invariant that matters more than any particular grouping: whatever the
   * diff decides, rendering it must reproduce the two stored values exactly. A
   * review screen that shows a value which is not the stored value is worse
   * than one that shows no diff at all.
   */
  test("both sides reconstruct exactly", () => {
    const cases: [string, string][] = [
      ["Content, super-charged", "Content, super-charged — and yours to edit"],
      ["hsl(217 91% 60%)", "hsl(262 83% 58%)"],
      ["  leading and   irregular  spacing ", "leading and irregular spacing"],
      ["", "New in 0.125"],
      ["Requires the beta channel.", ""],
      ["one two three", "three two one"],
    ];
    for (const [before, after] of cases) {
      const segments = wordDiff(before, after);
      expect(side(segments, "before")).toBe(before);
      expect(side(segments, "after")).toBe(after);
    }
  });

  test("an appended clause is the only thing marked added", () => {
    const segments = wordDiff(
      "Content, super-charged",
      "Content, super-charged — and yours to edit",
    );

    expect(segments.filter((s) => s.kind === "removed")).toEqual([]);
    expect(
      segments
        .filter((s) => s.kind === "added")
        .map((s) => s.text)
        .join(""),
    ).toBe(" — and yours to edit");
  });

  test("identical values produce one unchanged segment", () => {
    expect(wordDiff("same", "same")).toEqual([{ text: "same", kind: "same" }]);
  });

  test("runs of the same kind are merged into one segment", () => {
    // Otherwise every word and every space becomes its own highlighted span,
    // which reads as confetti and defeats the point of diffing by word.
    const segments = wordDiff("a", "a b c d");

    expect(segments).toHaveLength(2);
    expect(segments[1]).toEqual({ text: " b c d", kind: "added" });
  });

  test("gives up rather than building a huge table", () => {
    // Quadratic in the token counts, so past the cap the fallback is what the
    // view did before: the whole old value and the whole new one.
    const long = Array.from({ length: 900 }, (_, i) => `w${i}`).join(" ");
    const segments = wordDiff(long, long + " tail");

    expect(segments.map((s) => s.kind)).toEqual(["removed", "added"]);
    expect(side(segments, "before")).toBe(long);
  });
});

/**
 * Words for prose, characters for identifiers.
 *
 * The two values that forced the second pass are a colour and a slug: neither
 * shares a whole word with its replacement, and both are obviously the same
 * value with a few characters changed.
 */
describe("valueDiff", () => {
  test("falls back to characters for a colour", () => {
    const segments = valueDiff("hsl(217 91% 60%)", "hsl(262 83% 58%)");

    expect(isWorthDiffing(segments)).toBe(true);
    expect(side(segments, "before")).toBe("hsl(217 91% 60%)");
    expect(side(segments, "after")).toBe("hsl(262 83% 58%)");
    // "hsl(2" survives on both sides, which is the anchor a reader needs.
    expect(segments[0]).toEqual({ text: "hsl(2", kind: "same" });
  });

  test("falls back to characters for a renamed slug", () => {
    const segments = valueDiff(
      "/blogs/history-restore",
      "/blogs/history-and-restore",
    );

    expect(isWorthDiffing(segments)).toBe(true);
    expect(side(segments, "before")).toBe("/blogs/history-restore");
    expect(side(segments, "after")).toBe("/blogs/history-and-restore");
  });

  test("keeps the word diff for prose that shares words", () => {
    const before = "Content, super-charged";
    const after = "Content, super-charged — and yours to edit";

    expect(valueDiff(before, after)).toEqual(wordDiff(before, after));
  });

  test("refuses a character diff on a long value", () => {
    // Past the identifier length a character diff is confetti, so two prose
    // values with no shared word get no highlighting rather than bad
    // highlighting.
    const before = "a".repeat(60) + " " + "b".repeat(60);
    const after = "c".repeat(60) + " " + "d".repeat(60);

    expect(isWorthDiffing(valueDiff(before, after))).toBe(false);
  });
});

describe("isWorthDiffing", () => {
  test("a wholesale replacement is not worth diffing", () => {
    // One removed run beside one added run is exactly what the two columns
    // already show; highlighting all of both says "look here" about everything.
    expect(isWorthDiffing(wordDiff("draft", "published"))).toBe(false);
  });

  test("shared whitespace alone does not count", () => {
    // Two values sharing only the spaces between their words share nothing a
    // reader can use.
    expect(isWorthDiffing(wordDiff("alpha beta", "gamma delta"))).toBe(false);
  });
});
