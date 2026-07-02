import ts from "typescript";
import { createValJsonReference } from "./ops";

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function print(node: ts.Node): string {
  const doc = ts.createSourceFile("out.ts", "", ts.ScriptTarget.ES2020, true);
  return printer.printNode(ts.EmitHint.Unspecified, node, doc);
}

describe("createValJsonReference", () => {
  test("prints c.json(() => import(...))", () => {
    const node = createValJsonReference("./page/blogs/test.val.json");
    const out = print(node);
    expect(out).toContain("c.json(");
    expect(out).toContain('import("./page/blogs/test.val.json")');
    expect(out).toContain("() =>");
  });

  test("produces valid, re-parseable output", () => {
    const node = createValJsonReference("./a.val.json");
    const out = print(node);
    const reparsed = ts.createSourceFile(
      "reparse.ts",
      `const x = ${out};`,
      ts.ScriptTarget.ES2020,
      true,
    );
    expect(reparsed.statements).toHaveLength(1);
  });
});
