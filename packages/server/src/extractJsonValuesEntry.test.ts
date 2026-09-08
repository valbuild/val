import type { Json, ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { planJsonValuesEntryExtraction } from "./extractJsonValuesEntry";

const MODULE_FILE_PATH = "/content/blogs.val.ts" as ModuleFilePath;
const VAL_TS_PATH = "/project/content/blogs.val.ts";

const valTs = (entries: string) => `import { c, s } from "../val.config";

export default c.define(
  "/content/blogs.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
${entries}
  },
);
`;

function plan(entries: string, entryKey: string, content: Json) {
  return planJsonValuesEntryExtraction({
    moduleFilePath: MODULE_FILE_PATH,
    entryKey,
    content,
    valTsPath: VAL_TS_PATH,
    valTsText: valTs(entries),
  });
}

describe("planJsonValuesEntryExtraction", () => {
  const ENTRIES = [
    `    "/kept": c.json(() => import("./blogs/kept.val.json")),`,
    `    "/inline": { title: "Written inline" },`,
  ].join("\n");

  test("derives the canonical file path and the import that reaches it", () => {
    const planned = plan(ENTRIES, "/inline", { title: "Written inline" });
    if (result.isErr(planned)) {
      throw Error(planned.error);
    }
    expect(planned.value.jsonPath).toBe("/content/blogs/inline.val.json");
    expect(planned.value.valTsContent).toContain(
      'c.json(() => import("./blogs/inline.val.json"))',
    );
    expect(planned.value.valTsPath).toBe(VAL_TS_PATH);
  });

  test("moves the value out of the .val.ts and into the JSON, unchanged", () => {
    const content = { title: "Written inline" };
    const planned = plan(ENTRIES, "/inline", content);
    if (result.isErr(planned)) {
      throw Error(planned.error);
    }
    expect(JSON.parse(planned.value.jsonContent)).toEqual(content);
    // Trailing newline: the file is written to a repo, and `--fix` output that
    // every formatter immediately rewrites is noise in the next diff.
    expect(planned.value.jsonContent.endsWith("\n")).toBe(true);
    expect(planned.value.valTsContent).not.toContain("Written inline");
    // The entry that was already extracted is left exactly as it was.
    expect(planned.value.valTsContent).toContain(
      'c.json(() => import("./blogs/kept.val.json"))',
    );
  });

  test("leaves non-ASCII text elsewhere in the module alone", () => {
    // The fix must touch one entry and nothing else. The ops splice printed text
    // into the existing source rather than reprinting the file, so today this
    // holds for free — pinned because `neverAsciiEscape` is off in the printer,
    // and a change to how the ops produce text would otherwise turn every æøå in
    // a Norwegian module into a `\uXXXX` escape, silently, in an unrelated diff.
    const entries = [
      `    "/nb": { title: "Så høyt på en gren" },`,
      `    "/inline": { title: "Written inline" },`,
    ].join("\n");
    const planned = plan(entries, "/inline", { title: "Written inline" });
    if (result.isErr(planned)) {
      throw Error(planned.error);
    }
    expect(planned.value.valTsContent).toContain("Så høyt på en gren");
    expect(planned.value.valTsContent).not.toContain("\\u");
  });

  test("refuses an entry key that would escape the module's own directory", () => {
    const entries = `    "/../../etc/passwd": { title: "nope" },`;
    const planned = plan(entries, "/../../etc/passwd", { title: "nope" });
    expect(result.isErr(planned)).toBe(true);
    if (result.isErr(planned)) {
      expect(planned.error).toContain("resolves outside");
    }
  });

  test("reports a key that is not in the record instead of inventing one", () => {
    const planned = plan(ENTRIES, "/missing", { title: "nope" });
    expect(result.isErr(planned)).toBe(true);
    if (result.isErr(planned)) {
      expect(planned.error).toContain(VAL_TS_PATH);
    }
  });

  test("says nothing about whether the target exists — that is the caller's", () => {
    // Deliberate: the CLI asks the filesystem, the editor also has to count an
    // unsaved buffer as occupied. A check in here would answer only one of them,
    // and the planner would need a filesystem it has no other use for.
    const planned = plan(ENTRIES, "/inline", { title: "Written inline" });
    expect(result.isOk(planned)).toBe(true);
  });
});
