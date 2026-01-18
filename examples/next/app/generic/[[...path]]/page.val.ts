import { c, nextAppRouter, s } from "_/val.config";

const genericPageSchema = s.object({
  title: s.string(),
  url: s.route(),
  content: s.string().render({ as: "textarea" }),
  exampleCode: s.string().render({ as: "code", language: "typescript" }),
});

export default c.define(
  "/app/generic/[[...path]]/page.val.ts",
  s.router(nextAppRouter, genericPageSchema),
  {
    "/generic": {
      url: "/generic",
      title: "Generic",
      content: "Generic content in a textarea",
      exampleCode: 'console.log("Val is great for documentation")',
    },
    "/generic/test/foo": {
      url: "https://www.google.com",
      title: "Test",
      content: "hva er det som skjer noen ganger?",
      exampleCode: "function contentAsCode() {\n  return true;\n}",
    },
  },
);
