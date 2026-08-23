import path from "path";
import type { Json, ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import { getValTsSourceFile } from "./valTsSourceFile";
import { insertValJsonEntry, removeValJsonEntry } from "./patch/ts/ops";
import { getNewJsonEntryPaths } from "./patch/jsonValuesPatch";
import { formatPatchSourceError } from "./ValOps";
import { formatTsOpsError } from "./patch/ts/syntax";

/**
 * Moves ONE `.jsonValues()` entry that was written inline in the `.val.ts` into
 * its own `*.val.json`, replacing the inline value with
 * `c.json(() => import("./<key>.val.json"))`.
 *
 * This is the fix for the `jsonValues:extract-entry` validation error. It is not
 * expressible as a patch (a patch edits one `.val.ts` and cannot create the
 * backing JSON file), so it writes both files directly — JSON first, so a
 * failure part-way through never leaves the module pointing at a file that does
 * not exist.
 *
 * Root-only, like the rest of the `.jsonValues()` machinery: the entry is looked
 * up in the module's root record/router object literal.
 */
export function extractJsonValuesEntry(
  moduleFilePath: ModuleFilePath,
  rootDir: string,
  entryKey: string,
  content: Json,
  sourceFileHandler: ValSourceFileHandler,
): void {
  const { valTsPath, sourceFile } = getValTsSourceFile(
    moduleFilePath,
    rootDir,
    sourceFileHandler,
  );
  const pathsRes = getNewJsonEntryPaths(moduleFilePath, entryKey);
  if (result.isErr(pathsRes)) {
    throw Error(formatPatchSourceError(pathsRes.error));
  }
  const { jsonPath, importPath } = pathsRes.value;
  const absoluteJsonPath = path.join(rootDir, jsonPath);
  if (sourceFileHandler.host.fileExists(absoluteJsonPath)) {
    throw Error(
      `Cannot extract .jsonValues() entry '${entryKey}' of ${moduleFilePath}: '${jsonPath}' already exists`,
    );
  }

  // Remove the inline property, then add the `c.json(...)` reference back. The
  // entry moves to the end of the record: entry ORDER in a jsonValues record is
  // not meaningful (the Studio and the runtime key entries by name), and
  // insert-in-place would mean reimplementing insertValJsonEntry.
  const removed = removeValJsonEntry(sourceFile, [], entryKey);
  if (result.isErr(removed)) {
    throw Error(`${valTsPath}\n${formatTsOpsError(removed.error, sourceFile)}`);
  }
  const inserted = insertValJsonEntry(removed.value, [], entryKey, importPath);
  if (result.isErr(inserted)) {
    throw Error(
      `${valTsPath}\n${formatTsOpsError(inserted.error, removed.value)}`,
    );
  }

  sourceFileHandler.writeFile(
    absoluteJsonPath,
    JSON.stringify(content, null, 2) + "\n",
    "utf8",
  );
  sourceFileHandler.writeSourceFile(inserted.value);
}
