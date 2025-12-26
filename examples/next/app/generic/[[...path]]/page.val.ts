import { c, nextAppRouter, s } from "_/val.config";

const genericPageSchema = s.object({
  title: s.string(),
  content: s.string().render({ as: "textarea" }),
  exampleCode: s.string().render({ as: "code", language: "typescript" }),
});

export default c.define(
  "/app/generic/[[...path]]/page.val.ts",
  s.record(genericPageSchema).router(nextAppRouter),
  {
    "/generic": {
      title: "Generic",
      content: "Generic content in a textarea",
      exampleCode: 'console.log("Val is great for documentation")',
    },
    "/generic/test/foo": {
      title: "Test",
      content: "hva er det som skjer noen ganger?",
      exampleCode: "function contentAsCode() {\n  return true;\n}",
    },
  },
);
