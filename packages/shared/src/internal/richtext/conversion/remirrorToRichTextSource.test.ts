import { remirrorToRichTextSource } from "./remirrorToRichTextSource";
import { RemirrorJSON } from "./remirrorTypes";
import { stringifyRichTextSource } from "./stringifyRichTextSource";

describe("remirror to RichTextSource", () => {
  test("basic", () => {
    const input: RemirrorJSON = {
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
    console.log(stringifyRichTextSource(remirrorToRichTextSource(input)));
  });
});
