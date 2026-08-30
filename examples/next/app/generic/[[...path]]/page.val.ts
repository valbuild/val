import { c, nextAppRouter, s } from "_/val.config";

const genericPageSchema = s.object({
  title: s.string(),
  url: s.route(),
  sections: s.array(
    s.union(
      "type",
      s
        .object({
          type: s.literal("text"),
          text: s.richtext(),
        })
        .render({ as: "inline" }),
      s
        .object({
          type: s.literal("code"),
          code: s.string().render({ as: "code", language: "typescript" }),
        })
        .render({ as: "inline" })
        // Both, on purpose: the render decides that the block is EDITED in the
        // list row, the preview decides what it is CALLED everywhere it is only
        // referred to — a search hit, a reference, this row's own collapsed
        // header. See architecture/render-and-preview.md.
        .preview(({ val }) => ({ title: val.code })),
    ),
  ),
});

export default c.define(
  "/app/generic/[[...path]]/page.val.ts",
  s.router(nextAppRouter, genericPageSchema),
  {
    "/generic": {
      url: "/generic",
      title: "Generic",

      sections: [
        {
          type: "text",
          text: [
            {
              tag: "p",
              children: ["This is a generic page with some text content."],
            },
          ],
        },
        {
          type: "code",
          code: 'console.log("This is a code section in the generic page.");',
        },
      ],
    },
    "/generic/test/foo": {
      url: "https://www.google.com",
      title: "Test",
      sections: [
        {
          type: "text",
          text: [
            {
              tag: "p",
              children: ["This is a test page with some text content."],
            },
          ],
        },
        {
          type: "code",
          code: 'console.log("This is a code section in the test page.");',
        },
      ],
    },
  },
);
