import { AllRichTextOptions, RichTextSource } from "@valbuild/core";

import { remirrorToRichTextSource } from "./remirrorToRichTextSource";
import { richTextToRemirror } from "./richTextToRemirror";

const cases: {
  description: string;
  input: RichTextSource<AllRichTextOptions>;
}[] = [
  {
    description: "basic",
    input: [
      {
        tag: "h1",
        children: ["Title 1"],
      },
      {
        tag: "h2",
        children: ["Title 2"],
      },
      {
        tag: "h3",
        children: ["Title 3"],
      },
      {
        tag: "h4",
        children: ["Title 4"],
      },
      {
        tag: "h5",
        children: ["Title 5"],
      },
      {
        tag: "h6",
        children: ["Title 6"],
      },
      {
        tag: "p",
        children: ["Some paragraph. Another sentence."],
      },
      {
        tag: "p",
        children: ["Another paragraph."],
      },
      {
        tag: "p",
        children: [
          "Formatting: ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["bold"],
          },
          ", ",
          {
            tag: "span",
            styles: ["italic"],
            children: ["italic"],
          },
          ", ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["line-through"],
          },
          ", ",
          {
            tag: "span",
            styles: ["italic", "bold"],
            children: ["bold and italic"],
          },
          ".",
        ],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              { tag: "p", children: ["List 1"] },
              {
                tag: "ol",
                children: [
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["List 1.1"] }],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["List 1.2"] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    description: "all features",
    input: [
      {
        tag: "h1",
        children: ["Title 1"],
      },
      {
        tag: "p",
        children: ["Title 1 content."],
      },
      {
        tag: "h2",
        children: ["Title 2"],
      },
      {
        tag: "p",
        children: ["Title 2 content."],
      },
      {
        tag: "h3",
        children: ["Title 3"],
      },
      {
        tag: "p",
        children: ["Title 3 content."],
      },
      {
        tag: "h4",
        children: ["Title 4"],
      },
      {
        tag: "p",
        children: ["Title 4 content."],
      },
      {
        tag: "h5",
        children: ["Title 5"],
      },
      {
        tag: "h6",
        children: ["Title 6"],
      },
      {
        tag: "p",
        children: ["Some paragraph. Another sentence."],
      },
      {
        tag: "p",
        children: ["Another paragraph."],
      },
      {
        tag: "p",
        children: [
          "Formatting: ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["bold"],
          },
          ", ",
          {
            tag: "span",
            styles: ["italic"],
            children: ["italic"],
          },
          ", ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["line-through"],
          },
          ", ",
          {
            tag: "span",
            styles: ["italic", "bold"],
            children: ["bold and italic"],
          },
          ".",
        ],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              { tag: "p", children: ["List 1"] },
              {
                tag: "ol",
                children: [
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["List 1.1"] }],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["List 1.2"] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        tag: "p",
        children: [
          "Inline link: ",
          {
            tag: "a",
            href: "https://link.com",
            children: ["inline link"],
          },
        ],
      },
      {
        tag: "p",
        children: [{ tag: "br" }],
      },
      {
        tag: "p",
        children: ["Block link:"],
      },
      {
        tag: "p",
        children: [
          {
            tag: "a",
            href: "https://link.com",
            children: ["block link"],
          },
        ],
      },
      {
        tag: "p",
        children: [{ tag: "br" }],
      },
      {
        tag: "p",
        children: ["Block Image:"],
      },
      {
        tag: "p",
        children: [
          {
            tag: "img",
            src: {
              _ref: "/public/test.jpg",
              _type: "file",
              metadata: {
                width: 100,
                height: 100,
                sha256: "123",
                mimeType: "image/jpeg",
              },
            },
          },
        ],
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
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              { tag: "p", children: ["List 1"] },
              {
                tag: "ol",
                children: [
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["List 1.1"] }],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["List 1.2"] }],
                  },
                ],
              },
            ],
          },
          {
            tag: "li",
            children: [{ tag: "p", children: ["List 2"] }],
          },
          {
            tag: "li",
            children: [
              { tag: "p", children: ["List 3"] },
              {
                tag: "ol",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Formatted ",
                          {
                            tag: "span",
                            styles: ["bold"],
                            children: ["list"],
                          },
                          {
                            tag: "br",
                          },
                          {
                            tag: "br",
                          },
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
      },
    ],
  },
];

describe("isomorphic richtext <-> conversion", () => {
  test.each(cases)("$description", ({ input }) => {
    const inputSource = input;

    const res = remirrorToRichTextSource(richTextToRemirror(inputSource));
    expect(res.blocks).toStrictEqual(inputSource);
  });
});
