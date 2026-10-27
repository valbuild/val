import { parseSketch, renderSketchAscii } from "./pageSketch";

describe("parseSketch", () => {
  test("reads the four primitives and nests by indent", () => {
    const { blocks, errors } = parseSketch(
      [
        "# Our people",
        "row",
        "  col 2",
        "    We are 40 people.",
        "  col",
        "    [image: Team photo]",
        "[button]",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(blocks).toEqual([
      { type: "text", line: 1, level: 1, text: "Our people" },
      {
        type: "row",
        line: 2,
        children: [
          {
            type: "col",
            line: 3,
            weight: 2,
            children: [
              { type: "text", line: 4, level: 0, text: "We are 40 people." },
            ],
          },
          {
            type: "col",
            line: 5,
            weight: 1,
            children: [
              {
                type: "placeholder",
                line: 6,
                kind: "image",
                label: "Team photo",
              },
            ],
          },
        ],
      },
      { type: "placeholder", line: 7, kind: "button", label: null },
    ]);
  });

  test("a line indented under text is reported and kept as a sibling", () => {
    const { blocks, errors } = parseSketch("Intro\n  Indented");
    expect(errors.map((e) => e.line)).toEqual([2]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "text"]);
  });

  test("an unclosed placeholder is reported and shown as text", () => {
    const { blocks, errors } = parseSketch("[image: Team photo");
    expect(errors.map((e) => e.line)).toEqual([1]);
    expect(blocks).toEqual([
      { type: "text", line: 1, level: 0, text: "[image: Team photo" },
    ]);
  });

  test("a backslash keeps a keyword as text", () => {
    expect(parseSketch("\\row").blocks).toEqual([
      { type: "text", line: 1, level: 0, text: "row" },
    ]);
  });

  test("dedenting closes containers", () => {
    const { blocks } = parseSketch("row\n  col\n    A\n  col\n    B\nC");
    expect(blocks.map((b) => b.type)).toEqual(["row", "text"]);
  });
});

describe("renderSketchAscii", () => {
  test("puts columns side by side within the width", () => {
    const { blocks } = parseSketch(
      "## Team\nrow\n  col\n    Left side\n  col\n    [image: Photo]",
    );
    const ascii = renderSketchAscii(blocks, 40);
    for (const line of ascii.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(ascii).toMatchInlineSnapshot(`
     "Team
     ----

     Left side            +-----------------+
                          |                 |
                          |     [image]     |
                          |      Photo      |
                          |                 |
                          |                 |
                          +-----------------+"
    `);
  });
});
