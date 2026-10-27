import { parseSketch, type SketchNode } from "./sketchFormat";
import { docFromSketch, sketchFromDoc } from "./sketchpadDoc";

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
    expect(sketchFromDoc(doc, icons)).toBe("\n");
  });
});
