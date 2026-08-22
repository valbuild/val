import { SvgOptions } from "@valbuild/core";
import { parseSvg } from "./parseSvg";
import { decodeXmlEntities } from "./xml";
import { svgToString } from "./svgToString";
import { normalizeColor } from "./colors";

const options: SvgOptions = {
  variables: {
    brand: "#0055ff",
    line: "currentColor",
    surface: { value: "#ffffff", match: ["#fefefe"] },
    warn: { value: "#ff8800", tolerance: 0.05 },
  },
};

function parse(markup: string, overrides = {}) {
  return parseSvg(markup, options, { overrides });
}

describe("normalizeColor", () => {
  test.each([
    ["#FFF", "#ffffff"],
    ["#ffffff", "#ffffff"],
    ["white", "#ffffff"],
    ["rgb(255, 255, 255)", "#ffffff"],
    ["rgb(100%, 100%, 100%)", "#ffffff"],
    ["hsl(0, 0%, 100%)", "#ffffff"],
    ["#0AF", "#00aaff"],
    ["rgba(0, 0, 0, 0.5)", "#00000080"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeColor(input)).toBe(expected);
  });

  test("returns null for spellings it does not understand", () => {
    expect(normalizeColor("currentColor")).toBe(null);
    expect(normalizeColor("url(#grad)")).toBe(null);
    expect(normalizeColor("")).toBe(null);
  });
});

describe("parseSvg", () => {
  test("parses a typical export and maps colors onto variables", () => {
    const result = parse(`<?xml version="1.0" encoding="UTF-8"?>
      <!-- Exported from a design tool -->
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 12h16" stroke="#0055FF" stroke-width="2" fill="none"/>
      </svg>`);
    expect(result).toMatchObject({
      status: "success",
      unmatched: [],
      source: {
        viewBox: "0 0 24 24",
        width: 24,
        height: 24,
        children: [
          {
            tag: "path",
            attrs: {
              d: "M4 12h16",
              stroke: { var: "brand" },
              "stroke-width": 2,
              fill: "none",
            },
            children: [],
          },
        ],
      },
    });
  });

  test("matches a color listed in a variable's match aliases", () => {
    const result = parse(
      `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#FEFEFE"/></svg>`,
    );
    expect(result).toMatchObject({
      status: "success",
      source: { children: [{ attrs: { fill: { var: "surface" } } }] },
    });
  });

  test("matches a near color only when the variable opted in with tolerance", () => {
    const near = parse(
      `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#ff8a02"/></svg>`,
    );
    expect(near).toMatchObject({
      status: "success",
      source: { children: [{ attrs: { fill: { var: "warn" } } }] },
    });
    // brand has no tolerance, so a color near it is reported instead of snapped
    const nearBrand = parse(
      `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#0056ff"/></svg>`,
    );
    expect(nearBrand).toMatchObject({
      status: "success",
      unmatched: [{ raw: "#0056ff", normalized: "#0056ff", count: 1 }],
    });
  });

  test("keeps the color keywords verbatim", () => {
    const result = parse(
      `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="none" stroke="currentColor"/></svg>`,
    );
    expect(result).toMatchObject({
      status: "success",
      source: {
        children: [{ attrs: { fill: "none", stroke: "currentColor" } }],
      },
    });
  });

  test("reports unmatched colors once, with a use count", () => {
    const result = parse(`<svg viewBox="0 0 8 8">
      <circle cx="2" cy="2" r="1" fill="#ff0000"/>
      <circle cx="6" cy="6" r="1" fill="#FF0000"/>
    </svg>`);
    expect(result).toMatchObject({
      status: "success",
      unmatched: [{ raw: "#ff0000", normalized: "#ff0000", count: 2 }],
    });
    if (result.status !== "success") throw new Error("unreachable");
    // the attribute is left off entirely until the caller decides
    expect(result.source.children[0].attrs).not.toHaveProperty("fill");
  });

  test("applies caller supplied overrides for unmatched colors", () => {
    const markup = `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#ff0000"/></svg>`;
    expect(
      parse(markup, { "#ff0000": { type: "var", var: "brand" } }),
    ).toMatchObject({
      status: "success",
      unmatched: [],
      source: { children: [{ attrs: { fill: { var: "brand" } } }] },
    });
    expect(
      parse(markup, {
        "#ff0000": { type: "keyword", keyword: "currentColor" },
      }),
    ).toMatchObject({
      status: "success",
      source: { children: [{ attrs: { fill: "currentColor" } }] },
    });
  });

  test("derives a viewBox from width and height when there is none", () => {
    expect(parse(`<svg width="16" height="16"><g/></svg>`)).toMatchObject({
      status: "success",
      source: { viewBox: "0 0 16 16" },
    });
  });

  test("normalizes whitespace and commas in the viewBox", () => {
    expect(parse(`<svg viewBox="0,0,  24, 24"><g/></svg>`)).toMatchObject({
      status: "success",
      source: { viewBox: "0 0 24 24" },
    });
  });

  test("handles self closing tags, entities and comments", () => {
    const result = parse(
      `<svg viewBox="0 0 8 8"><!-- c --><g transform="translate(1 1)"><circle cx="4" cy="4" r="2"/></g></svg>`,
    );
    expect(result).toMatchObject({
      status: "success",
      source: {
        children: [
          {
            tag: "g",
            attrs: { transform: "translate(1 1)" },
            children: [{ tag: "circle" }],
          },
        ],
      },
    });
  });

  describe("the allowlist", () => {
    test("drops unsupported elements", () => {
      const result = parse(`<svg viewBox="0 0 8 8">
        <script>alert(1)</script>
        <style>svg{color:red}</style>
        <foreignObject><div/></foreignObject>
        <image href="https://example.com/x.png"/>
        <a href="javascript:alert(1)"><circle cx="1" cy="1" r="1"/></a>
        <circle cx="4" cy="4" r="4"/>
      </svg>`);
      if (result.status !== "success") throw new Error(result.message);
      expect(result.source.children).toHaveLength(1);
      expect(result.droppedTags).toStrictEqual([
        "script",
        "style",
        "foreignObject",
        "image",
        "a",
      ]);
    });

    test("drops event handlers and other unsupported attributes", () => {
      const result = parse(
        `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" onload="alert(1)" onclick="x()" style="fill:red" id="a" class="b" xlink:href="#c" data-x="1"/></svg>`,
      );
      if (result.status !== "success") throw new Error(result.message);
      expect(result.source.children[0].attrs).toStrictEqual({
        cx: 4,
        cy: 4,
        r: 4,
      });
      expect(result.droppedAttrs.map((a) => a.attr).sort()).toStrictEqual([
        "class",
        "data-x",
        "id",
        "onclick",
        "onload",
        "style",
        "xlink:href",
      ]);
    });

    test("drops a d attribute containing characters a path cannot have", () => {
      const result = parse(
        `<svg viewBox="0 0 8 8"><path d="M0 0 url(javascript:alert(1))"/></svg>`,
      );
      if (result.status !== "success") throw new Error(result.message);
      expect(result.source.children[0].attrs).not.toHaveProperty("d");
    });

    test("drops an out of range enum value", () => {
      const result = parse(
        `<svg viewBox="0 0 8 8"><path d="M0 0" stroke-linecap="nope"/></svg>`,
      );
      if (result.status !== "success") throw new Error(result.message);
      expect(result.source.children[0].attrs).not.toHaveProperty(
        "stroke-linecap",
      );
    });
  });

  describe("rejections", () => {
    test.each([
      [
        "entity declarations",
        `<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>`,
      ],
      [
        "a doctype with an internal subset",
        `<!DOCTYPE svg [ <!-- x --> ]><svg viewBox="0 0 1 1"/>`,
      ],
      ["an unclosed tag", `<svg viewBox="0 0 1 1"><g>`],
      ["a mismatched closing tag", `<svg viewBox="0 0 1 1"><g></path></svg>`],
      ["a non svg root", `<div><svg viewBox="0 0 1 1"/></div>`],
      ["no viewBox and no size", `<svg><g/></svg>`],
      ["a malformed viewBox", `<svg viewBox="nope"><g/></svg>`],
      ["empty input", ``],
    ])("rejects %s", (_name, markup) => {
      expect(parse(markup).status).toBe("error");
    });

    test("rejects an svg that exceeds the node budget", () => {
      const many = Array.from(
        { length: 30 },
        () => `<circle cx="1" cy="1" r="1"/>`,
      ).join("");
      const result = parseSvg(`<svg viewBox="0 0 8 8">${many}</svg>`, {
        maxNodes: 10,
      });
      expect(result).toMatchObject({ status: "error" });
    });

    test("rejects an svg nested deeper than the budget", () => {
      const deep = "<g>".repeat(10) + "</g>".repeat(10);
      const result = parseSvg(`<svg viewBox="0 0 8 8">${deep}</svg>`, {
        maxDepth: 3,
      });
      expect(result).toMatchObject({ status: "error" });
    });

    test("rejects a d attribute larger than the cap", () => {
      const huge = "M0 0 " + "L1 1 ".repeat(30_000);
      const result = parse(`<svg viewBox="0 0 8 8"><path d="${huge}"/></svg>`);
      if (result.status !== "success") throw new Error(result.message);
      expect(result.source.children[0].attrs).not.toHaveProperty("d");
    });
  });
});

describe("decodeXmlEntities", () => {
  test("decodes the named and numeric entities it knows", () => {
    expect(
      decodeXmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"),
    ).toBe(`a & b <c> "d" 'e'`);
    expect(decodeXmlEntities("&#65;&#x42;")).toBe("AB");
    expect(decodeXmlEntities("&#x1F600;")).toBe("\u{1F600}");
  });

  test("leaves an out-of-range numeric entity alone instead of throwing", () => {
    // `String.fromCodePoint` throws a RangeError above 0x10FFFF, and these all
    // parse to finite numbers - so an unguarded call crashes the parse of any
    // svg that contains one.
    for (const value of [
      "&#1114112;",
      "&#x110000;",
      "&#x7FFFFFFF;",
      "&#99999999999;",
    ]) {
      expect(decodeXmlEntities(value)).toBe(value);
    }
  });

  test("leaves an unknown named entity alone", () => {
    expect(decodeXmlEntities("&nbsp;&foo;")).toBe("&nbsp;&foo;");
  });

  test("leaves an uppercase-X hex entity alone", () => {
    // Not a legal XML character reference (the production is lowercase `x`), so
    // it stays as written rather than being decoded.
    expect(decodeXmlEntities("&#X43;")).toBe("&#X43;");
  });

  test("an out-of-range entity in markup parses rather than crashing", () => {
    expect(() =>
      parse(`<svg viewBox="0 0 8 8"><title>&#x110000;</title></svg>`),
    ).not.toThrow();
  });
});

describe("svgToString", () => {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <g transform="translate(1 1)">
    <path d="M4 12h16" stroke="var(--val-svg-brand, currentColor)" stroke-width="2" fill="none"/>
  </g>
</svg>`;

  test("round trips parse -> string -> parse", () => {
    const first = parse(markup);
    if (first.status !== "success") throw new Error(first.message);
    const printed = svgToString(first.source, { pretty: true });
    expect(printed).toBe(markup);
    const second = parse(printed);
    if (second.status !== "success") throw new Error(second.message);
    expect(second.source).toStrictEqual(first.source);
  });

  test("resolves variables to concrete colors when asked", () => {
    const result = parse(
      `<svg viewBox="0 0 24 24"><path d="M4 12h16" stroke="#0055ff"/></svg>`,
    );
    if (result.status !== "success") throw new Error(result.message);
    expect(
      svgToString(result.source, { variables: options.variables }),
    ).toContain('stroke="#0055ff"');
  });

  test("escapes attribute values", () => {
    expect(
      svgToString({
        viewBox: '0 0 1 1" onload="alert(1)',
        width: null,
        height: null,
        children: [],
      }),
    ).not.toContain('onload="alert(1)"');
  });
});
