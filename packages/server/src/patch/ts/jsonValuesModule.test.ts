import ts from "typescript";
import { analyzeValModule } from "./valModule";
import { analyzeJsonValuesEntries } from "./jsonValuesModule";
import { result } from "@valbuild/core/fp";

function analyze(code: string) {
  const sf = ts.createSourceFile(
    "test.val.ts",
    code,
    ts.ScriptTarget.ES2020,
    true,
  );
  const mod = analyzeValModule(sf);
  if (result.isErr(mod)) {
    throw new Error("analyzeValModule failed: " + JSON.stringify(mod.error));
  }
  return analyzeJsonValuesEntries(mod.value.source);
}

describe("analyzeJsonValuesEntries", () => {
  test("extracts import path for each c.json entry", () => {
    const entries = analyze(`
      import { s, c } from "./val.config";
      export default c.define(
        "/blogs.val.ts",
        s.router(r, schema).jsonValues(),
        {
          "/blogs/a": c.json(() => import("./content/a.val.json")),
          "/blogs/b": c.json(() => import("./content/b.val.json")),
        }
      );
    `);
    expect(entries.size).toBe(2);
    expect(entries.get("/blogs/a")).toEqual({
      importPath: "./content/a.val.json",
    });
    expect(entries.get("/blogs/b")).toEqual({
      importPath: "./content/b.val.json",
    });
  });

  test("skips non-c.json entries", () => {
    const entries = analyze(`
      import { s, c } from "./val.config";
      export default c.define("/x.val.ts", s.record(schema), {
        "/a": { title: "inline" },
      });
    `);
    expect(entries.size).toBe(0);
  });

  test("handles a block-body thunk", () => {
    const entries = analyze(`
      import { s, c } from "./val.config";
      export default c.define("/x.val.ts", s.record(schema).jsonValues(), {
        "/a": c.json(() => { return import("./a.val.json"); }),
      });
    `);
    expect(entries.get("/a")).toEqual({
      importPath: "./a.val.json",
    });
  });
});
