import { initVal } from "@valbuild/core";
import { remirrorToRichTextSource } from "./remirrorToRichTextSource";
import { RemirrorJSON } from "./remirrorTypes";

describe("Remirror to RichTextSource", () => {
  test("basics", () => {
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
    expect(remirrorToRichTextSource(input, "/public/val", null)).toEqual({
      blocks: [
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
          children: [
            "Inline line break",
            {
              tag: "br",
            },
          ],
        },
        {
          tag: "p",
          children: [
            {
              tag: "br",
            },
          ],
        },
        {
          tag: "p",
          children: [
            {
              tag: "br",
            },
          ],
        },
        {
          tag: "p",
          children: [
            {
              tag: "a",
              href: "https://example.com",
              children: ["Link"],
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
                  tag: "p",
                  children: [],
                },
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
                          ],
                        },
                        {
                          tag: "p",
                          children: ["after line break"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["number 1.2"],
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
      files: {},
    });
  });

  test("link", () => {
    const input: RemirrorJSON = {
      type: "doc",
      content: [
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
      ],
    };
    expect(remirrorToRichTextSource(input, "/public/val", null)).toEqual({
      blocks: [
        {
          tag: "p",
          children: [
            {
              tag: "a",
              href: "https://example.com",
              children: ["Link"],
            },
          ],
        },
      ],
      files: {},
    });
  });

  test("existing image", () => {
    const { c } = initVal();
    const input: RemirrorJSON = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/val/example.png", // <- url to existing image
                alt: "Image",
                width: 100,
                height: 10,
              },
            },
          ],
        },
      ],
    };
    expect(remirrorToRichTextSource(input, "/public/val", null)).toEqual({
      blocks: [
        {
          tag: "p",
          children: [
            {
              tag: "img",
              src: c.image("/public/val/example.png", {
                mimeType: "image/png",
                width: 100,
                height: 10,
              }),
            },
          ],
        },
      ],
      files: {},
    });
  });

  test("existing patched image", () => {
    const { c } = initVal();
    const input: RemirrorJSON = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/api/val/files/public/val/example.png?patch_id=123", // <- url to existing patched images
                alt: "Image",
                width: 100,
                height: 10,
              },
            },
          ],
        },
      ],
    };
    expect(remirrorToRichTextSource(input, "/public/val", null)).toEqual({
      blocks: [
        {
          tag: "p",
          children: [
            {
              tag: "img",
              src: {
                ...c.image("/public/val/example.png", {
                  mimeType: "image/png",
                  width: 100,
                  height: 10,
                }),
                patch_id: "123",
              },
            },
          ],
        },
      ],
      files: {},
    });
  });

  test("new image", () => {
    const { c } = initVal();
    const smallPngBuffer =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

    const input: RemirrorJSON = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: smallPngBuffer,
                fileName: "example.png",
                alt: "Image",
                width: 100,
                height: 10,
              },
            },
          ],
        },
      ],
    };
    expect(remirrorToRichTextSource(input, "/public/val", null)).toEqual({
      blocks: [
        {
          tag: "p",
          children: [
            {
              tag: "img",
              src: c.image("/public/val/example_80d58.png", {
                mimeType: "image/png",
                width: 100,
                height: 10,
              }),
            },
          ],
        },
      ],
      files: {
        "/public/val/example_80d58.png": {
          value: smallPngBuffer,
          patchPaths: [["0", "children", "0", "src"]],
        },
      },
    });
  });

  test("nested new image", () => {
    const { c } = initVal();
    const smallPngBuffer =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

    const input: RemirrorJSON = {
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
                      text: "image below:",
                    },
                  ],
                },
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "image",
                      attrs: {
                        src: smallPngBuffer,
                        fileName: "example.png",
                        alt: "Image",
                        width: 100,
                        height: 10,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: smallPngBuffer,
                fileName: "example.png",
                alt: "Image",
                width: 100,
                height: 10,
              },
            },
          ],
        },
      ],
    };
    expect(remirrorToRichTextSource(input, "/public/val", null)).toEqual({
      blocks: [
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [
                { tag: "p", children: ["image below:"] },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "img",
                      src: c.image("/public/val/example_80d58.png", {
                        mimeType: "image/png",
                        width: 100,
                        height: 10,
                      }),
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
            {
              tag: "img",
              src: c.image("/public/val/example_80d58.png", {
                mimeType: "image/png",
                width: 100,
                height: 10,
              }),
            },
          ],
        },
      ],
      files: {
        "/public/val/example_80d58.png": {
          value: smallPngBuffer,
          patchPaths: [
            [
              "0", // ul
              "children",
              "0", // first li
              "children",
              "1", // second paragraph
              "children",
              "0", // img
              "src",
            ],
            ["1", "children", "0", "src"],
          ],
        },
      },
    });
  });

  // test("example 1", () => {
  //   const input: RemirrorJSON = {
  //     type: "doc",
  //     content: [
  //       {
  //         type: "paragraph",
  //         content: [
  //           {
  //             type: "text",
  //             text: "  ",
  //           },
  //           {
  //             type: "text",
  //             marks: [
  //               {
  //                 type: "bold",
  //               },
  //             ],
  //             text: "Val",
  //           },
  //           {
  //             type: "text",
  //             text: " is a CMS where ",
  //           },
  //           {
  //             type: "text",
  //             marks: [
  //               {
  //                 type: "bold",
  //               },
  //             ],
  //             text: "content",
  //           },
  //           {
  //             type: "text",
  //             text: " is ",
  //           },
  //           {
  //             type: "text",
  //             marks: [
  //               {
  //                 type: "bold",
  //               },
  //             ],
  //             text: "code",
  //           },
  //           {
  //             type: "text",
  //             text: " ",
  //           },
  //           {
  //             type: "text",
  //             marks: [
  //               {
  //                 type: "bold",
  //               },
  //             ],
  //             text: "in",
  //           },
  //           {
  //             type: "text",
  //             text: " your git repo.",
  //           },
  //         ],
  //       },
  //       {
  //         type: "paragraph",
  //         content: [
  //           {
  //             type: "hardBreak",
  //           },
  //         ],
  //       },
  //       {
  //         type: "paragraph",
  //         content: [
  //           {
  //             type: "text",
  //             text: "  Val is a CMS, which is useful because:",
  //           },
  //         ],
  //       },
  //       {
  //         type: "bulletList",
  //         content: [
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         text: "editors can ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "change content",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " without developer interactions",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "images",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " can be managed without checking in code",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "i18n",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " support is easy to add",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         text: "a ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "well-documented",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " way to ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "structure content",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //         ],
  //       },
  //       {
  //         type: "paragraph",
  //         content: [
  //           {
  //             type: "hardBreak",
  //           },
  //         ],
  //       },
  //       {
  //         type: "paragraph",
  //         content: [
  //           {
  //             type: "text",
  //             text: "  But, with all the benefits of having content hard-coded:",
  //           },
  //         ],
  //       },
  //       {
  //         type: "bulletList",
  //         content: [
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         text: "works as normal with your ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "favorite IDE",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " without any plugins: search for content, references to usages, ...",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         text: "content is ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "type-checked",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " so you see when something is wrong immediately",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         text: "content can be ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "refactored",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " (change names, etc) just as if it was hard-coded (because it sort of is)",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         text: "work ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "locally",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " or in ",
  //                       },
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "branches",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " just as if you didn't use a CMS",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //           {
  //             type: "listItem",
  //             attrs: {
  //               closed: false,
  //               nested: false,
  //             },
  //             content: [
  //               {
  //                 type: "paragraph",
  //                 content: [
  //                   {
  //                     type: "paragraph",
  //                     content: [
  //                       {
  //                         type: "text",
  //                         marks: [
  //                           {
  //                             type: "bold",
  //                           },
  //                         ],
  //                         text: "no need for code-gen",
  //                       },
  //                       {
  //                         type: "text",
  //                         text: " and extra build steps",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //             ],
  //           },
  //         ],
  //       },
  //       {
  //         type: "paragraph",
  //         content: [
  //           {
  //             type: "text",
  //             text: "  Visift ",
  //           },
  //           {
  //             type: "text",
  //             marks: [
  //               {
  //                 type: "link",
  //                 attrs: {
  //                   href: "https://val.build",
  //                   target: null,
  //                   auto: false,
  //                 },
  //               },
  //             ],
  //             text: "Val",
  //           },
  //           {
  //             type: "text",
  //             text: " for more information.\n  ",
  //           },
  //         ],
  //       },
  //     ],
  //   };

  //   console.log(JSON.stringify(remirrorToRichTextSource(input), null, 2));
  // });
});
