import { AnyRichTextOptions, RichText } from "@valbuild/core";
import {
  fromLexical,
  fromLexicalFormat,
  fromLexicalNode,
  toLexical,
  toLexicalFormat,
  toLexicalNode,
} from "./conversion";

describe("richtext conversion", () => {
  test("format conversion", () => {
    //
    expect(toLexicalFormat([])).toStrictEqual(0);
    expect(toLexicalFormat(["font-bold"])).toStrictEqual(1);
    expect(toLexicalFormat(["italic"])).toStrictEqual(2);
    expect(toLexicalFormat(["font-bold", "italic"])).toStrictEqual(3);
    expect(toLexicalFormat(["line-through"])).toStrictEqual(4);
    expect(toLexicalFormat(["font-bold", "line-through"])).toStrictEqual(5);
    expect(toLexicalFormat(["italic", "line-through"])).toStrictEqual(6);
    expect(
      toLexicalFormat(["font-bold", "italic", "line-through"])
    ).toStrictEqual(7);
    //
    expect(fromLexicalFormat(0)).toStrictEqual([]);
    expect(fromLexicalFormat(1)).toStrictEqual(["font-bold"]);
    expect(fromLexicalFormat(2)).toStrictEqual(["italic"]);
    expect(fromLexicalFormat(3)).toStrictEqual(["font-bold", "italic"]);
    expect(fromLexicalFormat(4)).toStrictEqual(["line-through"]);
    expect(fromLexicalFormat(5)).toStrictEqual(["font-bold", "line-through"]);
    expect(fromLexicalFormat(6)).toStrictEqual(["italic", "line-through"]);
    expect(fromLexicalFormat(7)).toStrictEqual([
      "font-bold",
      "italic",
      "line-through",
    ]);
  });
  test("basic lexical text conversion to <-> from", () => {
    const input: RichText<AnyRichTextOptions> = {
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
              classes: ["font-bold", "italic", "line-through"],
              children: ["Formatted span"],
            },
          ],
        },
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

    expect(fromLexical(toLexical(input))).toStrictEqual(input);
  });

  // Uncertain whether Val RichText text nodes should allow nested spans - remove this test if that is not the case anymore
  test("merged lexical text nodes to <-> from", () => {
    const input: RichText<AnyRichTextOptions> = {
      _type: "richtext",
      children: [
        {
          tag: "p",
          children: [
            {
              tag: "span",
              classes: ["font-bold", "line-through"],
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
              classes: ["font-bold", "italic", "line-through"], // NOTE: classes was merged
              children: ["Formatted nested span"],
            },
          ],
        },
      ],
    };

    expect(fromLexical(toLexical(input))).toStrictEqual(output);
  });
});
