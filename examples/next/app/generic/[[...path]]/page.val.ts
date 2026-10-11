import { c, nextAppRouter, s } from "_/val.config";

const genericPageSchema = s.object({
  title: s.string(),
  url: s.route(),
  sections: s
    .array(
      s.discriminatedUnion(
        "type",
        s.object({
          type: s.literal("text"),
          text: s.richtext(),
        }),
        s
          .object({
            type: s.literal("code"),
            code: s.code({ language: "typescript" }),
          })
          // Both, on purpose: the list's render decides that each block is
          // EDITED in its row, the preview decides what it is CALLED everywhere
          // it is only referred to — a search hit, a reference, this row's own
          // collapsed header. See architecture/render-and-preview.md.
          .preview(({ val }) => ({ title: val.code })),
      ),
    )
    .render({ as: "inline" }),
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
