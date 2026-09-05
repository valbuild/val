import { result } from "@valbuild/core/fp";
import type { ModuleFilePath } from "@valbuild/core";
import { parseModuleSource } from "./parseModuleSource";

const path = "/content/page.val.ts" as ModuleFilePath;

function unwrap<T>(res: result.Result<T, { kind: string }>): T {
  if (result.isErr(res)) {
    throw new Error(`expected ok, got ${JSON.stringify(res.error)}`);
  }
  return res.value;
}

describe("parseModuleSource", () => {
  test("reads a module's source without running it", () => {
    const source = unwrap(
      parseModuleSource(
        path,
        `import { c, s } from "../val.config";
export default c.define(
  "/content/page.val.ts",
  s.object({ title: s.string(), count: s.number() }),
  { title: "Hello", count: 3 },
);`,
      ),
    );
    expect(source).toEqual({ title: "Hello", count: 3 });
  });

  // Media is a plain object, so it comes through as data like anything else.
  test("reads media, richtext and nested structures", () => {
    const source = unwrap(
      parseModuleSource(
        path,
        `import { c, s } from "../val.config";
export default c.define(
  "/content/page.val.ts",
  s.object({ img: s.image(), items: s.array(s.object({ n: s.number() })) }),
  {
    img: { path: "/public/val/a_1b2c3.png", width: 10, height: 20, mimeType: "image/png", alt: null },
    items: [{ n: 1 }, { n: 2 }],
  },
);`,
      ),
    );
    expect(source).toEqual({
      img: {
        path: "/public/val/a_1b2c3.png",
        width: 10,
        height: 20,
        mimeType: "image/png",
        alt: null,
      },
      items: [{ n: 1 }, { n: 2 }],
    });
  });

  // The real-world case: a module authored before media became a plain object.
  // History genuinely cannot reconstruct it, and must say so rather than guess.
  test("reports a non-literal source rather than guessing at it", () => {
    const res = parseModuleSource(
      path,
      `import { c, s } from "../val.config";
export default c.define(
  "/content/page.val.ts",
  s.object({ img: s.image() }),
  { img: c.image("/public/val/a.png", { width: 1, height: 1 }) },
);`,
    );
    if (result.isOk(res)) {
      throw new Error("expected an error");
    }
    expect(res.error.kind).toBe("source-unparseable");
  });

  test("reports a file that is not a val module at all", () => {
    const res = parseModuleSource(path, `export const notAValModule = 1;`);
    if (result.isOk(res)) {
      throw new Error("expected an error");
    }
    expect(res.error.kind).toBe("source-unparseable");
  });

  test("reports an empty file", () => {
    const res = parseModuleSource(path, "");
    if (result.isOk(res)) {
      throw new Error("expected an error");
    }
    expect(res.error.kind).toBe("source-unparseable");
  });
});
