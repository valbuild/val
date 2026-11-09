import {
  sketchFieldTexts,
  checkSketch,
  formatSketch,
  sketchRoutes,
  sketchTitle,
  formatSketchBox,
  formatSketchText,
  parseSketch,
} from "./sketchFormat";

describe("parseSketch", () => {
  test("reads the four primitives and nests by indent", () => {
    const { blocks, errors } = parseSketch(
      [
        "# Our people",
        "row",
        "  col",
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
            children: [
              { type: "text", line: 4, level: 0, text: "We are 40 people." },
            ],
          },
          {
            type: "col",
            line: 5,
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

  test("a col outside a row is reported", () => {
    expect(parseSketch("col\n  Alone").errors.map((e) => e.line)).toEqual([1]);
    expect(
      parseSketch("row\n  col\n    col").errors.map((e) => e.line),
    ).toEqual([3]);
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
    const line = formatSketchBox(placeholder);
    expect(line).toBe("[hero: Team on the roof](image: /a%20b.jpg)");
    expect(parseSketch(line).blocks[0]).toMatchObject({
      label: "Team on the roof",
      media: { type: "image", src: "/a%20b.jpg" },
    });
  });

  test("a paragraph that reads like something else is escaped", () => {
    for (const text of ["row", "## not a heading", "[not a box]"]) {
      expect(parseSketch(formatSketchText(0, text)).blocks).toEqual([
        { type: "text", line: 1, level: 0, text },
      ]);
    }
    expect(formatSketchText(2, "Two\nlines")).toBe("## Two lines");
  });
});

describe("checkSketch", () => {
  test("a sketch as the Sketchpad writes it passes", () => {
    expect(
      checkSketch(
        "# Title\nrow\n  col\n    [hero: A](image: /a.jpg)\n  col\n    Text\n\nicon hero M3 5h18\n",
      ),
    ).toEqual([]);
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

  test("what formatSketch writes always passes", () => {
    for (const source of [
      "row\n\tcol\n\t\tText",
      "icon hero M3 5h18\n\n\n[hero: A]\n# B",
      "row\n",
    ]) {
      const { blocks, icons } = parseSketch(source);
      expect(checkSketch(formatSketch(blocks, icons))).toEqual([]);
    }
  });

  test("a row directly in a row is refused", () => {
    expect(checkSketch("row\n  row\n    col\n").map((e) => e.line)).toEqual([
      2,
    ]);
  });
});

describe("sketchTitle", () => {
  test("is the biggest top-level heading", () => {
    expect(sketchTitle(parseSketch("Intro\n## Sub\n# Main\n").blocks)).toBe(
      "Main",
    );
    expect(sketchTitle(parseSketch("## Sub\n").blocks)).toBe("Sub");
    expect(sketchTitle(parseSketch("Just text\n").blocks)).toBeNull();
  });
});

describe("route dividers", () => {
  const SKETCH = [
    "# Shared intro",
    "--- /",
    "# Home",
    "row",
    "  col",
    "    [hero: Welcome](image: /public/val/hero.webp)",
    "--- /about",
    "## About us",
    "[team](image: session:3f2a.webp)",
    "",
  ].join("\n");

  test("start the part about a page, and one sketch can name several", () => {
    const { blocks, errors } = parseSketch(SKETCH);
    expect(errors).toEqual([]);
    expect(sketchRoutes(blocks)).toEqual(["/", "/about"]);
    // A divider closes the row above it: what follows is another page.
    expect(blocks.map((b) => b.type)).toEqual([
      "text",
      "route",
      "text",
      "row",
      "route",
      "text",
      "placeholder",
    ]);
  });

  test("are written one way", () => {
    expect(checkSketch(SKETCH)).toEqual([]);
    const { blocks, icons } = parseSketch(SKETCH);
    expect(formatSketch(blocks, icons)).toBe(SKETCH);
  });

  test.each([
    ["no route", "---\n", "names one page"],
    ["not a route", "--- about\n", "names one page"],
    ["indented", "row\n  col\n    --- /about\n", "top level"],
  ])("say what is wrong: %s", (_, source, message) => {
    expect(checkSketch(source)[0].message).toContain(message);
  });

  test("a paragraph that would read as one is kept as text", () => {
    expect(formatSketchText(0, "--- not a route")).toBe("\\--- not a route");
  });
});

describe("columns", () => {
  test("share a row equally: a col takes no number", () => {
    expect(checkSketch("row\n  col 2\n    Text\n")[0]).toEqual({
      line: 2,
      message:
        'Columns share a row equally, so a col takes no number: write "col".',
    });
  });
});

describe("text linked to a field", () => {
  const field = '/content/home.val.ts?p="hero"."title"';

  test("is read, written back the one way, and named by field", () => {
    const text = `--- /\n# Welcome {field: ${field}}\nrow\n  col\n    \\[things] {field: /content/home.val.ts?p="intro"}\n`;
    const parsed = parseSketch(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.blocks[1]).toEqual({
      type: "text",
      line: 2,
      level: 1,
      text: "Welcome",
      field,
    });
    expect(formatSketch(parsed.blocks, parsed.icons)).toBe(text);
    expect(checkSketch(text)).toEqual([]);
    expect(sketchFieldTexts(parsed.blocks)).toEqual(
      new Map([
        [field, "Welcome"],
        ['/content/home.val.ts?p="intro"', "[things]"],
      ]),
    );
  });

  test("one block per field: a second link is not written", () => {
    const parsed = parseSketch(
      `# One {field: ${field}}\nTwo {field: ${field}}\n`,
    );
    expect(formatSketch(parsed.blocks, parsed.icons)).toBe(
      `# One {field: ${field}}\nTwo\n`,
    );
  });

  test("survives text that looks like a link, or like something else", () => {
    for (const [text, link] of [
      ["Hello {field: x}", undefined],
      ["icon x M", field],
      ["a {field: b}", field],
      ["--- /about", field],
    ] as const) {
      const line = formatSketchText(0, text, link) + "\n";
      expect(checkSketch(line)).toEqual([]);
      expect(parseSketch(line).blocks).toEqual([
        {
          type: "text",
          line: 1,
          level: 0,
          text,
          ...(link ? { field: link } : {}),
        },
      ]);
    }
  });

  test("only text is linked", () => {
    expect(parseSketch(`[hero: Big] {field: ${field}}\n`).errors).toEqual([
      expect.objectContaining({ line: 1 }),
    ]);
  });
});
