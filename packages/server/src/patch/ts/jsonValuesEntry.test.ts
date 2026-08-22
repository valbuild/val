import ts from "typescript";
import { result } from "@valbuild/core/fp";
import { insertValJsonEntry, removeValJsonEntry } from "./ops";

const MODULE = `import { s, c } from "../val.config";

export default c.define(
  "/test/pages.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/blog/hello": c.json(() => import("./content/hello.val.json")),
    "/blog/world": c.json(() => import("./content/world.val.json")),
  },
);
`;

function parse(src: string): ts.SourceFile {
  return ts.createSourceFile("<val>", src, ts.ScriptTarget.ES2015);
}

function print(node: ts.SourceFile): string {
  return node.getText(node);
}

describe("insertValJsonEntry", () => {
  test("appends a c.json(() => import(...)) property to the root record", () => {
    const res = insertValJsonEntry(
      parse(MODULE),
      [],
      "/blog/new",
      "./pages/blog/new.val.json",
    );
    if (result.isErr(res)) {
      throw res.error;
    }
    const out = print(res.value);
    expect(out).toContain(
      `"/blog/new": c.json(() => import("./pages/blog/new.val.json"))`,
    );
    // existing entries are untouched
    expect(out).toContain(
      `"/blog/hello": c.json(() => import("./content/hello.val.json"))`,
    );
  });

  test("fails when the entry key already exists", () => {
    const res = insertValJsonEntry(
      parse(MODULE),
      [],
      "/blog/hello",
      "./pages/blog/hello.val.json",
    );
    expect(result.isErr(res)).toBe(true);
  });
});

describe("removeValJsonEntry", () => {
  test("removes an existing entry property", () => {
    const res = removeValJsonEntry(parse(MODULE), [], "/blog/hello");
    if (result.isErr(res)) {
      throw res.error;
    }
    const out = print(res.value);
    expect(out).not.toContain(`"/blog/hello"`);
    expect(out).toContain(`"/blog/world"`);
  });

  test("fails when the entry key does not exist", () => {
    const res = removeValJsonEntry(parse(MODULE), [], "/blog/missing");
    expect(result.isErr(res)).toBe(true);
  });
});
