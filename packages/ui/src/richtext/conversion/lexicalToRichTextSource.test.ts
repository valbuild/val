import { AnyRichTextOptions, initVal, RichText } from "@valbuild/core";
import { parseRichTextSource } from "./parseRichTextSource";
import { LexicalRootNode, toLexicalNode } from "./toLexical";

const { val } = initVal();

describe("lexical to RichTextSource", () => {
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
                      children: ["List 1.2"],
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
