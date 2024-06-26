import { AllRichTextOptions, RichTextSource } from "@valbuild/core";
import { RemirrorJSON } from "./remirrorTypes";
import { richTextToRemirror } from "./richTextToRemirror";

describe("richtext to remirror", () => {
  test("basic to remirror", () => {
    const input: RichTextSource<AllRichTextOptions> = [
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
            styles: ["bold", "italic", "line-through"],
            children: ["Formatted span"],
          },
        ],
      },
      {
        tag: "p",
        children: ["Inline line break", { tag: "br" }],
      },
      {
        tag: "p",
        children: [{ tag: "br" }],
      },
      {
        tag: "p",
        children: [{ tag: "br" }],
      },
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
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          {
                            tag: "span",
                            styles: ["italic"],
                            children: ["number 1.1. breaking lines: "],
                          },
                          { tag: "br" },
                          " break",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["number 1.2"] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
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
                            {
                              type: "hardBreak",
                              marks: [],
                            },
                            {
                              type: "text",
                              text: " break",
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

  test("lists", () => {
    const input: RichTextSource<AllRichTextOptions> = [
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: [
                  "editors can ",
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["change content"],
                  },
                  " without developer interactions",
                ],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: [
                  { tag: "span", styles: ["bold"], children: ["images"] },
                  " can be managed without checking in code",
                ],
              },
            ],
          },
        ],
      },
    ];
    const output: RemirrorJSON = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "editors can ",
                    },
                    {
                      type: "text",
                      text: "change content",
                      marks: [
                        {
                          type: "bold",
                        },
                      ],
                    },
                    {
                      type: "text",
                      text: " without developer interactions",
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
                      text: "images",
                      marks: [
                        {
                          type: "bold",
                        },
                      ],
                    },
                    {
                      type: "text",
                      text: " can be managed without checking in code",
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
