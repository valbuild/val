import ts from "typescript";
import type { ModuleFilePath } from "@valbuild/core";
import {
  findRegisteredModuleSpecifiers,
  findValModulesInsertion,
  valModuleSpecifier,
  valModulesEntryText,
} from "./valModulesRegistry";

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "val.modules.ts",
    text,
    ts.ScriptTarget.ES2020,
    true,
  );
}

const POPULATED = `import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/authors.val") },
  { def: () => import("./content/theme.val") },
]);
`;

describe("findValModulesInsertion", () => {
  test("inserts after the last entry, matching its indentation", () => {
    const sourceFile = parse(POPULATED);
    const insertion = findValModulesInsertion(sourceFile);
    expect(insertion).not.toBeNull();
    expect(insertion?.hasElements).toBe(true);
    expect(insertion?.indentation).toBe("  ");
    // The offset must land immediately after the last entry, so the inserted
    // text goes before the closing bracket rather than after it.
    expect(POPULATED.slice(insertion?.insertOffset)).toBe(",\n]);\n");
  });

  test("inserts inside the brackets of an empty array", () => {
    const text = `export default modules(config, []);\n`;
    const insertion = findValModulesInsertion(parse(text));
    expect(insertion?.hasElements).toBe(false);
    expect(text.slice(insertion?.insertOffset)).toBe("]);\n");
  });

  test("returns null when there is no modules(config, [...]) call", () => {
    // Over-reporting registration is right for reading; writing has to commit to
    // a shape, and a guessed offset produces a file that no longer compiles.
    expect(
      findValModulesInsertion(parse(`export default somethingElse([]);\n`)),
    ).toBeNull();
  });

  test("produces text that still parses once inserted", () => {
    const sourceFile = parse(POPULATED);
    const insertion = findValModulesInsertion(sourceFile);
    if (!insertion) {
      throw new Error("expected an insertion point");
    }
    const inserted =
      POPULATED.slice(0, insertion.insertOffset) +
      valModulesEntryText({
        specifier: "./content/page.val",
        indentation: insertion.indentation,
        hasElements: insertion.hasElements,
      }) +
      POPULATED.slice(insertion.insertOffset);
    expect(inserted).toContain(`{ def: () => import("./content/page.val") }`);
    // Re-read the file the way the server does: the new entry must now count as
    // registered, and the existing ones must survive.
    expect(findRegisteredModuleSpecifiers(parse(inserted))).toEqual([
      "./content/authors.val",
      "./content/theme.val",
      "./content/page.val",
    ]);
  });

  test("an empty array also yields text that parses", () => {
    const text = `export default modules(config, []);\n`;
    const insertion = findValModulesInsertion(parse(text));
    if (!insertion) {
      throw new Error("expected an insertion point");
    }
    const inserted =
      text.slice(0, insertion.insertOffset) +
      valModulesEntryText({
        specifier: "./content/page.val",
        indentation: insertion.indentation,
        hasElements: insertion.hasElements,
      }) +
      text.slice(insertion.insertOffset);
    expect(findRegisteredModuleSpecifiers(parse(inserted))).toEqual([
      "./content/page.val",
    ]);
  });
});

describe("valModuleSpecifier", () => {
  test("is relative to the val.modules file and drops the extension", () => {
    expect(
      valModuleSpecifier({
        valModulesFilePath: "/val.modules.ts",
        moduleFilePath: "/content/page.val.ts" as ModuleFilePath,
      }),
    ).toBe("./content/page.val");
  });

  test("prefixes ./ for a sibling module", () => {
    expect(
      valModuleSpecifier({
        valModulesFilePath: "/val.modules.ts",
        moduleFilePath: "/page.val.ts" as ModuleFilePath,
      }),
    ).toBe("./page.val");
  });

  test("handles a module nested under a route group", () => {
    expect(
      valModuleSpecifier({
        valModulesFilePath: "/val.modules.ts",
        moduleFilePath: "/app/blogs/[blog]/page.val.ts" as ModuleFilePath,
      }),
    ).toBe("./app/blogs/[blog]/page.val");
  });
});
