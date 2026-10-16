import {
  initVal,
  type ModuleFilePath,
  type SerializedSchema,
} from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { mergeFromSite, schemaCheck, type Project } from "./merge";
import { valFile } from "./project";

const { s } = initVal();

/*
 * The merge takes projects as data -- files, and each module's Source and
 * serialized schema -- so whoever evaluated the schemas (Val's loader, the
 * builder tab) hands them over and the merge runs no project code. The
 * scenarios drive it through Val's loader; these build the data by hand.
 */

const HOME = "/home.val.ts" as ModuleFilePath;
const FILE = "home.val.ts";

function project(
  schema: SerializedSchema,
  schemaCode: string,
  source: JSONValue,
  validate?: Project["modules"][ModuleFilePath]["validate"],
): Project {
  return {
    files: { [FILE]: valFile(FILE, schemaCode, source) },
    modules: {
      [HOME]: {
        source,
        schema,
        entries: null,
        ...(validate ? { validate } : {}),
      },
    },
  };
}

const loose = s.object({ title: s.string() })["executeSerialize"]();
const LOOSE = "s.object({ title: s.string() })";
const tight = s
  .object({ title: s.string().maxLength(12) })
  ["executeSerialize"]();
const TIGHT = "s.object({ title: s.string().maxLength(12) })";

describe("the merge, on projects as data", () => {
  test("a schema one side changed and a field the other changed: both, with no project loaded", () => {
    const merged = mergeFromSite({
      base: project(loose, LOOSE, { title: "Sale" }),
      site: project(loose, LOOSE, { title: "Spring sale" }),
      proposal: project(tight, TIGHT, { title: "Sale" }),
      resolutions: [],
    });
    expect(merged).toMatchObject({ status: "merged", code: [FILE] });
    if (merged.status !== "merged") return;
    expect(merged.files[FILE]).toContain("maxLength(12)");
    expect(merged.files[FILE]).toContain(`"Spring sale"`);
  });

  test("the schema check reads the serialized schema's rules", () => {
    const site = project(loose, LOOSE, { title: "The great spring sale" });
    const proposal = project(tight, TIGHT, { title: "Sale" });
    const merged = project(tight, TIGHT, { title: "The great spring sale" });
    expect(schemaCheck(merged, [site, proposal])).toMatchObject([
      { kind: "invalid", moduleFilePath: HOME, path: ["title"] },
    ]);
  });

  test("an evaluated schema's own validate is used where it is given: custom rules too", () => {
    const noSale = (source: unknown) =>
      JSON.stringify(source).includes("sale")
        ? [{ path: ["title"], message: "No sales this season" }]
        : [];
    const site = project(loose, LOOSE, { title: "spring sale" });
    const proposal = project(loose, LOOSE, { title: "Hello" }, noSale);
    const merged = project(loose, LOOSE, { title: "spring sale" }, noSale);
    expect(schemaCheck(merged, [site, proposal])).toEqual([
      {
        kind: "invalid",
        moduleFilePath: HOME,
        path: ["title"],
        value: "spring sale",
        message: "No sales this season",
      },
    ]);
  });
});
