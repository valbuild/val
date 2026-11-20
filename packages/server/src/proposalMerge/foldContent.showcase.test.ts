import fs from "fs";
import path from "path";
import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { foldContent } from "./foldContent";
import { loadProject, type Files } from "./project";

/*
 * The fold on a real project: `examples/tanstack`, the showcase, which has a
 * module for every schema type Val has. Each module's first string is
 * changed, as an editor would, and folded back into the files; every module
 * must then read back as exactly what was recorded.
 */

const ROOT = path.join(__dirname, "../../../../examples/tanstack");
const SKIP = new Set([
  "node_modules",
  "dist",
  ".output",
  ".vinxi",
  ".val",
  "public",
  ".tanstack",
]);

function filesOf(dir: string, files: Files = {}): Files {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesOf(full, files);
    else if (/\.(ts|tsx|json)$/.test(entry.name)) {
      files[path.relative(ROOT, full).split(path.sep).join("/")] =
        fs.readFileSync(full, "utf8");
    }
  }
  return files;
}

/** The value with its first string changed, depth first; `undefined` when it has none. */
function editFirstString(value: JSONValue): JSONValue | undefined {
  if (typeof value === "string") return `${value} (edited)`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const edited = editFirstString(value[i]);
      if (edited !== undefined)
        return value.map((item, at) => (at === i ? edited : item));
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      // A media path names bytes; an editor changes text, not that.
      if (
        key === "path" ||
        key === "_type" ||
        key === "tag" ||
        key === "mimeType"
      )
        continue;
      const edited = editFirstString(item);
      if (edited !== undefined) return { ...value, [key]: edited };
    }
  }
  return undefined;
}

test("every module of the showcase, with a string edited, folds and reads back exactly", async () => {
  const files = filesOf(ROOT);
  const loaded = await loadProject(files);
  const content: Record<ModuleFilePath, JSONValue> = {};
  for (const [id, module] of Object.entries(loaded.modules)) {
    const edited = editFirstString(module.source);
    if (edited !== undefined) content[id as ModuleFilePath] = edited;
  }
  expect(Object.keys(content).length).toBeGreaterThan(10);
  const folded = await foldContent({ files, content });
  if (folded.status === "refused") {
    throw new Error(
      folded.refusals.map((r) => `${r.module}: ${r.reason}`).join("\n"),
    );
  }
  const reloaded = await loadProject(folded.files);
  for (const [id, recorded] of Object.entries(content)) {
    expect(JSON.stringify(reloaded.modules[id as ModuleFilePath]?.source)).toBe(
      JSON.stringify(recorded),
    );
  }
}, 120_000);
