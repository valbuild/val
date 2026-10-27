import { lineDiff, type DiffLine } from "./lineDiff";

const text = (...lines: string[]) => lines.join("\n") + "\n";
/** A diff as one string a line, the way a reader sees it. */
const shown = (diff: DiffLine[]) =>
  diff.map((line) =>
    line.kind === "skip"
      ? `… ${line.count}`
      : `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} ${line.text}`,
  );

describe("a file against the site's copy of it", () => {
  test("a changed line is removed and added, with the lines around it", () => {
    expect(
      shown(
        lineDiff(
          text("import a", "function Home() {", "  <Quote />", "}"),
          text("import a", "function Home() {", "  <Testimonials />", "}"),
        ),
      ),
    ).toEqual([
      "  import a",
      "  function Home() {",
      "-   <Quote />",
      "+   <Testimonials />",
      "  }",
    ]);
  });

  test("an added file is all added, and a deleted one all removed", () => {
    expect(shown(lineDiff(null, text("a", "b")))).toEqual(["+ a", "+ b"]);
    expect(shown(lineDiff(text("a", "b"), null))).toEqual(["- a", "- b"]);
    expect(lineDiff(null, null)).toEqual([]);
  });

  test("lines the two share in the middle stay unchanged", () => {
    expect(
      shown(lineDiff(text("a", "b", "c", "d"), text("a", "x", "c", "y"))),
    ).toEqual(["  a", "- b", "+ x", "  c", "- d", "+ y"]);
  });

  test("long unchanged runs are folded, keeping three lines either side", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[10] = "changed";
    expect(shown(lineDiff(text(...before), text(...after)))).toEqual([
      "… 7",
      "  line 7",
      "  line 8",
      "  line 9",
      "- line 10",
      "+ changed",
      "  line 11",
      "  line 12",
      "  line 13",
      "… 6",
    ]);
  });

  test("the same text is no change at all", () => {
    expect(lineDiff(text("a", "b"), text("a", "b"))).toEqual([
      { kind: "skip", count: 2 },
    ]);
  });

  test("a final newline is not a line of its own", () => {
    expect(shown(lineDiff("a", "a\n"))).toEqual(["… 1"]);
  });
});
