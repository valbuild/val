import { result } from "@valbuild/core/fp";
import ts from "typescript";
import { analyzeValModule, ValModuleAnalysis } from "./valModule";

test("analyzeValModule", () => {
  const sourceText = `import {s, c } from "./val.config";
export default c.define("/test", s.string(), "test");`;
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
  );

  const analysis = analyzeValModule(sourceFile);
  expect(analysis).toEqual(
    result.ok<ValModuleAnalysis>({
      schema: expect.anything(),
      source: expect.anything(),
    }),
  );

  const { schema, source } = (analysis as result.Ok<ValModuleAnalysis>).value;
  expect(schema.getStart(sourceFile)).toBe(sourceText.indexOf("s.string()"));
  expect(source.getStart(sourceFile)).toBe(sourceText.indexOf(`"test"`));
});

test("analyzeValModule: c.component", () => {
  const sourceText = `import {s, c } from "./val.config";
function Hero({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
export default c.component("/test.val.tsx", Hero, s.object({ title: s.string() }), { title: "test" });`;
  const sourceFile = ts.createSourceFile(
    "test.val.tsx",
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TSX,
  );

  const analysis = analyzeValModule(sourceFile);
  expect(analysis).toEqual(
    result.ok<ValModuleAnalysis>({
      schema: expect.anything(),
      source: expect.anything(),
    }),
  );

  const { schema, source } = (analysis as result.Ok<ValModuleAnalysis>).value;
  expect(schema.getStart(sourceFile)).toBe(
    sourceText.indexOf("s.object({ title: s.string() })"),
  );
  expect(source.getStart(sourceFile)).toBe(
    sourceText.indexOf(`{ title: "test" }`),
  );
});
