import { RichText, AnyRichTextOptions } from "@valbuild/core";
import { RemirrorJSON } from "./remirrorTypes";
import { richTextToRemirror } from "./richTextToRemirror";

describe("richtext to remirror", () => {
  test("basic to remirror", () => {
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
                        { tag: "br" },
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
    const output: RemirrorJSON = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: {
            level: 1,
          },
          content: [
            {
              type: "text",
              text: "Title 1",
            },
          ],
        },
        {
          type: "heading",
          attrs: {
            level: 2,
          },
          content: [
            {
              type: "text",
              text: "Title 2",
            },
          ],
        },
        {
          type: "heading",
          attrs: {
            level: 3,
          },
          content: [
            {
              type: "text",
              text: "Title 3",
            },
          ],
        },
        {
          type: "heading",
          attrs: {
            level: 4,
          },
          content: [
            {
              type: "text",
              text: "Title 4",
            },
          ],
        },
        {
          type: "heading",
          attrs: {
            level: 5,
          },
          content: [
            {
              type: "text",
              text: "Title 5",
            },
          ],
        },
        {
          type: "heading",
          attrs: {
            level: 6,
          },
          content: [
            {
              type: "text",
              text: "Title 6",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Formatted span",
              marks: [
                {
                  type: "bold",
                },
                {
                  type: "italic",
                },
                {
                  type: "strike",
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Inline line break",
            },
            {
              type: "hardBreak",
              marks: [],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "hardBreak",
              marks: [],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "hardBreak",
              marks: [],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.com",
                    auto: false,
                    target: null,
                  },
                },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [],
                },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: "number 1.1. breaking lines: ",
                              marks: [
                                {
                                  type: "italic",
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: "after line break",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
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
        },
      ],
    };
    expect(richTextToRemirror(input)).toStrictEqual(output);
  });
});
