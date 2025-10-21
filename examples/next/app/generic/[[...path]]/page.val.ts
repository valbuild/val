import { c, nextAppRouter, s } from "_/val.config";

const genericPageSchema = s.object({
  title: s.string(),
  content: s.string().render({ as: "textarea" }),
});

export default c.define(
  "/app/generic/[[...path]]/page.val.ts",
  s.record(genericPageSchema).router(nextAppRouter),
  {
    "/generic": {
      title: "Generic",
      content: "Generic content",
    },
    "/generic/test/foo": {
      title: "Test",
      content: "Test content",
    },
  },
);
