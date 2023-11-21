import { RichText, AnyRichTextOptions } from "@valbuild/core";
import {
  toLexicalFormat,
  richTextSourceToLexical,
  LexicalRootNode,
} from "./richTextSourceToLexical";

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
  });

  test("basic toLexical", () => {
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
              classes: ["bold", "italic", "line-through"],
              children: ["Formatted span"],
            },
          ],
        },
        {
          tag: "p",
          children: ["Inline line break", { tag: "br", children: [] }],
        },
        { tag: "br", children: [] },
        { tag: "br", children: [] },
        {
          tag: "p",
          children: [
            { tag: "a", href: "https://example.com", children: ["Link"] },
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
                          children: ["number 1.1. breaking lines: "],
                        },
                        { tag: "br", children: [] },
                        "after line break",
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
    const output: LexicalRootNode = {
      version: 1,
      format: "",
      indent: 0,
      direction: null,
      type: "root",
      children: [
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h1",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 1",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h2",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 2",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h3",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 3",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h4",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 4",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h5",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 5",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "heading",
          tag: "h6",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Title 6",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [
            {
              version: 1,
              format: 7,
              indent: 0,
              direction: null,
              type: "text",
              text: "Formatted span",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "text",
              text: "Inline line break",
            },
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "linebreak",
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "paragraph",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "link",
              url: "https://example.com",
              children: [
                {
                  version: 1,
                  format: "",
                  indent: 0,
                  direction: null,
                  type: "text",
                  text: "Link",
                },
              ],
            },
          ],
        },
        {
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          type: "list",
          listType: "bullet",
          children: [
            {
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              type: "listitem",
              children: [
                {
                  version: 1,
                  format: "",
                  indent: 0,
                  direction: "rtl",
                  type: "list",
                  listType: "number",
                  children: [
                    {
                      version: 1,
                      format: "",
                      indent: 0,
                      direction: null,
                      type: "listitem",
                      children: [
                        {
                          version: 1,
                          format: 2,
                          indent: 0,
                          direction: null,
                          type: "text",
                          text: "number 1.1. breaking lines: ",
                        },
                        {
                          version: 1,
                          format: "",
                          indent: 0,
                          direction: null,
                          type: "linebreak",
                        },
                        {
                          version: 1,
                          format: "",
                          indent: 0,
                          direction: null,
                          type: "text",
                          text: "after line break",
                        },
                      ],
                    },
                    {
                      version: 1,
                      format: "",
                      indent: 0,
                      direction: null,
                      type: "listitem",
                      children: [
                        {
                          version: 1,
                          format: "",
                          indent: 0,
                          direction: null,
                          type: "text",
                          text: "number 1.2",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(richTextSourceToLexical(input)).toStrictEqual(output);
  });
});
