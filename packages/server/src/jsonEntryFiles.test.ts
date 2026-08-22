import fs from "fs";
import os from "os";
import path from "path";
import { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { JsonEntryFilesFingerprint } from "./jsonEntryFiles";

/**
 * The fingerprint exists so a hand-edited `*.val.json` can reach an open Studio.
 * Nothing else can see such an edit: `sourcesSha` and `baseSha` hash the module
 * source, and a `.jsonValues()` module's source is markers with the content
 * behind a thunk that `JSON.stringify` drops.
 */
describe("JsonEntryFilesFingerprint", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  const jsonValuesSchema = {
    type: "record",
    jsonValues: true,
    opt: false,
    item: { type: "string", opt: false, options: {} },
  } as SerializedSchema;

  const MODULE = "/content/kb.val.ts" as ModuleFilePath;

  function makeProject(entryKeys: string[]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-fingerprint-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "content", "kb"), { recursive: true });
    for (const key of entryKeys) {
      fs.writeFileSync(
        path.join(root, "content", "kb", `${key}.val.json`),
        JSON.stringify({ title: key }),
      );
    }
    fs.writeFileSync(
      path.join(root, "content", "kb.val.ts"),
      [
        `import { s, c } from "../val.config";`,
        `export default c.define(`,
        `  "/content/kb.val.ts",`,
        `  s.record(s.string()).jsonValues(),`,
        `  {`,
        ...entryKeys.map(
          (key) =>
            `    "${key}": c.json(() => import("./kb/${key}.val.json")),`,
        ),
        `  },`,
        `);`,
      ].join("\n"),
    );
    return {
      root,
      fingerprint: new JsonEntryFilesFingerprint(root),
      schemas: { [MODULE]: jsonValuesSchema } as Record<
        ModuleFilePath,
        SerializedSchema | undefined
      >,
      writeEntry: (key: string, contents: unknown) =>
        fs.writeFileSync(
          path.join(root, "content", "kb", `${key}.val.json`),
          JSON.stringify(contents),
        ),
      removeEntry: (key: string) =>
        fs.rmSync(path.join(root, "content", "kb", `${key}.val.json`)),
    };
  }

  test("is stable when nothing changes", () => {
    const { fingerprint, schemas } = makeProject(["a", "b"]);
    expect(fingerprint.compute(schemas)).toBe(fingerprint.compute(schemas));
  });

  test("changes when an entry's content changes", () => {
    const { fingerprint, schemas, writeEntry } = makeProject(["a", "b"]);
    const before = fingerprint.compute(schemas);
    writeEntry("a", { title: "edited on disk" });
    expect(fingerprint.compute(schemas)).not.toBe(before);
  });

  test("changes even when the edit preserves the file SIZE", () => {
    // Size alone would miss this, and two writes can land in the same
    // millisecond — hence the nanosecond mtime.
    const { fingerprint, schemas, writeEntry } = makeProject(["a"]);
    const before = fingerprint.compute(schemas);
    writeEntry("a", { title: "b" }); // same length as {"title":"a"}
    expect(fingerprint.compute(schemas)).not.toBe(before);
  });

  test("changes when an entry file is deleted", () => {
    const { fingerprint, schemas, removeEntry } = makeProject(["a", "b"]);
    const before = fingerprint.compute(schemas);
    removeEntry("b");
    expect(fingerprint.compute(schemas)).not.toBe(before);
  });

  test("is empty for a project with no jsonValues modules — it costs nothing", () => {
    const { fingerprint } = makeProject(["a"]);
    const ordinary = {
      [MODULE]: { type: "record", opt: false, item: { type: "string" } },
    } as Record<ModuleFilePath, SerializedSchema | undefined>;
    expect(fingerprint.compute(ordinary)).toBe("");
  });

  test("picks up an entry ADDED to the .val.ts, not just edited files", () => {
    // The entry list is cached on the .val.ts's mtime; adding a thunk has to
    // invalidate that cache or a newly added entry would never be watched.
    const project = makeProject(["a"]);
    const before = project.fingerprint.compute(project.schemas);
    project.writeEntry("c", { title: "c" });
    fs.writeFileSync(
      path.join(project.root, "content", "kb.val.ts"),
      [
        `import { s, c } from "../val.config";`,
        `export default c.define(`,
        `  "/content/kb.val.ts",`,
        `  s.record(s.string()).jsonValues(),`,
        `  {`,
        `    "a": c.json(() => import("./kb/a.val.json")),`,
        `    "c": c.json(() => import("./kb/c.val.json")),`,
        `  },`,
        `);`,
      ].join("\n"),
    );
    const after = project.fingerprint.compute(project.schemas);
    expect(after).not.toBe(before);
    expect(after).toContain("c.val.json");
  });
});
