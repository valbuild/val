import { AnyRichTextOptions, RichText, RichTextSource } from "@valbuild/core";
import {
  fromLexical,
  fromLexicalFormat,
  toLexical,
  toLexicalFormat,
} from "./conversion";

describe("richtext conversion", () => {
  test("format conversion", () => {
    //
    expect(toLexicalFormat([])).toStrictEqual(0);
    expect(toLexicalFormat(["bold"])).toStrictEqual(1);
    expect(toLexicalFormat(["italic"])).toStrictEqual(2);
    expect(toLexicalFormat(["bold", "italic"])).toStrictEqual(3);
    expect(toLexicalFormat(["line-through"])).toStrictEqual(4);
    expect(toLexicalFormat(["bold", "line-through"])).toStrictEqual(5);
    expect(toLexicalFormat(["italic", "line-through"])).toStrictEqual(6);
    expect(toLexicalFormat(["bold", "italic", "line-through"])).toStrictEqual(
      7
    );
    //
    expect(fromLexicalFormat(0)).toStrictEqual([]);
    expect(fromLexicalFormat(1)).toStrictEqual(["bold"]);
    expect(fromLexicalFormat(2)).toStrictEqual(["italic"]);
    expect(fromLexicalFormat(3)).toStrictEqual(["bold", "italic"]);
    expect(fromLexicalFormat(4)).toStrictEqual(["line-through"]);
    expect(fromLexicalFormat(5)).toStrictEqual(["bold", "line-through"]);
    expect(fromLexicalFormat(6)).toStrictEqual(["italic", "line-through"]);
    expect(fromLexicalFormat(7)).toStrictEqual([
      "bold",
      "italic",
      "line-through",
    ]);
  });
  test("basic lexical text conversion to <-> from", () => {
    const input: RichTextSource<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        { tag: "h1", children: ["Title 1"] },
        { tag: "h2", children: ["Title 2"] },
        { tag: "h3", children: ["Title 3"] },
        { tag: "h4", children: ["Title 4"] },
        { tag: "h5", children: ["Title 5"] },
        { tag: "h6", children: ["Title 6"] },
        {
          tag: "p",
          children: [
            {
              tag: "span",
              classes: ["bold", "italic", "line-through"],
              children: ["Formatted span"],
            },
          ],
        },
        { tag: "br", children: [] },
        { tag: "br", children: [] },
        { _type: "link", href: "https://example.com", text: "Link" },
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [
                {
                  tag: "ol",
                  dir: "rtl",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "span",
                          classes: ["italic"],
                          children: ["number 1.1"],
                        },
                      ],
                    },
                    { tag: "li", children: ["number 1.2"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(fromLexical(toLexical(input)).node).toStrictEqual(input);
  });

  // Uncertain whether Val RichText text nodes should allow nested spans - remove this test if that is not the case anymore
  test("merged lexical text nodes to <-> from", () => {
    const input: RichTextSource<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        {
          tag: "p",
          children: [
            {
              tag: "span",
              classes: ["bold", "line-through"],
              children: [
                {
                  tag: "span",
                  classes: ["italic"],
                  children: ["Formatted nested span"],
                },
              ],
            },
          ],
        },
      ],
    };

    // See inline comments for what changed between input / output
    const output: RichText<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        {
          tag: "p",
          children: [
            {
              tag: "span",
              classes: ["bold", "italic", "line-through"], // NOTE: classes was merged
              children: ["Formatted nested span"],
            },
          ],
        },
      ],
    };

    expect(fromLexical(toLexical(input)).node).toStrictEqual(output);
  });
});
