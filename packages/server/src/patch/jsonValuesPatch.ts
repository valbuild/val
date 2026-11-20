import { posixPath } from "../posixPath";
import { type SerializedSchema } from "@valbuild/core";
import type { PatchSourceError } from "../ValOps";
import { result } from "@valbuild/core/fp";

/*
 * The rules for how an op relates to a `.jsonValues()` record live in
 * `@valbuild/shared` beside the engine that applies patches
 * (`content/jsonValuesOps.ts`), and are re-exported here for the commit flow,
 * the CLI and `@valbuild/server`'s own exports.
 */
export {
  classifyJsonValuesOp,
  expandJsonValuesRootOp,
  expandJsonValuesRootOpForKey,
  isJsonValuesRootOp,
  rebaseContentOp,
  wholeEntryKey,
  type CurrentJsonEntries,
  type JsonValuesOpClass,
} from "@valbuild/shared/internal";

/**
 * Finds every `.jsonValues()` record in a module's schema that is NOT the
 * module's root, returning the path to each within the module source.
 *
 * `.jsonValues()` is only supported on a module's ROOT record/router: the
 * `/json` endpoint keys entries by a single string, the Studio substitutes
 * loaded content at the top level of the module source, and
 * `validateJsonValuesEntries` only visits a root record. A nested one would
 * silently skip content validation and hang the Studio on a 404, so we reject
 * it up front instead (see {@link ValOps.initSources}).
 */
export function findNestedJsonValuesRecords(
  schema: SerializedSchema,
  path: string[] = [],
): string[][] {
  const found: string[][] = [];
  const rec = (current: SerializedSchema, currentPath: string[]) => {
    if (
      current.type === "record" &&
      current.jsonValues &&
      currentPath.length > 0
    ) {
      found.push(currentPath);
      // Do not descend: everything below lives in the entry's `*.val.json`.
      return;
    }
    switch (current.type) {
      case "object":
        for (const key of Object.keys(current.items)) {
          rec(current.items[key], currentPath.concat(key));
        }
        return;
      case "record":
        rec(current.item, currentPath.concat("*"));
        return;
      case "array":
        rec(current.item, currentPath.concat("*"));
        return;
      case "discriminated-union":
        for (let i = 0; i < current.items.length; i++) {
          rec(current.items[i], currentPath.concat(`union[${i}]`));
        }
        return;
      default:
        return;
    }
  };
  rec(schema, path);
  return found;
}

/**
 * The `.val.ts` suffix a module file path ends with. Stripping it yields the
 * folder that a new entry's `*.val.json` files are nested under.
 */
const VAL_TS_SUFFIX = ".val.ts";

/**
 * Computes the `*.val.json` file path (relative to rootDir) and the `import(...)`
 * path (relative to the module's directory) for a NEW `.jsonValues()` entry,
 * following the locked filename convention: the file mirrors the entry key under
 * a folder named after the `.val.ts` (its `.val.ts` suffix becomes the folder).
 *
 * For module `/app/support/[slug]/page.val.ts` and key `/support/faq`:
 * - jsonPath:   `/app/support/[slug]/page/support/faq.val.json`
 * - importPath: `./page/support/faq.val.json`
 */
export function getNewJsonEntryPaths(
  moduleFilePath: string,
  entryKey: string,
): result.Result<{ jsonPath: string; importPath: string }, PatchSourceError> {
  const base = moduleFilePath.endsWith(VAL_TS_SUFFIX)
    ? moduleFilePath.slice(0, -VAL_TS_SUFFIX.length)
    : moduleFilePath;
  const keyRel = entryKey.replace(/^\//, "");
  const invalid = (reason: string) =>
    result.err<PatchSourceError>({
      message: `Invalid .jsonValues() entry key '${entryKey}' in ${moduleFilePath}: ${reason}`,
      filePath: moduleFilePath,
    });
  // An entry key is CLIENT-SUPPLIED — it arrives as a record key in a patch op —
  // and this path is what the commit writes to disk. Left unchecked, a key with
  // `..` segments (or a backslash, which is a separator once the path is handed
  // to node's `path.join` on Windows) puts that write anywhere in the project or
  // outside it entirely, and a `move` additionally deletes the source path.
  if (keyRel === "") {
    return invalid("it is empty");
  }
  if (keyRel.includes("\\") || keyRel.includes("\0")) {
    return invalid("it contains a backslash or a NUL byte");
  }
  const jsonPath = posixPath.normalize(`${base}/${keyRel}.val.json`);
  if (!jsonPath.startsWith(`${base}/`)) {
    return invalid(`it resolves outside '${base}/'`);
  }
  const moduleDir = posixPath.dirname(moduleFilePath);
  let importPath = posixPath.relative(moduleDir, jsonPath);
  if (!importPath.startsWith(".")) {
    importPath = `./${importPath}`;
  }
  return result.ok({ jsonPath, importPath });
}

/**
 * Resolves an EXISTING entry's `*.val.json` path (relative to rootDir) from the
 * `import(...)` path recorded in the `.val.ts` thunk (from
 * {@link analyzeJsonValuesEntries}). Existing files may have been hand-placed,
 * so the import path is authoritative (hybrid authoring).
 */
export function resolveExistingJsonPath(
  moduleFilePath: string,
  importPath: string,
): string {
  const moduleDir = posixPath.dirname(moduleFilePath);
  return posixPath.join(moduleDir, importPath);
}
