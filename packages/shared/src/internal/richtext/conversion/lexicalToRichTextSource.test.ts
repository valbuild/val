import { initVal } from "@valbuild/core";
import { fromLexicalFormat } from "./lexicalToRichTextSource";
import { parseRichTextSource } from "./parseRichTextSource";

const { val } = initVal();

describe("lexical to RichTextSource", () => {
  test("from lexical format", () => {
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

  test("parse empty richtext source", () => {
    const output = parseRichTextSource({
      _type: "richtext",
      templateStrings: [""],
      exprs: [],
    });
    expect(output).toStrictEqual({ _type: "richtext", children: [] });
  });

  test("parse basic richtext source", () => {
    const output = parseRichTextSource<{
      a: true;
      li: true;
      ul: true;
      heading: ["h1"];
    }>(val.richtext`
# Title 1

${val.link("**link**", { href: "https://link.com" })}

<br>

- List 1
    1. List 1.1
    1. List 1.2
Test 123
`);
    expect(output).toStrictEqual({
      _type: "richtext",
      children: [
        {
          tag: "h1",
          children: ["Title 1"],
        },
        {
          tag: "p",
          children: [
            {
              tag: "a",
              href: "https://link.com",
              children: [
                {
                  tag: "span",
                  classes: ["bold"],
                  children: ["link"],
                },
              ],
            },
          ],
        },
        { tag: "br", children: [] },
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [
                "List 1",
                {
                  tag: "ol",
                  children: [
                    {
                      tag: "li",
                      children: ["List 1.1"],
                    },
                    {
                      tag: "li",
                      children: [
                        "List 1.2",
                        { tag: "br", children: [] },
                        "Test 123",
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
