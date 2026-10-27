import {
  formatPlaceholder,
  formatText,
  parseSketch,
  renderSketchAscii,
  replaceLine,
} from "./sketchFormat";

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
                media: null,
              },
            ],
          },
        ],
      },
      {
        type: "placeholder",
        line: 7,
        kind: "button",
        label: null,
        media: null,
      },
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

describe("icons and media", () => {
  test("an icon line draws every box of its kind and is not a block", () => {
    const { blocks, icons, errors } = parseSketch(
      "icon Stat M3 17l6-6 4 4 8-8\n[stat: Visitors]",
    );
    expect(errors).toEqual([]);
    expect(icons).toEqual({ stat: "M3 17l6-6 4 4 8-8" });
    expect(blocks.map((b) => b.type)).toEqual(["placeholder"]);
  });

  test("an icon may only be path data", () => {
    const { icons, errors } = parseSketch(
      'icon stat M3 17<script>alert("x")</script>',
    );
    expect(icons).toEqual({});
    expect(errors.map((e) => e.line)).toEqual([1]);
  });

  test("prose that starts with the word icon stays text", () => {
    expect(parseSketch("icon of the brand").blocks).toEqual([
      { type: "text", line: 1, level: 0, text: "icon of the brand" },
    ]);
  });

  test("a box can hold an image or a video", () => {
    const { blocks, errors } = parseSketch(
      "[hero: Roof](image: /public/val/roof.jpg)\n[clip](video: blob:http://x/1)",
    );
    expect(errors).toEqual([]);
    expect(blocks).toEqual([
      {
        type: "placeholder",
        line: 1,
        kind: "hero",
        label: "Roof",
        media: { type: "image", src: "/public/val/roof.jpg" },
      },
      {
        type: "placeholder",
        line: 2,
        kind: "clip",
        label: null,
        media: { type: "video", src: "blob:http://x/1" },
      },
    ]);
  });

  test("media written any other way is reported", () => {
    const { errors } = parseSketch("[hero](/public/val/roof.jpg)");
    expect(errors.map((e) => e.line)).toEqual([1]);
  });
});

describe("writing back", () => {
  test("what is formatted parses back to the same thing", () => {
    const placeholder = {
      kind: "hero",
      label: "Team [on] the roof",
      media: { type: "image" as const, src: "/a b.jpg" },
    };
    const line = formatPlaceholder(placeholder);
    expect(line).toBe("[hero: Team on the roof](image: /a%20b.jpg)");
    expect(parseSketch(line).blocks[0]).toMatchObject({
      label: "Team on the roof",
      media: { type: "image", src: "/a%20b.jpg" },
    });
  });

  test("a paragraph that reads like something else is escaped", () => {
    for (const text of ["row", "## not a heading", "[not a box]"]) {
      expect(parseSketch(formatText(0, text)).blocks).toEqual([
        { type: "text", line: 1, level: 0, text },
      ]);
    }
    expect(formatText(2, "Two\nlines")).toBe("## Two lines");
  });

  test("replacing a line keeps its indent", () => {
    expect(replaceLine("row\n  col\n    Old", 3, "New")).toBe(
      "row\n  col\n    New",
    );
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
