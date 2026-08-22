import ts from "typescript";
import type { ModuleFilePath } from "@valbuild/core";
import {
  findRegisteredModuleSpecifiers,
  isModuleRegistered,
} from "./valModulesRegistry";

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile("val.modules.ts", text, ts.ScriptTarget.ES2020);
}

function registers(text: string, moduleFilePath: string): boolean {
  return isModuleRegistered({
    sourceFile: parse(text),
    valModulesDir: "",
    moduleFilePath: moduleFilePath as ModuleFilePath,
  });
}

describe("findRegisteredModuleSpecifiers", () => {
  test("collects dynamic import specifiers", () => {
    expect(
      findRegisteredModuleSpecifiers(
        parse(`import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/page.val") },
  { def: () => import("./content/authors.val") },
]);
`),
      ),
    ).toEqual(["./content/page.val", "./content/authors.val"]);
  });

  test("ignores static imports", () => {
    // Only dynamic imports register modules; the static ones are the config and
    // the helper itself.
    expect(
      findRegisteredModuleSpecifiers(
        parse(`import { modules } from "@valbuild/next";
export default modules(config, []);
`),
      ),
    ).toEqual([]);
  });
});

describe("isModuleRegistered", () => {
  const withPage = `import { config } from "./val.config";
export default config.modules([{ def: () => import("./content/page.val") }]);
`;

  test("matches a registered module", () => {
    expect(registers(withPage, "/content/page.val.ts")).toBe(true);
  });

  test("does not match an unregistered module", () => {
    expect(registers(withPage, "/content/authors.val.ts")).toBe(false);
  });

  test("matches regardless of the module file extension", () => {
    for (const ext of ["ts", "js", "tsx", "jsx"]) {
      expect(registers(withPage, `/content/page.val.${ext}`)).toBe(true);
    }
  });

  test("matches when the specifier includes the extension", () => {
    expect(
      registers(
        `export default config.modules([{ def: () => import("./content/page.val.ts") }]);`,
        "/content/page.val.ts",
      ),
    ).toBe(true);
  });

  test("does not confuse similarly named modules", () => {
    expect(registers(withPage, "/content/page2.val.ts")).toBe(false);
    expect(registers(withPage, "/other/content/page.val.ts")).toBe(false);
  });

  describe("authoring shapes", () => {
    // All of these must work; the point of scanning for dynamic imports rather
    // than matching call shapes is that a new shape keeps working.
    const shapes = {
      "config.modules with def": `export default config.modules([{ def: () => import("./x.val") }]);`,
      "modules(config, ...) with def": `export default modules(config, [{ def: () => import("./x.val") }]);`,
      "bare dynamic import": `export default config.modules([import("./x.val")]);`,
      "async def": `export default config.modules([{ def: async () => import("./x.val") }]);`,
      "hypothetical future shape": `export default defineValModules({ entries: [{ load: () => import("./x.val") }] });`,
    };
    for (const [name, source] of Object.entries(shapes)) {
      test(name, () => {
        expect(registers(source, "/x.val.ts")).toBe(true);
      });
    }
  });

  test("resolves specifiers relative to the val.modules directory", () => {
    // A val.modules file nested under src/ writes "./content/page.val" meaning
    // /src/content/page.val.
    expect(
      isModuleRegistered({
        sourceFile: parse(
          `export default config.modules([{ def: () => import("./content/page.val") }]);`,
        ),
        valModulesDir: "src",
        moduleFilePath: "/src/content/page.val.ts" as ModuleFilePath,
      }),
    ).toBe(true);
  });

  test("handles parent-relative specifiers", () => {
    expect(
      isModuleRegistered({
        sourceFile: parse(
          `export default config.modules([{ def: () => import("../content/page.val") }]);`,
        ),
        valModulesDir: "src",
        moduleFilePath: "/content/page.val.ts" as ModuleFilePath,
      }),
    ).toBe(true);
  });
});
