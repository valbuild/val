import { parseSketch, type SketchNode } from "./sketchFormat";
import { checkSketch, docFromSketch, sketchFromDoc } from "./sketchpadDoc";

/** A sketch's blocks without their line numbers, which a rewrite moves. */
function shape(source: string): unknown {
  const strip = (node: SketchNode): unknown => {
    const { line, ...rest } = node;
    void line;
    return "children" in rest
      ? { ...rest, children: rest.children.map(strip) }
      : rest;
  };
  return parseSketch(source).blocks.map(strip);
}

const SKETCH = `# Our people
We are 40 people in Oslo.
[hero: The team](image: /public/val/team.jpg)
row
  col 2
    ## Design
    [list: Designers]
  col
    [video](video: /public/val/clip.mp4)
    [button: Join us]
\\row
row is a word here

icon hero M3 5h18v14H3z
icon list M8 6h13
`;

describe("the Sketchpad document", () => {
  test("reads and writes the text without losing anything", () => {
    const { doc, icons } = docFromSketch(SKETCH);
    const text = sketchFromDoc(doc, icons);
    expect(text).toBe(SKETCH);
    expect(shape(text)).toEqual(shape(SKETCH));
  });

  test("a row's children that are not columns stay in the row", () => {
    const { doc, icons } = docFromSketch("row\n  [button: A]\n  [button: B]");
    expect(sketchFromDoc(doc, icons)).toBe(
      "row\n  [button: A]\n  [button: B]\n",
    );
  });

  test("a col outside a row keeps what is in it", () => {
    const { doc, icons } = docFromSketch("col\n  Alone");
    expect(sketchFromDoc(doc, icons)).toBe("Alone\n");
  });

  test("an empty row or col gets somewhere to type", () => {
    const { doc } = docFromSketch("row");
    expect(doc.firstChild?.firstChild?.type.name).toBe("col");
    expect(doc.firstChild?.firstChild?.firstChild?.type.name).toBe("paragraph");
  });

  test("an empty sketch is one empty paragraph", () => {
    const { doc, icons } = docFromSketch("");
    expect(doc.childCount).toBe(1);
    expect(sketchFromDoc(doc, icons)).toBe("");
  });
});

describe("checkSketch", () => {
  test("a sketch as the Sketchpad writes it passes", () => {
    expect(checkSketch(SKETCH)).toEqual([]);
    expect(checkSketch("")).toEqual([]);
  });

  test.each([
    ["a tab", "row\n\tcol\n\t\tText\n", 2],
    ["three spaces", "row\n   col\n      Text\n", 2],
    ["a blank line between blocks", "# Title\n\nText\n", 2],
    ["an icon before the page", "icon hero M3 5h18\n[hero]\n", 1],
    ["an icon kind in capitals", "[hero]\n\nicon Hero M3 5h18\n", 3],
    ["no final newline", "# Title", 1],
    ["two final newlines", "# Title\n\n", 2],
    ["a kind of two words", "[team photo: Roof]\n", 1],
  ])("%s is refused, at the line to fix", (_, source, line) => {
    const errors = checkSketch(source);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(line);
  });

  test("a col outside a row is refused", () => {
    expect(checkSketch("col\n  Alone\n").map((e) => e.line)).toEqual([1]);
  });

  test("what the Sketchpad writes always passes", () => {
    for (const source of [
      "row\n\tcol\n\t\tText",
      "icon hero M3 5h18\n\n\n[hero: A]\n# B",
      "col\n  Alone",
    ]) {
      const { doc, icons } = docFromSketch(source);
      expect(checkSketch(sketchFromDoc(doc, icons))).toEqual([]);
    }
  });
});
