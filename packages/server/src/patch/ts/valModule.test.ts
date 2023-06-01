import { result } from "@valbuild/core/fp";
import ts from "typescript";
import { analyzeValModule, ValModuleAnalysis } from "./valModule";

test("analyzeValModule", () => {
  const sourceText = `import {s, val } from "./val.config";
export default val.content("/test", s.string(), "test");`;
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.ES2020,
    true
  );

  const analysis = analyzeValModule(sourceFile);
  expect(analysis).toEqual(
    result.ok<ValModuleAnalysis>({
      schema: expect.anything(),
      source: expect.anything(),
    })
  );

  const { schema, source } = (analysis as result.Ok<ValModuleAnalysis>).value;
  expect(schema.getStart(sourceFile)).toBe(sourceText.indexOf("s.string()"));
  expect(source.getStart(sourceFile)).toBe(sourceText.indexOf(`"test"`));
});
